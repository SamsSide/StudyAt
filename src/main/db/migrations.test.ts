import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE, nodeFs, type DbFs } from './db';
import { LATEST_VERSION, MIGRATIONS, NewerSchemaError, migrate, schemaVersion } from './migrations';
import { NOW, WASM_PATH, openTestDb, recordingFs, tempDir } from './test-helpers';

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

    expect(result).toEqual({ from: 0, to: LATEST_VERSION });
    expect(schemaVersion(raw)).toBe(LATEST_VERSION);
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre-migration-v0-2026-11-08-120000\.sqlite$/);
    raw.close();
  });

  it('a v0 file opened through openDatabase is migrated, backed up and seeded', async () => {
    writeFileSync(join(dir, DB_FILE), new Uint8Array(0));
    const db = await openTestDb(dir);
    expect(db.recovered).toBe('ok');
    expect(schemaVersion(db.raw)).toBe(LATEST_VERSION);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('pre-migration-v0-'))).toBe(true);
    await db.close();
  });

  it('the pre-migration backup reaches the disk before the migrated database replaces studyat.sqlite', async () => {
    const file = join(dir, DB_FILE);
    writeFileSync(file, new Uint8Array(0));
    const { fs, log } = recordingFs();
    const db = await openTestDb(dir, NOW, fs);
    const backup = join(dir, 'backups', 'pre-migration-v0-2026-11-08-120000.sqlite');
    const sync = log.indexOf(`syncFile ${backup}.tmp`);
    const publish = log.indexOf(`rename ${backup}.tmp -> ${backup}`);
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(sync);
    expect(log.indexOf(`rename ${file}.tmp -> ${file}`)).toBeGreaterThan(publish);
    await db.close();
  });

  it('a fresh install goes straight to v3 with the notes and images tables and no backup', async () => {
    const db = await openTestDb(dir);
    expect(schemaVersion(db.raw)).toBe(3);
    expect(
      db.raw.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notes', 'images') ORDER BY name",
      )[0]!.values,
    ).toEqual([['images'], ['notes']]);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    await db.close();
  });

  // Widgets addendum §4b: a v1 database (made by the shipped v1 migration) gains `notes`, keeps
  // every v1 row, and is backed up durably first (study-dev rule 2).
  it('migrates a v1 database file to the latest with a durable pre-migration backup and all v1 data intact', async () => {
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v1 = new SQL.Database();
    await migrate(
      v1,
      null,
      NOW,
      MIGRATIONS.filter((m) => m.version === 1),
    );
    expect(schemaVersion(v1)).toBe(1);
    v1.exec(`
      INSERT INTO subjects (name, colour, archived, sort) VALUES ('Maths', '#ff0000', 0, 0);
      INSERT INTO sessions (pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status)
        VALUES ('p1', 1, 1000, 1500001, 1500001, 1500000, 0, '2026-11-07', 'done');
      INSERT INTO tasks (text, colour, done, sort, created_at, done_at) VALUES ('Read chapter 3', 'pink', 0, 0, 1000, NULL);
      INSERT INTO settings (key, value) VALUES ('streakThresholdMin', '30');
    `);
    const v1Bytes = Buffer.from(v1.export());
    v1.close();
    writeFileSync(file, v1Bytes);

    const { fs, log } = recordingFs();
    const db = await openTestDb(dir, NOW, fs);
    expect(db.recovered).toBe('ok');
    expect(schemaVersion(db.raw)).toBe(LATEST_VERSION);

    const backup = join(dir, 'backups', 'pre-migration-v1-2026-11-08-120000.sqlite');
    expect(readFileSync(backup).equals(v1Bytes)).toBe(true);
    const sync = log.indexOf(`syncFile ${backup}.tmp`);
    const publish = log.indexOf(`rename ${backup}.tmp -> ${backup}`);
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(sync);
    expect(log.indexOf(`rename ${file}.tmp -> ${file}`)).toBeGreaterThan(publish);

    expect(db.raw.exec('SELECT name FROM subjects')[0]!.values).toEqual([['Maths']]);
    expect(db.raw.exec('SELECT pomodoro_id, focus_ms, day_key, status FROM sessions')[0]!.values).toEqual([
      ['p1', 1500000, '2026-11-07', 'done'],
    ]);
    expect(db.raw.exec('SELECT text, colour FROM tasks')[0]!.values).toEqual([['Read chapter 3', 'pink']]);
    expect(db.raw.exec("SELECT value FROM settings WHERE key = 'streakThresholdMin'")[0]!.values).toEqual([
      ['30'],
    ]);
    expect(db.raw.exec('SELECT count(*) FROM notes')[0]!.values).toEqual([[0]]);
    await db.close();

    // The migrated file on disk is at the latest version too.
    const SQL2 = await initSqlJs({ locateFile: () => WASM_PATH });
    const reopened = new SQL2.Database(readFileSync(file));
    expect(schemaVersion(reopened)).toBe(LATEST_VERSION);
    reopened.close();
  });

  // v1.1 spec §5: a v2 database gains the session task columns and `images`, keeps its session row
  // unchanged with a NULL task, and is backed up durably first (study-dev rule 2).
  it('v3 adds task_id and task_text to sessions and the images table, keeps v2 rows', async () => {
    expect(LATEST_VERSION).toBe(3);
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v2 = new SQL.Database();
    await migrate(
      v2,
      null,
      NOW,
      MIGRATIONS.filter((m) => m.version <= 2),
    );
    expect(schemaVersion(v2)).toBe(2);
    v2.exec(`
      INSERT INTO sessions (pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status)
        VALUES ('p1', NULL, 1000, 1500001, 1500001, 1500000, 2000, '2026-11-07', 'done');
    `);
    const v2Bytes = Buffer.from(v2.export());
    v2.close();
    writeFileSync(file, v2Bytes);

    const { fs, log } = recordingFs();
    const db = await openTestDb(dir, NOW, fs);
    expect(db.recovered).toBe('ok');
    expect(schemaVersion(db.raw)).toBe(3);

    const backup = join(dir, 'backups', 'pre-migration-v2-2026-11-08-120000.sqlite');
    expect(readFileSync(backup).equals(v2Bytes)).toBe(true);
    const sync = log.indexOf(`syncFile ${backup}.tmp`);
    const publish = log.indexOf(`rename ${backup}.tmp -> ${backup}`);
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(sync);
    expect(log.indexOf(`rename ${file}.tmp -> ${file}`)).toBeGreaterThan(publish);

    expect(
      db.raw.exec(
        'SELECT id, pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status, task_id IS NULL, task_text IS NULL FROM sessions',
      )[0]!.values,
    ).toEqual([[1, 'p1', null, 1000, 1500001, 1500001, 1500000, 2000, '2026-11-07', 'done', 1, 1]]);
    expect(db.raw.exec('SELECT count(*) FROM images')[0]!.values).toEqual([[0]]);
    await db.close();
  });

  it('the images table defaults scale 1 and bare 0, and rejects an unknown ext', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(raw, null, NOW);
    raw.run("INSERT INTO images (ext, width, height, x, y, created_at) VALUES ('gif', 10, 20, 0.5, 0.5, 1)");
    expect(raw.exec('SELECT scale, bare, source_url FROM images')[0]!.values).toEqual([[1, 0, null]]);
    expect(() =>
      raw.run("INSERT INTO images (ext, width, height, x, y, created_at) VALUES ('bmp', 1, 1, 0, 0, 1)"),
    ).toThrow();
    raw.close();
  });

  it('the notes table defaults to an empty yellow note and rejects an unknown colour', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(raw, null, NOW);
    raw.run('INSERT INTO notes (sort, created_at, updated_at) VALUES (0, 1, 1)');
    expect(raw.exec('SELECT text, colour FROM notes')[0]!.values).toEqual([['', 'yellow']]);
    expect(() =>
      raw.run("INSERT INTO notes (colour, sort, created_at, updated_at) VALUES ('orange', 0, 1, 1)"),
    ).toThrow();
    raw.close();
  });

  it('does nothing and takes no backup when already at the latest version', async () => {
    const db = await openTestDb(dir);
    const result = await migrate(db.raw, join(dir, DB_FILE), NOW);
    expect(result).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
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
    raw.exec(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '7');",
    );
    const err: unknown = await migrate(raw, file, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NewerSchemaError);
    expect(err).toMatchObject({ found: 7, supported: LATEST_VERSION });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    raw.close();
  });
});
