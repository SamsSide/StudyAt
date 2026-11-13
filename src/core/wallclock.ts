// Local wall time helpers (spec §3.6, §3.10). Nothing here reads the system clock.

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local ms of `date` ('YYYY-MM-DD') at `hhmm`; the platform resolves DST. */
export function wallMs(date: string, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y ?? NaN, (m ?? NaN) - 1, d ?? NaN, h ?? NaN, mi ?? NaN).getTime();
}

/** 'YYYY-MM-DDTHH:MM' (local) to ms. */
export function parseDue(due: string): number {
  const [date = '', time = ''] = due.split('T');
  return wallMs(date, time);
}

/** ms to the local calendar date 'YYYY-MM-DD'. */
export function calendarDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ms to 'YYYY-MM-DDTHH:MM' in local time. */
export function wallStamp(ms: number): string {
  const d = new Date(ms);
  return `${calendarDate(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
