// The app lives in the tray for days, so "at launch" is not enough for the daily backup (study-dev
// rule 2) or for storing a finished week's recap (spec §3.5). An hourly check, and one on every
// resume and unlock, runs the backup when the local calendar date has changed since the last one,
// and computes pending recaps when the study day has changed. Never throws; failures are logged.
import { localDateKey } from './db/backup';

export const DATE_CHECK_MS = 3_600_000;

/** `powerMonitor`'s resume and unlock-screen events. */
interface PowerEvents {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

export interface DateWatchDeps {
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  power: PowerEvents;
  /** The local date of the launch backup, or null if it failed (the first check retries it). */
  lastBackupDay: string | null;
  /** The study-day key of a moment (the configured rollover); recaps were computed at launch. */
  studyDay: (now: number) => string;
  /** `dailyBackup(userData, now, { skip: corrupt still pending })`. */
  backup: (now: number) => Promise<void>;
  /** `recaps.computePending(now)`. */
  recaps: (now: number) => void;
  log: (msg: string, err: unknown) => void;
}

/** Starts the checks; returns the stop. */
export function watchDateChange(deps: DateWatchDeps): () => void {
  let backedUp = deps.lastBackupDay;
  let recapped = deps.studyDay(deps.now());
  let running = false;

  const check = (): void => {
    const now = deps.now();
    const day = localDateKey(now);
    if (day !== backedUp && !running) {
      running = true;
      // Recorded only once it succeeds, so a failure is retried at the next check. A backup that
      // throws before returning its promise is caught too, so `running` never sticks.
      new Promise<void>((resolve) => resolve(deps.backup(now)))
        .then(() => {
          backedUp = day;
        })
        .catch((err: unknown) => deps.log('StudyAt: daily backup failed', err))
        .finally(() => {
          running = false;
        });
    }
    const studyDay = deps.studyDay(now);
    if (studyDay !== recapped) {
      recapped = studyDay;
      try {
        deps.recaps(now);
      } catch (err) {
        deps.log('StudyAt: computing weekly recaps failed', err);
      }
    }
  };

  const handle = deps.setInterval(check, DATE_CHECK_MS);
  deps.power.on('resume', check);
  deps.power.on('unlock-screen', check);
  return () => {
    deps.clearInterval(handle);
    deps.power.removeListener('resume', check);
    deps.power.removeListener('unlock-screen', check);
  };
}
