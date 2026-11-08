// Focus sessions (spec §3.3, §3.4; appplan §5). Rows are created only by the timer: there is no
// way here to add time, and an edit can change only the subject or delete the row (rule 10).
//
// Flushing: these methods only `markDirty()` (a write within 500 ms). Session start, checkpoint,
// stop and quit must reach the disk immediately (spec §3.3, ≤ 15 s lost on a crash), so the caller
// awaits `db.flushNow()` after `insertRunning`, `checkpoint` and `close`.
import type { SessionFilter } from '../../../shared/ipc';
import type { Session } from '../../../shared/types';
import type { Db } from '../db';
import { all, insert, int, intOrNull, one, run, text, type Row } from '../sql';
import type { SqlValue } from 'sql.js';

/** Rows shorter than this are noise and are deleted when they end (spec §3.4 rule 6). */
export const MIN_SESSION_MS = 60_000;

export interface SessionsRepo {
  /** A new `running` row, checkpointed at its start (rule 1). */
  insertRunning(input: { pomodoroId: string; subjectId: number | null; startedAt: number; dayKey: string }): Session;
  /**
   * Records accrued focus time on a `running` row, and its discarded time when given (a discard on
   * the open row reaches the disk before the row closes); ignored once the row is done.
   */
  checkpoint(id: number, focusMs: number, at: number, discardedMs?: number): void;
  /** Ends a row (`status done`). May be called again on a done row to apply a late discard (rule 4). */
  close(id: number, endedAt: number, focusMs: number, discardedMs: number): void;
  /** Deletes a done row with `focusMs < minMs`; true if it was deleted. Running rows are never touched. */
  deleteIfShort(id: number, minMs?: number): boolean;
  listRunning(): Session[];
  /** By inclusive day-key range; `subjectId: null` means untagged only. Oldest first. */
  list(filter: SessionFilter): Session[];
  all(): Session[];
  updateSubject(id: number, subjectId: number | null): void;
  remove(id: number): void;
}

const toSession = (r: Row): Session => ({
  id: int(r.id),
  pomodoroId: text(r.pomodoro_id),
  subjectId: intOrNull(r.subject_id),
  startedAt: int(r.started_at),
  endedAt: intOrNull(r.ended_at),
  checkpointAt: int(r.checkpoint_at),
  focusMs: int(r.focus_ms),
  discardedMs: int(r.discarded_ms),
  dayKey: text(r.day_key),
  status: r.status === 'running' ? 'running' : 'done',
});

const ORDER = 'ORDER BY started_at, id';

export function sessionsRepo(db: Db): SessionsRepo {
  return {
    insertRunning({ pomodoroId, subjectId, startedAt, dayKey }) {
      const id = insert(
        db.raw,
        `INSERT INTO sessions (pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms, discarded_ms, day_key, status)
         VALUES (?, ?, ?, NULL, ?, 0, 0, ?, 'running')`,
        [pomodoroId, subjectId, startedAt, startedAt, dayKey],
      );
      db.markDirty();
      return toSession(one(db.raw, 'SELECT * FROM sessions WHERE id = ?', [id])!);
    },
    checkpoint(id, focusMs, at, discardedMs) {
      if (discardedMs === undefined) {
        run(db.raw, "UPDATE sessions SET focus_ms = ?, checkpoint_at = ? WHERE id = ? AND status = 'running'", [focusMs, at, id]);
      } else {
        run(db.raw, "UPDATE sessions SET focus_ms = ?, discarded_ms = ?, checkpoint_at = ? WHERE id = ? AND status = 'running'", [
          focusMs,
          discardedMs,
          at,
          id,
        ]);
      }
      db.markDirty();
    },
    close(id, endedAt, focusMs, discardedMs) {
      run(db.raw, "UPDATE sessions SET ended_at = ?, focus_ms = ?, discarded_ms = ?, status = 'done' WHERE id = ?", [
        endedAt,
        focusMs,
        discardedMs,
        id,
      ]);
      db.markDirty();
    },
    deleteIfShort(id, minMs = MIN_SESSION_MS) {
      const deleted = run(db.raw, "DELETE FROM sessions WHERE id = ? AND status = 'done' AND focus_ms < ?", [id, minMs]) > 0;
      if (deleted) db.markDirty();
      return deleted;
    },
    listRunning: () => all(db.raw, `SELECT * FROM sessions WHERE status = 'running' ${ORDER}`).map(toSession),
    list(filter) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.from !== undefined) {
        where.push('day_key >= ?');
        params.push(filter.from);
      }
      if (filter.to !== undefined) {
        where.push('day_key <= ?');
        params.push(filter.to);
      }
      if (filter.subjectId === null) where.push('subject_id IS NULL');
      else if (filter.subjectId !== undefined) {
        where.push('subject_id = ?');
        params.push(filter.subjectId);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return all(db.raw, `SELECT * FROM sessions ${clause} ${ORDER}`, params).map(toSession);
    },
    all: () => all(db.raw, `SELECT * FROM sessions ${ORDER}`).map(toSession),
    updateSubject(id, subjectId) {
      run(db.raw, 'UPDATE sessions SET subject_id = ? WHERE id = ?', [subjectId, id]);
      db.markDirty();
    },
    remove(id) {
      run(db.raw, 'DELETE FROM sessions WHERE id = ?', [id]);
      db.markDirty();
    },
  };
}
