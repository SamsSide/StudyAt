// Schema migrations (spec §3.3, appplan §5). Every schema change is a new numbered entry here,
// with a test that migrates a fixture of the previous version. Never edit a shipped migration.
//
// Changing any DEFAULT_SETTINGS value (src/shared/settings.ts) needs a migration that pins the old
// value for existing users (`INSERT OR IGNORE` the old value as a settings row): a default must
// never silently change Sam's numbers (appplan §5). Seeding stores the timer and accounting keys
// only where missing, and runs after migrations, so the pinned old value wins (seed.ts).
import { dirname, join } from 'node:path';
import type { Database as SqlJsDatabase } from 'sql.js';
import { fileStamp } from './backup';
import { copyAtomic, nodeFs, type DbFs } from './db-fs';
import { one, transaction } from './sql';

export interface Migration {
  version: number;
  up(db: SqlJsDatabase): void;
}

export const MIGRATIONS: Migration[] = [
  {
    // v1: every table of spec §3.3. AUTOINCREMENT so a deleted id is never reused: sound ids are
    // referenced by chime settings and mixes, space ids by `activeSpaceId`.
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE subjects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          colour TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pomodoro_id TEXT NOT NULL,
          subject_id INTEGER NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER NULL,
          checkpoint_at INTEGER NOT NULL,
          focus_ms INTEGER NOT NULL DEFAULT 0,
          discarded_ms INTEGER NOT NULL DEFAULT 0,
          day_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'done'))
        );
        CREATE INDEX sessions_day_key ON sessions (day_key);
        CREATE INDEX sessions_status ON sessions (status);
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          colour TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          sort INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          done_at INTEGER NULL
        );
        CREATE TABLE spaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'youtube')),
          name TEXT NOT NULL,
          source TEXT NOT NULL,
          thumb TEXT NULL,
          favourite INTEGER NOT NULL DEFAULT 0,
          builtin INTEGER NOT NULL DEFAULT 0,
          opts TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE sounds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('noise', 'file')),
          source TEXT NOT NULL,
          builtin INTEGER NOT NULL DEFAULT 0,
          sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE mixes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          levels TEXT NOT NULL
        );
        CREATE TABLE recaps (
          week_start TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          shown_at INTEGER NULL
        );
      `);
    },
  },
  {
    // v2: sticky notes for the Notes widget (widgets addendum §4b). The colours are the six task
    // colours (`TaskColour`); text is capped at 5000 chars by notesRepo.
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL DEFAULT '',
          colour TEXT NOT NULL DEFAULT 'yellow'
            CHECK (colour IN ('yellow', 'pink', 'blue', 'green', 'purple', 'grey')),
          sort INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // v3 (v1.1 spec §5): the task a session row was studied for, kept as id and text so the text
    // survives the task's deletion; existing rows get a NULL task, so history is unchanged. And the
    // image widgets: x, y are fractions 0..1, scale 0.5..2, both clamped by imagesRepo.
    version: 3,
    up(db) {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN task_id INTEGER NULL;
        ALTER TABLE sessions ADD COLUMN task_text TEXT NULL;
        CREATE TABLE images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ext TEXT NOT NULL CHECK (ext IN ('gif', 'png', 'jpg', 'webp')),
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          source_url TEXT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          scale REAL NOT NULL DEFAULT 1,
          bare INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.length;

/**
 * The database was written by a newer StudyAt (its `schema_version` is above what this build
 * knows). Nothing is migrated, backed up or written; the caller shows a dialog and quits.
 */
export class NewerSchemaError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`The database is schema version ${found}; this StudyAt supports up to ${supported}.`);
    this.name = 'NewerSchemaError';
  }
}

/** The stored `schema_version`; 0 for a file with no schema yet. */
export function schemaVersion(db: SqlJsDatabase): number {
  const hasMeta = one(db, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  if (!hasMeta) return 0;
  const row = one(db, "SELECT value FROM meta WHERE key = 'schema_version'");
  return row ? Number(row.value) : 0;
}

/**
 * Brings `db` up to the latest version. If anything is pending and `file` (the file `db` was read
 * from; null for a database made fresh in memory) exists, it is first copied to
 * `backups/pre-migration-v<from>-<stamp>.sqlite` beside it (study-dev rule 2). Each
 * migration runs in its own transaction and records its version, so a failure leaves the
 * database at the last version that completed. The caller flushes afterwards. Throws
 * `NewerSchemaError`, before touching anything, for a version newer than `migrations` knows.
 */
export async function migrate(
  db: SqlJsDatabase,
  file: string | null,
  now: number,
  migrations: Migration[] = MIGRATIONS,
  fs: DbFs = nodeFs,
): Promise<{ from: number; to: number }> {
  const from = schemaVersion(db);
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  if (from > latest) throw new NewerSchemaError(from, latest);
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { from, to: from };

  if (file !== null && (await fs.exists(file))) {
    const backups = join(dirname(file), 'backups');
    await fs.mkdir(backups);
    // Throws if the copy fails, so nothing is migrated without a backup.
    await copyAtomic(fs, file, join(backups, `pre-migration-v${from}-${fileStamp(now)}.sqlite`));
  }

  let to = from;
  for (const m of pending) {
    transaction(db, () => {
      m.up(db);
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(m.version)]);
    });
    to = m.version;
  }
  return { from, to };
}
