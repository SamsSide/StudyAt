// "Corrupt, unresolved" kept in the fresh database's `meta` table (spec §3.3, R32). The fresh file
// is on disk before the corrupt dialog shows, so without this a kill, a Windows shutdown or a failed
// restore would relaunch onto an empty but valid database: no dialog, and the daily backup would
// start copying the empty file over the pre-corruption ones. Only "Start fresh" clears it; a
// restore that copies a good database in leaves it behind naturally.
import type { Database as SqlJsDatabase } from 'sql.js';
import type { Db } from './db';
import { one, run } from './sql';

const PENDING = 'corrupt_pending';
const RESTORE_FAILED = 'corrupt_restore_failed';

export interface CorruptState {
  /** The stamp of the set-aside file while the corrupt dialog is unresolved, else null. */
  pendingAt: number | null;
  /** A restore was started from the dialog and this file is still here, so it didn't finish. */
  restoreFailed: boolean;
}

/** On the corrupt path, after the fresh database is migrated (so `meta` exists). */
export function markCorruptPending(raw: SqlJsDatabase, corruptAt: number): void {
  run(raw, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [PENDING, String(corruptAt)]);
}

export function corruptState(raw: SqlJsDatabase): CorruptState {
  const pending = one(raw, 'SELECT value FROM meta WHERE key = ?', [PENDING]);
  const at = pending ? Number(pending.value) : NaN;
  return {
    pendingAt: Number.isFinite(at) ? at : null,
    restoreFailed: one(raw, 'SELECT 1 AS x FROM meta WHERE key = ?', [RESTORE_FAILED]) !== null,
  };
}

/**
 * Written and flushed before the dialog's restore closes the database: if the copy fails, the
 * relaunch finds it and the dialog says the last restore didn't finish.
 */
export async function markCorruptRestoreAttempt(db: Db): Promise<void> {
  run(db.raw, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [RESTORE_FAILED, '1']);
  await db.flushNow();
}

/** Sam chose "Start fresh": the fresh database becomes the real one. */
export async function resolveCorrupt(db: Db): Promise<void> {
  run(db.raw, 'DELETE FROM meta WHERE key IN (?, ?)', [PENDING, RESTORE_FAILED]);
  await db.flushNow();
}
