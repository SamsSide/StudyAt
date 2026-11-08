// Day keys and day-key arithmetic (spec §3.4 rule 8, §3.5; appplan §5). Pure: time comes in as a
// parameter, never from the system clock.
//
// A day key is a local calendar date `YYYY-MM-DD`, shifted back one day before the rollover hour
// (default 04:00), so a late-night session belongs to the evening it started in. Arithmetic on
// keys is plain calendar arithmetic (done in UTC), so DST changes can't make a day 23 or 25 hours.

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string | undefined): Intl.DateTimeFormat {
  const cacheKey = tz ?? '';
  let f = formatters.get(cacheKey);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(cacheKey, f);
  }
  return f;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function toKey(utcMs: number): string {
  const d = new Date(utcMs);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

function fromKey(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y ?? NaN, (m ?? NaN) - 1, d ?? NaN);
}

/**
 * The day key `ts` is credited to: its local date, or the date before if the local hour is
 * before `rolloverHour`. `tz` is an IANA zone for tests; the app uses the system zone.
 */
export function dayKeyOf(ts: number, rolloverHour: number, tz?: string): string {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(ts)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const date = Date.UTC(parts.year ?? NaN, (parts.month ?? NaN) - 1, parts.day ?? NaN);
  return toKey((parts.hour ?? 0) < rolloverHour ? date - DAY_MS : date);
}

export function addDays(dayKey: string, n: number): string {
  return toKey(fromKey(dayKey) + n * DAY_MS);
}

/** Whole days from `a` to `b` (negative if `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromKey(b) - fromKey(a)) / DAY_MS);
}

/** The Monday of `dayKey`'s week (weeks run Monday to Sunday). */
export function weekStartOf(dayKey: string): string {
  const sinceMonday = (new Date(fromKey(dayKey)).getUTCDay() + 6) % 7;
  return addDays(dayKey, -sinceMonday);
}
