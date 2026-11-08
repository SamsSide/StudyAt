import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_FILE, NewerSchemaError, nodeFs, type Db, type DbFs } from './db';
import { LATEST_VERSION, schemaVersion } from './migrations';
import { NOW, WASM_PATH, openTestDb, tempDir } from './test-helpers';

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

async function mixNames(file: string): Promise<string[]> {
  const raw = await reopenRaw(file);
  try {
    return (raw.exec('SELECT name FROM mixes ORDER BY id')[0]?.values ?? []).map((r) => String(r[0]));
  } finally {
    raw.close();
  }
}

async function reopenRaw(file: string) {
  const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
  return new SQL.Database(readFileSync(file));
}

describe('openDatabase', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db | null = null;

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(async () => {
    await db?.close();
    db = null;
    vi.useRealTimers();
    cleanup();
  });

  it('creates schema v1 and records schema_version 1', async () => {
    db = await openTestDb(dir);
    expect(LATEST_VERSION).toBe(1);
    expect(schemaVersion(db.raw)).toBe(1);
    const tables = db.raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]!.values.flat();
    for (const t of ['meta', 'settings', 'subjects', 'sessions', 'tasks', 'spaces', 'sounds', 'mixes', 'recaps']) {
      expect(tables).toContain(t);
    }
    expect(db.recovered).toBe('ok');
    // A fresh database is written to disk straight away.
    expect(existsSync(join(dir, DB_FILE))).toBe(true);
  });

  it('atomic write leaves no .tmp and file reopens with same rows', async () => {
    db = await openTestDb(dir);
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('Rainy', '{}')");
    await db.flushNow();
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const raw = await reopenRaw(join(dir, DB_FILE));
    expect(raw.exec('SELECT name FROM mixes')[0]!.values).toEqual([['Rainy']]);
    raw.close();
    await db.close();
    db = await openTestDb(dir);
    expect(db.raw.exec('SELECT name FROM mixes')[0]!.values).toEqual([['Rainy']]);
  });

  it('serialises overlapping flushes', async () => {
    let active = 0;
    let maxActive = 0;
    let writes = 0;
    const slowFs: DbFs = {
      ...nodeFs,
      async writeDurable(path, data) {
        active += 1;
        writes += 1;
        maxActive = Math.max(maxActive, active);
        // Write half, stall, then finish: a concurrent writer would interleave here.
        writeFileSync(path, data.subarray(0, data.length >> 1));
        await new Promise((r) => setTimeout(r, 40));
        await nodeFs.writeDurable(path, data);
        active -= 1;
      },
    };
    db = await openTestDb(dir, NOW, slowFs);
    writes = 0;
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('one', '{}')");
    const first = db.flushNow();
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('two', '{}')");
    const second = db.flushNow();
    const third = db.flushNow(); // coalesces with the queued one
    await Promise.all([first, second, third]);
    expect(maxActive).toBe(1);
    expect(writes).toBe(2);
    const raw = await reopenRaw(join(dir, DB_FILE));
    expect(raw.exec('SELECT name FROM mixes ORDER BY id')[0]!.values).toEqual([['one'], ['two']]);
    raw.close();
  });

  it('markDirty debounces to one write per 500 ms', async () => {
    let writes = 0;
    const countingFs: DbFs = {
      ...nodeFs,
      async writeDurable(path, data) {
        writes += 1;
        await nodeFs.writeDurable(path, data);
      },
    };
    db = await openTestDb(dir, NOW, countingFs);
    writes = 0;
    vi.useFakeTimers();
    db.markDirty();
    db.markDirty();
    db.markDirty();
    await vi.advanceTimersByTimeAsync(499);
    expect(writes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toBe(1);
    vi.useRealTimers();
  });

  it('close flushes pending changes', async () => {
    db = await openTestDb(dir);
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('late', '{}')");
    db.markDirty();
    await db.close();
    db = null;
    const raw = await reopenRaw(join(dir, DB_FILE));
    expect(raw.exec('SELECT name FROM mixes')[0]!.values).toEqual([['late']]);
    raw.close();
  });

  it('corrupt file is renamed and a fresh db returned', async () => {
    const garbage = Buffer.from('this is not a sqlite database, just Sam’s bad luck'.repeat(200));
    writeFileSync(join(dir, DB_FILE), garbage);
    db = await openTestDb(dir);
    expect(db.recovered).toBe('corrupt');
    expect(schemaVersion(db.raw)).toBe(1);
    const corrupt = readdirSync(dir).filter((f) => /^studyat\.corrupt-.+\.sqlite$/.test(f));
    expect(corrupt).toHaveLength(1);
    // Never deleted: the original bytes are kept as they were.
    expect(readFileSync(join(dir, corrupt[0]!)).equals(garbage)).toBe(true);
    expect(db.raw.exec('SELECT count(*) FROM subjects')[0]!.values[0]![0]).toBe(6);
  });
  // Finding 1: the real file is never the one being written.
  it('the real file holds the previous rows while a write is stalled', async () => {
    let release: () => void = () => undefined;
    let stalled: () => void = () => undefined;
    const isStalled = new Promise<void>((r) => (stalled = r));
    let stall = false;
    const stallingFs: DbFs = {
      ...nodeFs,
      async writeDurable(path, data) {
        if (!stall) return nodeFs.writeDurable(path, data);
        // Half the bytes are on disk, then the disk stalls.
        writeFileSync(path, data.subarray(0, data.length >> 1));
        stalled();
        await new Promise<void>((r) => (release = r));
        await nodeFs.writeDurable(path, data);
      },
    };
    db = await openTestDb(dir, NOW, stallingFs);
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('before', '{}')");
    await db.flushNow();
    stall = true;
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('during', '{}')");
    const flushing = db.flushNow();
    await isStalled;
    const whileStalled = await mixNames(join(dir, DB_FILE)).catch((err: unknown) => err);
    stall = false;
    release();
    await flushing;
    expect(whileStalled).toEqual(['before']);
    expect(await mixNames(join(dir, DB_FILE))).toEqual(['before', 'during']);
  });

  it('a write that fails part-way leaves the real file intact and a later flush succeeds', async () => {
    let fail = false;
    const failingFs: DbFs = {
      ...nodeFs,
      async writeDurable(path, data) {
        if (!fail) return nodeFs.writeDurable(path, data);
        writeFileSync(path, data.subarray(0, data.length >> 1));
        throw errno('ENOSPC');
      },
    };
    db = await openTestDb(dir, NOW, failingFs);
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('kept', '{}')");
    await db.flushNow();
    fail = true;
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('next', '{}')");
    await expect(db.flushNow()).rejects.toThrow('ENOSPC');
    expect(await mixNames(join(dir, DB_FILE))).toEqual(['kept']);
    fail = false;
    await db.flushNow();
    expect(await mixNames(join(dir, DB_FILE))).toEqual(['kept', 'next']);
  });

  // Finding 3: Defender or the indexer briefly holding the file must not lose a checkpoint.
  it('retries a rename that fails with a transient Windows error', async () => {
    let renames = 0;
    let failures = 0;
    const lockedFs: DbFs = {
      ...nodeFs,
      async rename(from, to) {
        renames += 1;
        if (failures > 0) {
          failures -= 1;
          throw errno(failures % 2 === 0 ? 'EPERM' : 'EBUSY');
        }
        return nodeFs.rename(from, to);
      },
    };
    db = await openTestDb(dir, NOW, lockedFs);
    renames = 0;
    failures = 2;
    db.raw.run("INSERT INTO mixes (name, levels) VALUES ('saved', '{}')");
    await db.flushNow();
    expect(renames).toBe(3);
    expect(await mixNames(join(dir, DB_FILE))).toEqual(['saved']);
  });

  it('gives up on a rename after about 2 s, and at once on a non-transient error', async () => {
    let renames = 0;
    let code: string | null = null;
    let renamed: () => void = () => undefined;
    const lockedFs: DbFs = {
      ...nodeFs,
      async rename(from, to) {
        renames += 1;
        renamed();
        if (code) throw errno(code);
        return nodeFs.rename(from, to);
      },
    };
    db = await openTestDb(dir, NOW, lockedFs);
    try {
      renames = 0;
      code = 'EACCES';
      const firstRename = new Promise<void>((r) => (renamed = r));
      vi.useFakeTimers();
      const outcome = db.flushNow().then(
        () => 'resolved',
        (err: NodeJS.ErrnoException) => err.code,
      );
      await firstRename;
      await vi.advanceTimersByTimeAsync(1999);
      expect(renames).toBeGreaterThan(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe('EACCES');
      vi.useRealTimers();

      renames = 0;
      code = 'ENOENT';
      await expect(db.flushNow()).rejects.toThrow('ENOENT');
      expect(renames).toBe(1);
    } finally {
      code = null;
    }
  });

  // Finding 8: nothing is written, and nothing throws, after close.
  it('markDirty and flushNow are no-ops after close', async () => {
    let writes = 0;
    const countingFs: DbFs = {
      ...nodeFs,
      async writeDurable(path, data) {
        writes += 1;
        await nodeFs.writeDurable(path, data);
      },
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const closed = await openTestDb(dir, NOW, countingFs);
    await closed.close();
    writes = 0;
    vi.useFakeTimers();
    closed.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await expect(closed.flushNow()).resolves.toBeUndefined();
    await expect(closed.close()).resolves.toBeUndefined();
    expect(writes).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  // R16: the stamp of the rename, for the corrupt dialog and latestBackupBefore.
  it('records corruptAt as the time used in the corrupt rename, null otherwise', async () => {
    db = await openTestDb(dir);
    expect(db.corruptAt).toBeNull();
    await db.close();
    writeFileSync(join(dir, DB_FILE), Buffer.from('not sqlite'.repeat(500)));
    db = await openTestDb(dir, NOW + 5000);
    expect(db.recovered).toBe('corrupt');
    expect(db.corruptAt).toBe(NOW + 5000);
    expect(existsSync(join(dir, 'studyat.corrupt-2026-11-08-120005.sqlite'))).toBe(true);
  });

  // R18: a database from a newer StudyAt is refused, and left exactly as it was.
  it('refuses a newer schema with NewerSchemaError and writes nothing', async () => {
    db = await openTestDb(dir);
    db.raw.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [String(LATEST_VERSION + 1)]);
    await db.close();
    db = null;
    const before = readFileSync(join(dir, DB_FILE));
    const err: unknown = await openTestDb(dir, NOW + 60_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NewerSchemaError);
    expect(err).toMatchObject({ found: LATEST_VERSION + 1, supported: LATEST_VERSION });
    expect(readFileSync(join(dir, DB_FILE)).equals(before)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([DB_FILE]);
  });
});
