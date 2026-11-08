import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE, nodeFs, type DbFs } from './db';
import { LATEST_VERSION, MIGRATIONS, NewerSchemaError, migrate, schemaVersion } from './migrations';
import { NOW, WASM_PATH, openTestDb, tempDir } from './test-helpers';

describe('migrations', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => cleanup());

  it('are numbered 1..n in order', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it('migrate backs up before running pending migrations', async () => {
    // A v0 file: an empty file, i.e. an empty SQLite database with no schema.
    const file = join(dir, DB_FILE);
    writeFileSync(file, new Uint8Array(0));
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database(readFileSync(file));
    expect(schemaVersion(raw)).toBe(0);

    const result = await migrate(raw, file, NOW);

    expect(result).toEqual({ from: 0, to: 1 });
    expect(schemaVersion(raw)).toBe(1);
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre-migration-v0-2026-11-08-120000\.sqlite$/);
    raw.close();
  });

  it('a v0 file opened through openDatabase is migrated, backed up and seeded', async () => {
    writeFileSync(join(dir, DB_FILE), new Uint8Array(0));
    const db = await openTestDb(dir);
    expect(db.recovered).toBe('ok');
    expect(schemaVersion(db.raw)).toBe(1);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('pre-migration-v0-'))).toBe(true);
    await db.close();
  });

  it('does nothing and takes no backup when already at the latest version', async () => {
    const db = await openTestDb(dir);
    const result = await migrate(db.raw, join(dir, DB_FILE), NOW);
    expect(result).toEqual({ from: 1, to: 1 });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    await db.close();
  });

  it('rolls back a failing migration and leaves the version unchanged', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    const broken = [
      ...MIGRATIONS,
      {
        version: LATEST_VERSION + 1,
        up(d: typeof raw) {
          d.run('CREATE TABLE half_done (x INTEGER)');
          throw new Error('boom');
        },
      },
    ];
    await expect(migrate(raw, join(dir, 'none.sqlite'), NOW, broken)).rejects.toThrow('boom');
    expect(schemaVersion(raw)).toBe(LATEST_VERSION);
    expect(raw.exec("SELECT name FROM sqlite_master WHERE name = 'half_done'")).toEqual([]);
    raw.close();
  });
  // Finding 4: a pre-migration copy that fails part-way leaves no backup under its final name,
  // and nothing is migrated.
  it('a pre-migration copy that fails part-way leaves no backup and migrates nothing', async () => {
    const file = join(dir, DB_FILE);
    writeFileSync(file, new Uint8Array(0));
    const failingFs: DbFs = {
      ...nodeFs,
      async copyFile(_from, to) {
        writeFileSync(to, 'half');
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      },
    };
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await expect(migrate(raw, file, NOW, MIGRATIONS, failingFs)).rejects.toThrow('ENOSPC');
    expect(schemaVersion(raw)).toBe(0);
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.sqlite'))).toEqual([]);
    raw.close();
  });

  // R18: a database written by a newer StudyAt is never migrated, backed up or touched.
  it('throws NewerSchemaError for a schema newer than it knows, before any backup', async () => {
    const file = join(dir, DB_FILE);
    writeFileSync(file, new Uint8Array(0));
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '7');");
    const err: unknown = await migrate(raw, file, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NewerSchemaError);
    expect(err).toMatchObject({ found: 7, supported: LATEST_VERSION });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    raw.close();
  });
});
