// Display formatting for the Stats overlay and recaps (spec §3.5, §3.14). Dates are day keys
// (`YYYY-MM-DD`) main has already credited, so they are read as calendar dates, never through the
// local clock. Months and weekdays are spelt out here rather than via Intl: en-GB writes
// September as "Sept", and the spec's "d MMM" wants "Sep".
import { addDays } from '../../core/time';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parts(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

/** "2 Nov" */
export function formatDayMonth(dayKey: string): string {
  const { m, d } = parts(dayKey);
  return `${d} ${MONTHS[m - 1] ?? ''}`;
}

/** "2 Nov 2026" */
export function formatDate(dayKey: string): string {
  return `${formatDayMonth(dayKey)} ${parts(dayKey).y}`;
}

/** "Mon" */
export function formatWeekday(dayKey: string): string {
  const { y, m, d } = parts(dayKey);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** "Mon 2 Nov" */
export function formatDayLabel(dayKey: string): string {
  return `${formatWeekday(dayKey)} ${formatDayMonth(dayKey)}`;
}

/** The month's short name, for heatmap column labels. */
export function monthOf(dayKey: string): string {
  return MONTHS[parts(dayKey).m - 1] ?? '';
}

/** "2 Nov–8 Nov": a Monday-to-Sunday week. */
export function formatWeekRange(weekStart: string): string {
  return `${formatDayMonth(weekStart)}–${formatDayMonth(addDays(weekStart, 6))}`;
}

/** Spec §3.14 verbatim: "Your week: {d MMM}–{d MMM}". */
export function recapTitle(weekStart: string): string {
  return `Your week: ${formatWeekRange(weekStart)}`;
}

/** "+25%" / "−10%" (a true minus sign), or "—" when last week had nothing to compare with. */
export function formatDelta(pct: number | null): string {
  if (pct === null) return '—';
  return pct < 0 ? `−${Math.abs(pct)}%` : `+${pct}%`;
}

/** "1 day" / "9 days" */
export function formatDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** "14:05", local time, for a session's start and end. */
export function formatClockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Milliseconds as hours, for chart axes only; the labels people read use formatHm. */
export function toHours(ms: number): number {
  return ms / 3_600_000;
}
