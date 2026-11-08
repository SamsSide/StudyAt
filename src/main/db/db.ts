// The sql.js database and its file (spec §3.3, study-dev rules 2 and 6). The whole database lives
// in memory and is written to one file atomically: write `studyat.sqlite.tmp`, fsync, rename.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import { DB_FILE, fileStamp } from './backup';
import { nodeFs, type DbFs } from './db-fs';
import { migrate } from './migrations';
import { seedIfEmpty, type BuiltinAssets } from './seed';

export { DB_FILE } from './backup';
export { nodeFs, type DbFs } from './db-fs';
export type { SqlJsDatabase };

/** Debounce for `markDirty` writes (spec §3.3). */
export const FLUSH_DEBOUNCE_MS = 500;

export interface Db {
  raw: SqlJsDatabase;
  /**
   * Writes the database to disk now. Writes never overlap: a flush asked for while one is in
   * flight runs once, after it, with the data as it is then.
   */
  flushNow(): Promise<void>;
  /** Schedules a write within 500 ms; repositories call this after every mutation. */
  markDirty(): void;
  /** Flushes anything pending and closes the database. */
  close(): Promise<void>;
  /** `corrupt`: the file failed to open, was kept as `studyat.corrupt-<stamp>.sqlite`, and this is a fresh database. */
  recovered: 'ok' | 'corrupt';
}

export interface OpenOptions {
  /** The data folder (userData, or `STUDYAT_USER_DATA`). */
  dir: string;
  now: () => number;
  /** sql-wasm.wasm; when omitted sql.js finds it beside its own script (Node). */
  wasmPath?: string;
  /** `assets/builtin.json`, used to seed built-in spaces and sounds. */
  builtinPath: string;
  fs?: DbFs;
}

const sqlJsByWasm = new Map<string, Promise<SqlJsStatic>>();

function loadSqlJs(wasmPath?: string): Promise<SqlJsStatic> {
  const key = wasmPath ?? '';
  let loading = sqlJsByWasm.get(key);
  if (!loading) {
    loading = initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
    sqlJsByWasm.set(key, loading);
  }
  return loading;
}

/** Throws unless `raw` is a readable SQLite database. */
function assertReadable(raw: SqlJsDatabase): void {
  const result = raw.exec('PRAGMA quick_check');
  const verdict = result[0]?.values[0]?.[0];
  if (verdict !== 'ok') throw new Error(`quick_check: ${String(verdict)}`);
}

/**
 * Opens (or creates) `<dir>/studyat.sqlite`, then migrates it (with a pre-migration backup) and
 * seeds it, and writes it back. A file that fails to open is renamed, never deleted, and a fresh
 * database is returned with `recovered: 'corrupt'`; the dialog is the caller's.
 */
export async function openDatabase(opts: OpenOptions): Promise<Db> {
  const fs = opts.fs ?? nodeFs;
  const SQL = await loadSqlJs(opts.wasmPath);
  await fs.mkdir(opts.dir);
  const file = join(opts.dir, DB_FILE);
  const tmp = `${file}.tmp`;

  let recovered: Db['recovered'] = 'ok';
  let raw: SqlJsDatabase;
  const bytes = await fs.readFile(file);
  if (bytes === null) {
    raw = new SQL.Database();
  } else {
    let opened: SqlJsDatabase | null = null;
    try {
      opened = new SQL.Database(bytes);
      assertReadable(opened);
      raw = opened;
    } catch {
      opened?.close();
      await fs.rename(file, join(opts.dir, `studyat.corrupt-${fileStamp(opts.now())}.sqlite`));
      raw = new SQL.Database();
      recovered = 'corrupt';
    }
  }

  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = async (): Promise<void> => {
    // Exported synchronously at the start of the write, so the bytes are a consistent snapshot.
    const data = raw.export();
    await fs.writeDurable(tmp, data);
    await fs.rename(tmp, file);
  };

  const flushNow = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!inFlight) {
      inFlight = write().finally(() => {
        inFlight = null;
      });
      return inFlight;
    }
    // One follow-up write covers every flush asked for while this one is in flight.
    if (!queued) {
      queued = inFlight
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return flushNow();
        });
    }
    return queued;
  };

  const markDirty = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow().catch((err: unknown) => console.error('StudyAt: could not save the database', err));
    }, FLUSH_DEBOUNCE_MS);
  };

  const db: Db = {
    raw,
    flushNow,
    markDirty,
    async close() {
      await flushNow();
      raw.close();
    },
    recovered,
  };

  await migrate(raw, file, opts.now(), undefined, fs);
  const builtin = JSON.parse(await readFile(opts.builtinPath, 'utf8')) as BuiltinAssets;
  seedIfEmpty(db, builtin, opts.now());
  await flushNow();
  return db;
}
