import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE, nodeFs, type DbFs } from './db';
import { LATEST_VERSION, MIGRATIONS, NewerSchemaError, migrate, schemaVersion } from './migrations';
import { tasksRepo } from './repos/tasks';
import { all } from './sql';
import { NOW, WASM_PATH, openTestDb, recordingFs, tempDir } from './test-helpers';

const UP_TO_V3 = MIGRATIONS.filter((m) => m.version <= 3);
const UP_TO_V4 = MIGRATIONS.filter((m) => m.version <= 4);

const columnsOf = (db: SqlJsDatabase, table: string): string[] =>
  all(db, `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).map((r) => String(r.name));
const rowsOf = (db: SqlJsDatabase, sql: string) => all(db, sql);
const countOf = (db: SqlJsDatabase, table: string): number =>
  Number(all(db, `SELECT count(*) AS n FROM ${table}`)[0]!.n);

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

  it('a fresh install goes straight to v5 with the v1 tasks table, empty planner archives and no backup', async () => {
    const db = await openTestDb(dir);
    expect(schemaVersion(db.raw)).toBe(5);
    expect(
      db.raw.exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('deadlines', 'images', 'notes', 'stat_widgets', 'tasks', 'tasks_v1_archive', 'planner_tasks_v4_archive',
            'task_lists_v4_archive', 'task_tags_v4_archive', 'subtasks_v4_archive', 'task_lists', 'task_tags', 'subtasks')
         ORDER BY name`,
      )[0]!.values,
    ).toEqual([
      ['deadlines'],
      ['images'],
      ['notes'],
      ['planner_tasks_v4_archive'],
      ['stat_widgets'],
      ['subtasks_v4_archive'],
      ['task_lists_v4_archive'],
      ['task_tags_v4_archive'],
      ['tasks'],
      ['tasks_v1_archive'],
    ]);
    expect(columnsOf(db.raw, 'tasks')).toEqual([
      'id',
      'text',
      'colour',
      'done',
      'sort',
      'created_at',
      'done_at',
    ]);
    for (const t of [
      'planner_tasks_v4_archive',
      'task_tags_v4_archive',
      'subtasks_v4_archive',
      'tasks_v1_archive',
    ])
      expect(countOf(db.raw, t), t).toBe(0);
    // v4 (frozen) made its Inbox list before v5 archived the lists, so that one row is all there is.
    expect(rowsOf(db.raw, 'SELECT name, subject_id FROM task_lists_v4_archive')).toEqual([
      { name: 'Inbox', subject_id: null },
    ]);
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
    expect(db.raw.exec('SELECT text, colour FROM tasks_v1_archive')[0]!.values).toEqual([
      ['Read chapter 3', 'pink'],
    ]);
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
    expect(schemaVersion(db.raw)).toBe(LATEST_VERSION);

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

  // v1.2 spec §5 (Plan notes 3): the old tasks move to `tasks_v1_archive`; the new `tasks` sequence
  // starts above every id an old task or a session row could name, so a new task never inherits
  // old focus time as its "actual". A v3 database is backed up durably first (study-dev rule 2).
  it('v4 archives old tasks, seeds a list per subject, seeds the task sequence above old ids, adds the v1.2 columns, keeps v3 rows', async () => {
    expect(UP_TO_V4.map((m) => m.version)).toEqual([1, 2, 3, 4]);
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    // A v3 database: two subjects (one archived), three old tasks (ids 1..3, then id 3 deleted so
    // the archive's AUTOINCREMENT counter is 3 but max(id) is 2), a session with task_id 7, a note.
    const v3 = new SQL.Database();
    await migrate(
      v3,
      null,
      NOW,
      MIGRATIONS.filter((m) => m.version <= 3),
    );
    expect(schemaVersion(v3)).toBe(3);
    v3.exec(`
      INSERT INTO subjects (name, colour, archived, sort) VALUES ('COMP2221 Programming Paradigms', '#f2b45c', 0, 0);
      INSERT INTO subjects (name, colour, archived, sort) VALUES ('Old module', '#888888', 1, 1);
      INSERT INTO tasks (text, colour, done, sort, created_at) VALUES ('A', 'yellow', 0, 0, 1), ('B', 'pink', 1, 1, 1), ('C', 'blue', 0, 2, 1);
      DELETE FROM tasks WHERE id = 3;
      INSERT INTO sessions (pomodoro_id, subject_id, task_id, task_text, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status)
        VALUES ('p1', 1, 7, 'Lab 7', 1000, 1500001, 1500001, 1500000, 0, '2026-11-07', 'done');
      INSERT INTO notes (text, colour, sort, created_at, updated_at) VALUES ('hello', 'yellow', 0, 1, 1);
    `);
    const v3Bytes = Buffer.from(v3.export());
    v3.close();
    writeFileSync(file, v3Bytes);

    // Pinned to v4: read the file and migrate it up to v4 only, with its backup (v5 has its own tests).
    const { fs, log } = recordingFs();
    const db = { raw: new SQL.Database(readFileSync(file)) };
    await migrate(db.raw, file, NOW, UP_TO_V4, fs);
    expect(schemaVersion(db.raw)).toBe(4);

    const backup = join(dir, 'backups', 'pre-migration-v3-2026-11-08-120000.sqlite');
    expect(readFileSync(backup).equals(v3Bytes)).toBe(true);
    const sync = log.indexOf(`syncFile ${backup}.tmp`);
    const publish = log.indexOf(`rename ${backup}.tmp -> ${backup}`);
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(sync);

    expect(db.raw.exec('SELECT id, text, colour, done FROM tasks_v1_archive ORDER BY id')[0]!.values).toEqual(
      [
        [1, 'A', 'yellow', 0],
        [2, 'B', 'pink', 1],
      ],
    );
    expect(db.raw.exec('SELECT name, subject_id, sort FROM task_lists ORDER BY sort')[0]!.values).toEqual([
      ['Inbox', null, 0],
      ['COMP2221 Programming Paradigms', 1, 1],
    ]);
    expect(db.raw.exec("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'")[0]!.values).toEqual([[7]]);
    db.raw.run(
      "INSERT INTO tasks (title, day, sort, created_at, updated_at) VALUES ('new', '2026-11-08', 0, 1, 1)",
    );
    expect(db.raw.exec("SELECT id FROM tasks WHERE title = 'new'")[0]!.values).toEqual([[8]]);
    expect(db.raw.exec('SELECT intention, outcome, task_id FROM sessions')[0]!.values).toEqual([
      [null, null, 7],
    ]);
    expect(
      db.raw.exec(
        'SELECT id, pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status, task_text FROM sessions',
      )[0]!.values,
    ).toEqual([[1, 'p1', 1, 1000, 1500001, 1500001, 1500000, 0, '2026-11-07', 'done', 'Lab 7']]);
    expect(db.raw.exec('SELECT text, colour, popped, x, y, scale, bare FROM notes')[0]!.values).toEqual([
      ['hello', 'yellow', 0, null, null, 1, 0],
    ]);
    db.raw.close();
  });

  it('v4 seeds the task sequence from the archive counter when no session names a higher id', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v3 = UP_TO_V3;
    const raw = new SQL.Database();
    await migrate(raw, null, NOW, v3);
    // Counter 5 (ids 4 and 5 deleted), max(id) 3, a session naming task 2.
    raw.exec(`
      INSERT INTO tasks (text, colour, sort, created_at)
        VALUES ('a', 'yellow', 0, 1), ('b', 'yellow', 1, 1), ('c', 'yellow', 2, 1), ('d', 'yellow', 3, 1), ('e', 'yellow', 4, 1);
      DELETE FROM tasks WHERE id IN (4, 5);
      INSERT INTO sessions (pomodoro_id, task_id, started_at, checkpoint_at, day_key, status)
        VALUES ('p1', 2, 1, 1, '2026-11-07', 'done');
    `);
    await migrate(raw, null, NOW, UP_TO_V4);
    expect(raw.exec("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'")[0]!.values).toEqual([[5]]);
    raw.close();

    // An empty v3 database starts the new tasks at 1.
    const empty = new SQL.Database();
    await migrate(empty, null, NOW, v3);
    await migrate(empty, null, NOW, UP_TO_V4);
    expect(empty.exec("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'")[0]!.values).toEqual([[0]]);
    empty.run("INSERT INTO tasks (title, list_id, sort, created_at, updated_at) VALUES ('t', 1, 0, 1, 1)");
    expect(empty.exec('SELECT id FROM tasks')[0]!.values).toEqual([[1]]);
    empty.close();
  });

  it('v4 seeds an Inbox first, then at most 19 lists from unarchived subjects in sort order, names cut to 60 chars', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(
      raw,
      null,
      NOW,
      MIGRATIONS.filter((m) => m.version <= 3),
    );
    for (let i = 0; i < 25; i++) {
      raw.run('INSERT INTO subjects (name, colour, archived, sort) VALUES (?, ?, ?, ?)', [
        i === 24 ? 'x'.repeat(80) : `S${i}`,
        '#000000',
        i === 1 ? 1 : 0,
        i === 24 ? -1 : i,
      ]);
    }
    await migrate(raw, null, NOW, UP_TO_V4);
    const rows = raw.exec('SELECT name, subject_id, sort FROM task_lists ORDER BY sort')[0]!.values;
    expect(rows).toHaveLength(20);
    expect(rows.slice(0, 4)).toEqual([
      ['Inbox', null, 0],
      ['x'.repeat(60), 25, 1],
      ['S0', 1, 2],
      ['S2', 3, 3],
    ]);
    expect(rows.map((r) => r[2])).toEqual([...Array(20).keys()]);
    // 24 unarchived subjects, 19 lists: the last in sort order are the ones left out.
    expect(rows[19]).toEqual(['S18', 19, 19]);
    expect(rows.filter((r) => r[1] === null)).toHaveLength(1);
    raw.close();
  });

  it('the v4 tasks table enforces one placement, kind and colour; outcome is checked', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(raw, null, NOW, UP_TO_V4);
    const task = (cols: string, vals: string) =>
      raw.run(
        `INSERT INTO tasks (title, sort, created_at, updated_at, ${cols}) VALUES ('t', 0, 1, 1, ${vals})`,
      );
    task('day', "'2026-11-08'");
    task('list_id', '1');
    task('day, kind, colour', "'2026-11-08', 'revision', 'green'");
    expect(raw.exec('SELECT kind, colour, note, done FROM tasks ORDER BY id')[0]!.values).toEqual([
      ['task', null, '', 0],
      ['task', null, '', 0],
      ['revision', 'green', '', 0],
    ]);
    expect(() => task('day, list_id', "'2026-11-08', 1")).toThrow();
    expect(() =>
      raw.run("INSERT INTO tasks (title, sort, created_at, updated_at) VALUES ('t', 0, 1, 1)"),
    ).toThrow();
    expect(() => task('day, kind', "'2026-11-08', 'x'")).toThrow();
    expect(() => task('day, colour', "'2026-11-08', 'orange'")).toThrow();

    raw.run(
      "INSERT INTO sessions (pomodoro_id, started_at, checkpoint_at, day_key, status) VALUES ('p', 1, 1, '2026-11-08', 'done')",
    );
    raw.run("UPDATE sessions SET outcome = 'partly'");
    expect(() => raw.run("UPDATE sessions SET outcome = 'maybe'")).toThrow();
    expect(raw.exec('SELECT outcome FROM sessions')[0]!.values).toEqual([['partly']]);

    const widget = (card: string, range: string) =>
      raw.run(
        `INSERT INTO stat_widgets (card, "range", x, y, created_at) VALUES ('${card}', '${range}', 0.5, 0.5, 1)`,
      );
    widget('goal', 'month');
    expect(raw.exec('SELECT card, "range", scale, bare FROM stat_widgets')[0]!.values).toEqual([
      ['goal', 'month', 1, 0],
    ]);
    expect(() => widget('total', 'year')).toThrow();
    expect(() => widget('x', 'week')).toThrow();

    const deadline = (kind: string) =>
      raw.run(
        `INSERT INTO deadlines (title, kind, due, created_at, updated_at) VALUES ('d', '${kind}', '2026-12-01', 1, 1)`,
      );
    deadline('exam');
    deadline('coursework');
    expect(raw.exec('SELECT note, done, subject_id FROM deadlines')[0]!.values).toEqual([
      ['', 0, null],
      ['', 0, null],
    ]);
    expect(() => deadline('essay')).toThrow();
    raw.close();
  });

  it('a v4 that fails after its last step leaves the v3 database as it was', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(
      raw,
      null,
      NOW,
      MIGRATIONS.filter((m) => m.version <= 3),
    );
    raw.exec(`
      INSERT INTO subjects (name, colour, archived, sort) VALUES ('Maths', '#ff0000', 0, 0);
      INSERT INTO tasks (text, colour, sort, created_at) VALUES ('A', 'yellow', 0, 1);
      INSERT INTO notes (text, colour, sort, created_at, updated_at) VALUES ('hello', 'yellow', 0, 1, 1);
    `);
    const v4 = MIGRATIONS.find((m) => m.version === 4)!;
    const failing = [
      ...MIGRATIONS.filter((m) => m.version <= 3),
      {
        version: 4,
        up(d: typeof raw) {
          v4.up(d);
          throw new Error('boom');
        },
      },
    ];
    await expect(migrate(raw, null, NOW, failing)).rejects.toThrow('boom');
    expect(schemaVersion(raw)).toBe(3);
    expect(
      raw.exec(
        "SELECT name FROM sqlite_master WHERE name IN ('tasks_v1_archive', 'task_lists', 'task_tags', 'subtasks', 'deadlines', 'stat_widgets')",
      ),
    ).toEqual([]);
    expect(raw.exec('SELECT text, colour FROM tasks')[0]!.values).toEqual([['A', 'yellow']]);
    expect(raw.exec("SELECT name, seq FROM sqlite_sequence WHERE name LIKE 'tasks%'")[0]!.values).toEqual([
      ['tasks', 1],
    ]);
    expect(
      raw.exec(
        "SELECT name FROM pragma_table_info('notes') WHERE name = 'popped' UNION ALL SELECT name FROM pragma_table_info('sessions') WHERE name = 'intention'",
      ),
    ).toEqual([]);

    // The untouched v3 database still migrates cleanly afterwards.
    await migrate(raw, null, NOW, UP_TO_V4);
    expect(schemaVersion(raw)).toBe(4);
    expect(raw.exec('SELECT text FROM tasks_v1_archive')[0]!.values).toEqual([['A']]);
    expect(raw.exec('SELECT name, subject_id, sort FROM task_lists ORDER BY sort')[0]!.values).toEqual([
      ['Inbox', null, 0],
      ['Maths', 1, 1],
    ]);
    raw.close();
  });

  // Simple tasks spec §3.4: the planner is archived untouched, the v1 stickies come back with their
  // ids, then every planner task as a sticky; sessions are byte-identical (appplan §5), and the
  // v4 database is backed up first (study-dev rule 2).
  it('v5 brings the v1 stickies and the planner tasks back as stickies, archives the planner, drops estimates widgets', async () => {
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v4 = new SQL.Database();
    await migrate(v4, null, NOW, UP_TO_V4);
    expect(schemaVersion(v4)).toBe(4);
    // List 1 is v4's Inbox. Task 10 has a null colour, 11 is done with no done_at, 12 is a list
    // task whose title is over 500 characters.
    v4.exec(`
      INSERT INTO tasks_v1_archive (id, text, colour, done, sort, created_at, done_at)
        VALUES (1, 'A', 'yellow', 0, 0, 101, NULL), (2, 'B', 'pink', 1, 1, 102, 50);
      INSERT INTO tasks (id, title, colour, day, list_id, done, done_at, sort, created_at, updated_at) VALUES
        (10, 'Day task', NULL, '2026-11-12', NULL, 0, NULL, 0, 110, 110),
        (11, 'Earlier', 'blue', '2026-11-10', NULL, 1, NULL, 0, 111, 77),
        (12, '${'x'.repeat(600)}', 'green', NULL, 1, 0, NULL, 0, 112, 112);
      INSERT INTO subtasks (task_id, text, sort) VALUES (10, 'Step one', 0);
      INSERT INTO task_tags (task_id, tag) VALUES (10, 'maths');
      INSERT INTO stat_widgets (card, "range", x, y, created_at)
        VALUES ('estimates', 'week', 0.2, 0.2, 1), ('goal', 'week', 0.6, 0.6, 1);
      INSERT INTO sessions (pomodoro_id, subject_id, task_id, task_text, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status, intention, outcome)
        VALUES ('p1', NULL, 40, 'Lab 7', 1000, 1500001, 1500001, 1500000, 2000, '2026-11-07', 'done', 'Finish the lab', 'partly');
    `);
    const countsBefore: Record<string, number> = {
      planner_tasks_v4_archive: countOf(v4, 'tasks'),
      task_lists_v4_archive: countOf(v4, 'task_lists'),
      task_tags_v4_archive: countOf(v4, 'task_tags'),
      subtasks_v4_archive: countOf(v4, 'subtasks'),
      tasks_v1_archive: countOf(v4, 'tasks_v1_archive'),
    };
    const sessionsBytes = (d: SqlJsDatabase) => JSON.stringify(all(d, 'SELECT * FROM sessions ORDER BY id'));
    const sessionsBytesBefore = sessionsBytes(v4);
    const plannerBefore = rowsOf(v4, 'SELECT * FROM tasks ORDER BY id');
    const v4Bytes = Buffer.from(v4.export());
    v4.close();
    writeFileSync(file, v4Bytes);

    const db = await openTestDb(dir);
    expect(db.recovered).toBe('ok');
    expect(schemaVersion(db.raw)).toBe(5);
    expect(columnsOf(db.raw, 'tasks')).toEqual([
      'id',
      'text',
      'colour',
      'done',
      'sort',
      'created_at',
      'done_at',
    ]);
    expect(rowsOf(db.raw, 'SELECT id, text, colour, done, sort, done_at FROM tasks ORDER BY sort')).toEqual([
      { id: 1, text: 'A', colour: 'yellow', done: 0, sort: 0, done_at: null },
      { id: 2, text: 'B', colour: 'pink', done: 1, sort: 1, done_at: 50 },
      { id: 11, text: 'Earlier', colour: 'blue', done: 1, sort: 2, done_at: 77 },
      { id: 10, text: 'Day task', colour: 'yellow', done: 0, sort: 3, done_at: null },
      { id: 12, text: 'x'.repeat(500), colour: 'green', done: 0, sort: 4, done_at: null },
    ]);
    expect(
      rowsOf(db.raw, 'SELECT id, created_at FROM tasks ORDER BY id').map((r) => [r.id, r.created_at]),
    ).toEqual([
      [1, 101],
      [2, 102],
      [10, 110],
      [11, 111],
      [12, 112],
    ]);
    for (const t of Object.keys(countsBefore)) expect(countOf(db.raw, t), t).toBe(countsBefore[t]);
    // The planner rows are archived as they were: the full 600-character title is kept there.
    expect(rowsOf(db.raw, 'SELECT * FROM planner_tasks_v4_archive ORDER BY id')).toEqual(plannerBefore);
    expect(rowsOf(db.raw, 'SELECT task_id, tag FROM task_tags_v4_archive')).toEqual([
      { task_id: 10, tag: 'maths' },
    ]);
    expect(rowsOf(db.raw, 'SELECT task_id, text FROM subtasks_v4_archive')).toEqual([
      { task_id: 10, text: 'Step one' },
    ]);
    expect(rowsOf(db.raw, 'SELECT card FROM stat_widgets')).toEqual([{ card: 'goal' }]);
    expect(sessionsBytes(db.raw)).toEqual(sessionsBytesBefore);
    const backup = join(dir, 'backups', 'pre-migration-v4-2026-11-08-120000.sqlite');
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup).equals(v4Bytes)).toBe(true);
    await db.close();
  });

  it('v5 sets the task sequence above every archived id and every sessions.task_id', async () => {
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v4 = async (seed: string) => {
      const raw = new SQL.Database();
      await migrate(raw, null, NOW, UP_TO_V4);
      raw.exec(seed);
      return raw;
    };
    // Planner sequence 30 (ids 29 and 30 deleted, so max(id) is 28), a session naming task 40.
    const planner = `
      INSERT INTO tasks (id, title, day, sort, created_at, updated_at)
        VALUES (28, 'kept', '2026-11-08', 0, 1, 1), (29, 'gone', '2026-11-08', 1, 1, 1), (30, 'gone', '2026-11-08', 2, 1, 1);
      DELETE FROM tasks WHERE id IN (29, 30);
    `;
    const withSession = await v4(`${planner}
      INSERT INTO sessions (pomodoro_id, task_id, started_at, checkpoint_at, day_key, status)
        VALUES ('p1', 40, 1, 1, '2026-11-07', 'done');
    `);
    writeFileSync(file, Buffer.from(withSession.export()));
    withSession.close();
    const db = await openTestDb(dir);
    expect(schemaVersion(db.raw)).toBe(5);
    expect(tasksRepo(db).create({ text: 'New', colour: 'yellow' }, NOW).id).toBe(41);
    await db.close();

    // No session above it: the planner's counter wins over its max(id).
    const plannerOnly = await v4(planner);
    await migrate(plannerOnly, null, NOW);
    plannerOnly.run("INSERT INTO tasks (text, colour, sort, created_at) VALUES ('t', 'yellow', 9, 1)");
    expect(rowsOf(plannerOnly, "SELECT id FROM tasks WHERE text = 't'")).toEqual([{ id: 31 }]);
    plannerOnly.close();

    // A done planner task keeps its own done_at when it has one.
    const doneAt = await v4(
      "INSERT INTO tasks (title, day, done, done_at, sort, created_at, updated_at) VALUES ('d', '2026-11-08', 1, 60, 0, 1, 90)",
    );
    await migrate(doneAt, null, NOW);
    expect(rowsOf(doneAt, 'SELECT done, done_at FROM tasks')).toEqual([{ done: 1, done_at: 60 }]);
    doneAt.close();

    // An empty v4 database starts the stickies at 1.
    const empty = await v4('');
    await migrate(empty, null, NOW);
    empty.run("INSERT INTO tasks (text, colour, sort, created_at) VALUES ('t', 'yellow', 0, 1)");
    expect(rowsOf(empty, 'SELECT id FROM tasks')).toEqual([{ id: 1 }]);
    empty.close();
  });

  it('a v3 database migrates through v4 and v5 with its stickies back once', async () => {
    const file = join(dir, DB_FILE);
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const v3 = new SQL.Database();
    await migrate(v3, null, NOW, UP_TO_V3);
    v3.exec(`
      INSERT INTO tasks (text, colour, done, sort, created_at, done_at)
        VALUES ('A', 'yellow', 0, 0, 101, NULL), ('B', 'pink', 1, 1, 102, 50);
    `);
    writeFileSync(file, Buffer.from(v3.export()));
    v3.close();

    const db = await openTestDb(dir);
    expect(schemaVersion(db.raw)).toBe(5);
    expect(
      rowsOf(db.raw, 'SELECT id, text, colour, done, sort, created_at, done_at FROM tasks ORDER BY id'),
    ).toEqual([
      { id: 1, text: 'A', colour: 'yellow', done: 0, sort: 0, created_at: 101, done_at: null },
      { id: 2, text: 'B', colour: 'pink', done: 1, sort: 1, created_at: 102, done_at: 50 },
    ]);
    expect(countOf(db.raw, 'planner_tasks_v4_archive')).toBe(0);
    expect(countOf(db.raw, 'tasks_v1_archive')).toBe(2);
    expect(readdirSync(join(dir, 'backups'))).toEqual(['pre-migration-v3-2026-11-08-120000.sqlite']);
    expect(tasksRepo(db).create({ text: 'C', colour: 'blue' }, NOW)).toMatchObject({ id: 3, sort: 2 });
    await db.close();
  });

  it('a v5 that fails after its last step leaves the v4 database as it was', async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const raw = new SQL.Database();
    await migrate(raw, null, NOW, UP_TO_V4);
    raw.exec(`
      INSERT INTO tasks_v1_archive (id, text, colour, sort, created_at) VALUES (1, 'A', 'yellow', 0, 1);
      INSERT INTO tasks (id, title, day, sort, created_at, updated_at) VALUES (5, 'Day task', '2026-11-08', 0, 1, 1);
      INSERT INTO stat_widgets (card, "range", x, y, created_at) VALUES ('estimates', 'week', 0.5, 0.5, 1);
    `);
    const sequenceBefore = rowsOf(raw, 'SELECT name, seq FROM sqlite_sequence ORDER BY name');
    const v5 = MIGRATIONS.find((m) => m.version === 5)!;
    const failing = [
      ...UP_TO_V4,
      {
        version: 5,
        up(d: typeof raw) {
          v5.up(d);
          throw new Error('boom');
        },
      },
    ];
    await expect(migrate(raw, null, NOW, failing)).rejects.toThrow('boom');
    expect(schemaVersion(raw)).toBe(4);
    expect(raw.exec("SELECT name FROM sqlite_master WHERE name LIKE '%_v4_archive'")).toEqual([]);
    expect(columnsOf(raw, 'tasks')).toContain('title');
    expect(rowsOf(raw, 'SELECT id, title FROM tasks')).toEqual([{ id: 5, title: 'Day task' }]);
    expect(countOf(raw, 'task_lists')).toBe(1);
    expect(rowsOf(raw, 'SELECT name, seq FROM sqlite_sequence ORDER BY name')).toEqual(sequenceBefore);
    expect(rowsOf(raw, 'SELECT card FROM stat_widgets')).toEqual([{ card: 'estimates' }]);

    // The untouched v4 database still migrates cleanly afterwards.
    await migrate(raw, null, NOW);
    expect(schemaVersion(raw)).toBe(5);
    expect(rowsOf(raw, 'SELECT id, text FROM tasks ORDER BY sort')).toEqual([
      { id: 1, text: 'A' },
      { id: 5, text: 'Day task' },
    ]);
    raw.close();
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
