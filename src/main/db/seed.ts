// First-run seeding (spec §3.3): the six subjects of §3.12, the built-in spaces (§3.8) and sounds
// (§3.9) from assets/builtin.json, the timer and accounting settings, and the active space. Each
// table is seeded only while empty; a stored setting is never overwritten. Seeded subjects also get
// one planner list each, after the Inbox list (v1.2 Plan notes 2).
import { INBOX_LIST_NAME, LIST_NAME_MAX } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { SEED_SUBJECTS } from '../../shared/subjects';
import type { Settings } from '../../shared/types';
import type { Db } from './db';
import { settingsRepo } from './repos/settings';
import { DEFAULT_SPACE_OPTS, youTubeThumb } from './repos/spaces';
import { insert, one, transaction } from './sql';

/** The shape of `assets/builtin.json`. Paths are relative to the assets folder, stored as given. */
export interface BuiltinAssets {
  spaces: { kind: 'youtube' | 'image'; name: string; source: string }[];
  sounds: { name: string; kind: 'noise' | 'file'; source: string }[];
}

/**
 * Settings stored explicitly at first seed (R17): the timer lengths and every value accounting,
 * streaks and stats read. Stored, not served live from DEFAULT_SETTINGS, so a later change to a
 * default never changes Sam's numbers; such a change also needs a migration (migrations.ts).
 */
const PINNED_SETTINGS: readonly (keyof Settings)[] = [
  'focusMinutes',
  'shortMinutes',
  'longMinutes',
  'longEvery',
  'streakMinutes',
  'goalMinutes',
  'rolloverHour',
  'idleMinutes',
];

const isEmpty = (db: Db, table: 'subjects' | 'spaces' | 'sounds'): boolean =>
  Number(one(db.raw, `SELECT count(*) AS n FROM ${table}`)!.n) === 0;

/**
 * The pinned settings are written from `DEFAULT_SETTINGS` where not already stored; every other
 * key is served by `settingsRepo.get` from `DEFAULT_SETTINGS` while unstored. `activeSpaceId` is
 * set to the first built-in space, only while it is null.
 */
export function seedIfEmpty(db: Db, builtin: BuiltinAssets, now: number): void {
  const raw = db.raw;
  transaction(raw, () => {
    if (isEmpty(db, 'subjects')) {
      // The Inbox list, then one planner list per seeded subject, as migration v4 gives an existing
      // database: on a fresh install v4 ran before there were subjects (v1.2 Plan notes 2). v4 has
      // already made the Inbox there, so it is added only when missing.
      const hasInbox = one(raw, 'SELECT 1 AS x FROM task_lists WHERE name = ? AND subject_id IS NULL', [
        INBOX_LIST_NAME,
      ]);
      if (!hasInbox) {
        raw.run('INSERT INTO task_lists (name, subject_id, sort, created_at) VALUES (?, NULL, 0, ?)', [
          INBOX_LIST_NAME,
          now,
        ]);
      }
      SEED_SUBJECTS.forEach((s, i) => {
        const subjectId = insert(
          raw,
          'INSERT INTO subjects (name, colour, archived, sort) VALUES (?, ?, 0, ?)',
          [s.name, s.colour, i],
        );
        raw.run('INSERT INTO task_lists (name, subject_id, sort, created_at) VALUES (?, ?, ?, ?)', [
          s.name.slice(0, LIST_NAME_MAX),
          subjectId,
          i + 1,
          now,
        ]);
      });
    }
    if (isEmpty(db, 'spaces')) {
      for (const s of builtin.spaces) {
        const thumb = s.kind === 'youtube' ? youTubeThumb(s.source) : null;
        raw.run(
          `INSERT INTO spaces (kind, name, source, thumb, favourite, builtin, opts, created_at)
           VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
          [s.kind, s.name, s.source, thumb, JSON.stringify(DEFAULT_SPACE_OPTS), now],
        );
      }
    }
    if (isEmpty(db, 'sounds')) {
      builtin.sounds.forEach((s, i) => {
        raw.run('INSERT INTO sounds (name, kind, source, builtin, sort) VALUES (?, ?, ?, 1, ?)', [
          s.name,
          s.kind,
          s.source,
          i,
        ]);
      });
    }
    for (const key of PINNED_SETTINGS) {
      raw.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [
        key,
        JSON.stringify(DEFAULT_SETTINGS[key]),
      ]);
    }
  });

  const settings = settingsRepo(db);
  if (settings.get().activeSpaceId === null) {
    const first = one(raw, 'SELECT id FROM spaces WHERE builtin = 1 ORDER BY id LIMIT 1');
    if (first) settings.set({ activeSpaceId: Number(first.id) });
  }
  db.markDirty();
}
