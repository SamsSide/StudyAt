// Export, backups and restore (spec §3.3, §3.11; appplan §4.9). Exports are read-only snapshots;
// `spotifyTokens` never leaves main (study-dev rule 9). Restore never loses data: the timer is
// stopped and the database closed first, the current file is kept as a `pre-restore-` backup, the
// chosen backup is copied in atomically, and the app relaunches onto it.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupInfo } from '../../shared/types';
import { BACKUPS_DIR, DB_FILE, fileStamp, listBackups, localDateKey } from '../db/backup';
import type { Db } from '../db/db';
import { copyAtomic, nodeFs, type DbFs } from '../db/db-fs';
import { schemaVersion } from '../db/migrations';
import { deadlinesRepo } from '../db/repos/deadlines';
import { mixesRepo } from '../db/repos/mixes';
import { notesRepo } from '../db/repos/notes';
import { plannerTasksRepo } from '../db/repos/plannerTasks';
import { recapsRepo } from '../db/repos/recaps';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { soundsRepo } from '../db/repos/sounds';
import { spacesRepo } from '../db/repos/spaces';
import { subjectsRepo } from '../db/repos/subjects';
import { taskListsRepo } from '../db/repos/taskLists';
import { tasksRepo } from '../db/repos/tasks';
import { publicSettings } from './settings';
import { IpcValidationError } from './validate';

export interface DataServiceDeps {
  db: Db;
  /** The data folder holding `studyat.sqlite` and `backups/`. */
  dir: string;
  now: () => number;
  confirm(message: string, detail: string): Promise<boolean>;
  /** Stops the timer (closing its row) and closes the database, so nothing writes after the copy. */
  beforeRestore(): Promise<void>;
  app: { relaunch(): void; exit(code: number): void };
  fs?: DbFs;
}

export type DataService = ReturnType<typeof dataService>;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD HH:mm` (spec §3.11). */
export function localStamp(at: number): string {
  const d = new Date(at);
  return `${localDateKey(at)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One CSV record; fields with a comma, quote or line break are quoted. */
export function csvLine(fields: string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');
}

export const CSV_HEADER = 'date,start,end,minutes,subject';

export function dataService(deps: DataServiceDeps) {
  const fs = deps.fs ?? nodeFs;
  const { db } = deps;

  return {
    /**
     * Spec §3.11: everything Sam owns, settings without `spotifyTokens`. v1.2: `tasks` is the
     * planner's task table, `tasksV1` the old sticky-note rows archived by migration v4.
     */
    async exportJson(path: string): Promise<void> {
      const data = {
        exportedAt: deps.now(),
        schemaVersion: schemaVersion(db.raw),
        subjects: subjectsRepo(db).list(),
        sessions: sessionsRepo(db).all(),
        taskLists: taskListsRepo(db).list(),
        tasks: plannerTasksRepo(db).all(),
        deadlines: deadlinesRepo(db).all(),
        tasksV1: tasksRepo(db).list(),
        spaces: spacesRepo(db)
          .list()
          .map(({ missing: _missing, ...s }) => s),
        sounds: soundsRepo(db)
          .list()
          .map(({ missing: _missing, ...s }) => s),
        mixes: mixesRepo(db).list(),
        recaps: recapsRepo(db).list(),
        notes: notesRepo(db).list(),
        settings: publicSettings(settingsRepo(db).get()),
      };
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    },

    /**
     * Sessions only (spec §3.11): `date` is the day the row is credited to, times are local, a
     * running row ends at its last checkpoint, minutes to 1 dp. CRLF line ends, for Excel.
     */
    async exportCsv(path: string): Promise<void> {
      const names = new Map(
        subjectsRepo(db)
          .list()
          .map((s) => [s.id, s.name]),
      );
      const lines = [CSV_HEADER];
      for (const s of sessionsRepo(db).all()) {
        lines.push(
          csvLine([
            s.dayKey,
            localStamp(s.startedAt),
            localStamp(s.endedAt ?? s.checkpointAt),
            (s.focusMs / 60_000).toFixed(1),
            s.subjectId === null ? '' : (names.get(s.subjectId) ?? ''),
          ]),
        );
      }
      await writeFile(path, `${lines.join('\r\n')}\r\n`, 'utf8');
    },

    listBackups: (): Promise<BackupInfo[]> => listBackups(deps.dir),

    /**
     * Restores a backup named by `listBackups` (anything else is rejected, so no path reaches
     * here from the renderer). False if Sam cancels; once confirmed, the app always relaunches.
     */
    async restoreBackup(name: string): Promise<boolean> {
      const backup = (await listBackups(deps.dir)).find((b) => b.name === name);
      if (!backup) throw new IpcValidationError('No such backup');
      const ok = await deps.confirm(
        'Restore this backup?',
        `StudyAt will restart with the data from ${localStamp(backup.createdAt)}. Your current data is kept as a backup first.`,
      );
      if (!ok) return false;
      // If the shutdown itself fails the database keeps its unflushed data in memory so a later
      // close can retry: rethrow, with no copy, no relaunch and no exit.
      await deps.beforeRestore();
      // Once the timer is stopped and the database closed this process can't carry on, so it
      // always relaunches: onto the backup if the copy worked, onto the untouched original if not
      // (copyAtomic only replaces the file by rename). No safety copy, no restore.
      try {
        const file = join(deps.dir, DB_FILE);
        const backups = join(deps.dir, BACKUPS_DIR);
        if (await fs.exists(file))
          await copyAtomic(fs, file, join(backups, `pre-restore-${fileStamp(deps.now())}.sqlite`));
        await copyAtomic(fs, join(backups, name), file);
      } finally {
        deps.app.relaunch();
        deps.app.exit(0);
      }
      return true;
    },
  };
}
