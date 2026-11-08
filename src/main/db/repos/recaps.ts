// Stored weekly recaps (spec §3.5), keyed by the Monday day-key of the week.
import type { WeeklyRecap } from '../../../shared/types';
import type { Db } from '../db';
import { all, intOrNull, json, one, type Row } from '../sql';

export interface StoredRecap {
  recap: WeeklyRecap;
  shownAt: number | null;
}

export interface RecapsRepo {
  /** Oldest week first. */
  list(): WeeklyRecap[];
  get(weekStart: string): StoredRecap | null;
  /** Inserts or replaces the recap data; `shownAt` is kept. */
  upsert(recap: WeeklyRecap): void;
  markShown(weekStart: string, at: number): void;
}

const toRecap = (r: Row): WeeklyRecap | null => json<WeeklyRecap | null>(r.data, null);

export function recapsRepo(db: Db): RecapsRepo {
  return {
    list: () => all(db.raw, 'SELECT data FROM recaps ORDER BY week_start').map(toRecap).filter((r): r is WeeklyRecap => r !== null),
    get(weekStart) {
      const r = one(db.raw, 'SELECT data, shown_at FROM recaps WHERE week_start = ?', [weekStart]);
      if (!r) return null;
      const recap = toRecap(r);
      return recap === null ? null : { recap, shownAt: intOrNull(r.shown_at) };
    },
    upsert(recap) {
      db.raw.run(
        `INSERT INTO recaps (week_start, data, shown_at) VALUES (?, ?, NULL)
         ON CONFLICT (week_start) DO UPDATE SET data = excluded.data`,
        [recap.weekStart, JSON.stringify(recap)],
      );
      db.markDirty();
    },
    markShown(weekStart, at) {
      db.raw.run('UPDATE recaps SET shown_at = ? WHERE week_start = ?', [at, weekStart]);
      db.markDirty();
    },
  };
}
