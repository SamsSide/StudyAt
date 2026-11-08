import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_FILE, nodeFs, type Db, type DbFs } from './db';
import { LATEST_VERSION, schemaVersion } from './migrations';
import { NOW, WASM_PATH, openTestDb, tempDir } from './test-helpers';

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
});
