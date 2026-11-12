// Planner display helpers (v1.2 spec §3.7). Pure; day keys are strings, never Date arithmetic.
import { addDays, dayKeyOf, daysBetween, weekStartOf } from '../../core/time';
import { parseDue } from '../../core/wallclock';
import type { PlannerTask } from '../../shared/types';
import { formatDayLabel } from '../stats/format';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The planner's today: the same study day the stats use. */
export function plannerToday(rolloverHour: number, now?: number): string {
  return dayKeyOf(now ?? Date.now(), rolloverHour);
}

/** The study day a deadline's due time falls on (rollover applied), never `due.slice(0, 10)`. */
export function deadlineDayKey(due: string, rolloverHour: number): string {
  return dayKeyOf(parseDue(due), rolloverHour);
}

/** "45m", "1h", "1h 30m". */
function minutesText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "32m / 45m"; `over` once the focus time passes the estimate (shown amber). */
export function estimateChip(actualMs: number, estimateMin: number): { text: string; over: boolean } {
  const actualMin = Math.floor(actualMs / 60_000);
  return {
    text: `${minutesText(actualMin)} / ${minutesText(estimateMin)}`,
    over: actualMs > estimateMin * 60_000,
  };
}

/** "2/5", or null when the task has no subtasks. */
export function subtaskCount(t: PlannerTask): string | null {
  if (t.subtasks.length === 0) return null;
  return `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`;
}

/** "from Tue 10 Nov". */
export function rolledLabel(day: string): string {
  return `from ${formatDayLabel(day)}`;
}

/** "November 2026 W46": the month, year and ISO week of the week's Thursday. */
export function boardTitle(day: string): string {
  const thursday = addDays(weekStartOf(day), 3);
  const [y = '0', m = '1'] = thursday.split('-');
  const week = Math.floor(daysBetween(`${y}-01-01`, thursday) / 7) + 1;
  return `${MONTHS[Number(m) - 1] ?? ''} ${y} W${String(week).padStart(2, '0')}`;
}

/** "November 2026" for 'YYYY-MM'. */
export function monthTitle(month: string): string {
  const [y = '0', m = '1'] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}
