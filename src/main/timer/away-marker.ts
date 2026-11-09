// The away marker (ruling R39, following Sam's A1 honesty default: no answer means discard). Once
// the idle threshold is crossed, the rows the away period can charge and their focus at its start
// are kept in `meta`, so a crash or power cut before the period is resolved recovers those rows
// without the away time. When Sam comes back and the prompt is raised, the marker is rewritten to
// the prompt's fixed per-row charges, so a crash then discards exactly the away time and keeps the
// focus earned after the return. Resolving the period (keep, discard, auto-discard, quit) clears it.
import type { Db } from '../db/db';
import { one, run } from '../db/sql';

export const AWAY_MARKER_KEY = 'away_open';

export type AwayMarker =
  | {
      /** When the away period began (`idle.since`). */
      since: number;
      /** Unnoticed period: each row it can charge, with its focus ms at `since`. */
      rows: Array<{ rowId: number; focusMsAtSince: number }>;
    }
  | {
      since: number;
      /** Prompt pending: the focus ms the period covered, per row (the prompt's charges). */
      charges: Array<{ rowId: number; ms: number }>;
    };

/** Marks the database dirty; the caller flushes it with the checkpoint. */
export function writeAwayMarker(db: Db, marker: AwayMarker): void {
  run(db.raw, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    AWAY_MARKER_KEY,
    JSON.stringify(marker),
  ]);
  db.markDirty();
}

export function clearAwayMarker(db: Db): void {
  if (run(db.raw, 'DELETE FROM meta WHERE key = ?', [AWAY_MARKER_KEY]) > 0) db.markDirty();
}

/** The stored marker, or null if there is none or it is unreadable. */
export function readAwayMarker(db: Db): AwayMarker | null {
  const row = one(db.raw, 'SELECT value FROM meta WHERE key = ?', [AWAY_MARKER_KEY]);
  if (!row) return null;
  try {
    const v: unknown = JSON.parse(String(row.value));
    if (typeof v !== 'object' || v === null) return null;
    const { since, rows, charges } = v as Record<string, unknown>;
    if (typeof since !== 'number') return null;
    if (Array.isArray(charges)) {
      const out: Array<{ rowId: number; ms: number }> = [];
      for (const { rowId, ms } of records(charges))
        if (Number.isInteger(rowId) && typeof ms === 'number' && ms >= 0)
          out.push({ rowId: rowId as number, ms });
      return { since, charges: out };
    }
    if (!Array.isArray(rows)) return null;
    const out: Array<{ rowId: number; focusMsAtSince: number }> = [];
    for (const { rowId, focusMsAtSince } of records(rows))
      if (Number.isInteger(rowId) && typeof focusMsAtSince === 'number' && focusMsAtSince >= 0)
        out.push({ rowId: rowId as number, focusMsAtSince });
    return { since, rows: out };
  } catch {
    return null;
  }
}

function records(list: unknown[]): Array<Record<string, unknown>> {
  return list.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
}
