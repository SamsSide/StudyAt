import { addDays } from '../time';
import { wallMs } from '../wallclock';

export const REMINDER_LATE_MS = 60 * 60_000;
export const REMINDER_CHECK_MS = 30_000;
export const reminderTitle = (title: string): string => `Reminder · ${title}`;

/** Spec §3.6: the wall time of `reminder` on study day `day`; before `rolloverHour` it is the next calendar date. */
export function reminderAt(day: string, reminder: string, rolloverHour: number): number {
  const hour = Number(reminder.split(':')[0]);
  return wallMs(hour < rolloverHour ? addDays(day, 1) : day, reminder);
}

/** Due reminders: `fire` (≤ 60 min late) and `drop` (later); tasks done, reminded for their day or not yet due are left. */
export function dueReminders(
  tasks: readonly { id: number; day: string | null; reminder: string | null; remindedDay: string | null; done: boolean }[],
  now: number, rolloverHour: number,
): { fire: number[]; drop: number[] } {
  const fire: number[] = [];
  const drop: number[] = [];
  for (const t of tasks) {
    if (t.done || t.day === null || t.reminder === null || t.remindedDay === t.day) continue;
    const late = now - reminderAt(t.day, t.reminder, rolloverHour);
    if (!Number.isFinite(late) || late < 0) continue;
    (late <= REMINDER_LATE_MS ? fire : drop).push(t.id);
  }
  return { fire, drop };
}
