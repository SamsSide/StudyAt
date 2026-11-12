// Task reminders (v1.2 spec §3.6), scheduled in main so they fire while the window is hidden in the
// tray. A dated, open task with a reminder fires "Reminder · <title>" once per task-day: at launch
// and every REMINDER_CHECK_MS, reminders up to 60 min late fire and later ones are dropped, and both
// are marked with their day (`reminded_day`) so neither comes back. With `notifications` off they are
// marked and nothing shows. The clock is injected (study-dev rule 3).
import { dueReminders, REMINDER_CHECK_MS } from '../core/planner/reminders';
import { addDays, dayKeyOf } from '../core/time';
import type { Settings } from '../shared/types';
import type { Db } from './db/db';
import { plannerTasksRepo } from './db/repos/plannerTasks';
import { transaction } from './db/sql';

export interface RemindersDeps {
  db: Db;
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  settings: () => Pick<Settings, 'notifications' | 'rolloverHour'>;
  notify(taskId: number, title: string): void;
}

/** One pass: fires due reminders (≤ 60 min late) and drops later ones; both are marked for their day. */
export function checkReminders(deps: RemindersDeps): { fired: number[]; dropped: number[] } {
  const now = deps.now();
  const { notifications, rolloverHour } = deps.settings();
  const tasks = plannerTasksRepo(deps.db);
  // A reminder on study day D lands within [D at the rollover, D + 1 at the rollover), so only
  // yesterday's and today's can be due and ≤ 60 min late; anything older was dropped long ago or
  // can only ever be dropped, and is left alone.
  const today = dayKeyOf(now, rolloverHour);
  const rows = tasks.withReminders(addDays(today, -1), today);
  const { fire, drop } = dueReminders(rows, now, rolloverHour);
  if (fire.length === 0 && drop.length === 0) return { fired: [], dropped: [] };

  const byId = new Map(rows.map((r) => [r.id, r]));
  // Marked before anything shows: a reminder fires at most once per task-day, even if showing it fails.
  transaction(deps.db.raw, () => {
    for (const id of [...fire, ...drop]) tasks.update(id, { remindedDay: byId.get(id)?.day ?? null }, now);
  });
  if (notifications) {
    for (const id of fire) {
      try {
        deps.notify(id, byId.get(id)?.title ?? '');
      } catch (err) {
        console.error('StudyAt: a reminder could not be shown', err);
      }
    }
  }
  return { fired: fire, dropped: drop };
}

/** Checks now and every REMINDER_CHECK_MS; returns the stop. */
export function startReminders(deps: RemindersDeps): () => void {
  const check = (): void => {
    try {
      checkReminders(deps);
    } catch (err) {
      console.error('StudyAt: checking reminders failed', err);
    }
  };
  check();
  const handle = deps.setInterval(check, REMINDER_CHECK_MS);
  return () => deps.clearInterval(handle);
}

/**
 * A study day starting (at launch, on a rollover, on resume): one reminder pass, then `roll`. The
 * order matters: rolling forward moves a task to today and its reminder with it, so yesterday's
 * reminder (03:30 with the rollover at 4, seen at 04:15) must fire or be dropped first. A failing
 * pass is logged and never stops the roll.
 */
export function startOfStudyDay(deps: RemindersDeps, roll: () => void): void {
  try {
    checkReminders(deps);
  } catch (err) {
    console.error('StudyAt: checking reminders failed', err);
  }
  roll();
}
