// The read-only calendar agenda (widgets addendum §2): fetch each of Sam's private iCal addresses
// (https only, 10 s deadline), parse with ical.js, expand recurrences (RRULE incl. COUNT, UNTIL and
// BYDAY; EXDATE; RECURRENCE-ID overrides) into the window from local today 00:00 to seven days on,
// and return at most 50 occurrences sorted by start. A calendar that can't be fetched or parsed
// keeps its last good events and the agenda is `stale`. The URLs are secrets: never logged, never
// put in an error, never in the result.
//
// Parsing is synchronous (ical.js has no async API); the body is capped and each series is
// expanded at most MAX_OCCURRENCES steps, so one refresh can't hold the main process for long
// (R26).
import ICAL from 'ical.js';
import type { CalendarAgenda, CalendarEvent } from '../../shared/widgets';
import { getText, WIDGET_FETCH_TIMEOUT_MS } from './fetch-timeout';

export const AGENDA_DAYS = 7;
export const AGENDA_MAX_EVENTS = 50;
/** Colours for calendars that have none of their own, by position (the subject colours). */
export const CALENDAR_PALETTE = ['#7c9cff', '#5ccfb0', '#f2b45c', '#e57aa8', '#9ad06b'] as const;
export const DEFAULT_CALENDAR_NAME = 'Calendar';

const MAX_BODY = 5 * 1024 * 1024;
const MAX_OCCURRENCES = 5_000;
const UNTITLED = '(No title)';

export interface CalendarSource {
  url: string;
  /** Overrides the calendar's own X-WR-CALNAME. */
  name?: string;
  /** Falls back to CALENDAR_PALETTE by position when missing or empty. */
  colour?: string;
}

export interface CalendarDeps {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs?: number;
  /** IANA zone for "local" (all-day and floating times, the window); the system zone by default. */
  timeZone?: string;
}

export interface CalendarService {
  /** Never rejects. `cache` is the last agenda this service returned (or one loaded from settings). */
  agenda(sources: CalendarSource[], cache: CalendarAgenda | null): Promise<CalendarAgenda>;
  /** Display names and colours from the last `agenda` call, one per source, for `calendar.status()`. */
  calendars(): { name: string; colour: string }[];
}

// ---- time zones -------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isTimeZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `tz` at `ts`, as if it were UTC. */
function wallClock(ts: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(ts)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(
    p.year ?? NaN,
    (p.month ?? NaN) - 1,
    p.day ?? NaN,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
}

/** The instant a wall-clock time in `tz` happens; a time skipped by DST lands just after the gap. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = wall - (wallClock(wall, tz) - wall);
  const offset = wallClock(first, tz) - first;
  return wall - offset;
}

/** [start, end) of the agenda: local today 00:00 to 00:00 seven calendar days later. */
export function agendaWindow(now: number, tz: string): { start: number; end: number } {
  const today = new Date(wallClock(now, tz));
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const later = new Date(Date.UTC(y, m - 1, d) + AGENDA_DAYS * DAY_MS);
  return {
    start: zonedToUtc(y, m, d, 0, 0, 0, tz),
    end: zonedToUtc(later.getUTCFullYear(), later.getUTCMonth() + 1, later.getUTCDate(), 0, 0, 0, tz),
  };
}

/**
 * An ical.js time as epoch ms. Dates (all-day) are local midnight. A date-time with a known zone
 * (UTC, or a VTIMEZONE in the file) uses it; a TZID without a VTIMEZONE falls back to the IANA zone
 * of that name; anything else is floating, so local.
 */
function toMs(t: ICAL.Time, tzid: string | null, tz: string): number {
  if (t.isDate) return zonedToUtc(t.year, t.month, t.day, 0, 0, 0, tz);
  const zone = t.zone as ICAL.Timezone | undefined;
  if (zone && zone.tzid !== 'floating') return t.toUnixTime() * 1000;
  const wallZone = tzid !== null && isTimeZone(tzid) ? tzid : tz;
  return zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, wallZone);
}

// ---- parsing ----------------------------------------------------------------------------------

const tzidOf = (comp: ICAL.Component, prop: string): string | null => {
  const value = comp.getFirstProperty(prop)?.getParameter('tzid');
  return typeof value === 'string' ? value : null;
};

const textOf = (comp: ICAL.Component, prop: string): string | null => {
  const value = comp.getFirstPropertyValue(prop);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

const isCancelled = (comp: ICAL.Component): boolean => textOf(comp, 'status')?.toUpperCase() === 'CANCELLED';

/**
 * Where to start expanding a long-running series. A daily or weekly RRULE without COUNT repeats
 * whole periods, so starting a whole number of periods later (same weekday, same wall time) gives
 * the same occurrences from there on: a daily event since 2015 then costs a few steps, not
 * thousands. The new start stays at least one period plus the event's length before the window,
 * so the start itself (always emitted, even off-pattern) can't land inside it. Everything else
 * expands from DTSTART.
 */
function seriesStart(
  comp: ICAL.Component,
  event: ICAL.Event,
  startMs: number,
  window: { start: number },
): ICAL.Time | undefined {
  const rules = comp.getAllProperties('rrule');
  if (rules.length !== 1) return undefined;
  const rule = rules[0]?.getFirstValue();
  if (!(rule instanceof ICAL.Recur) || rule.count !== null) return undefined;
  if (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY') return undefined;
  const periodDays = Math.max(1, rule.interval || 1) * (rule.freq === 'WEEKLY' ? 7 : 1);
  const lengthDays = Math.ceil(event.duration.toSeconds() / 86_400);
  const spareDays = Math.floor((window.start - startMs) / DAY_MS) - lengthDays - periodDays - 1;
  const periods = Math.floor(spareDays / periodDays);
  if (periods < 1) return undefined;
  return event.startDate.clone().adjust(periods * periodDays, 0, 0, 0);
}

interface Parsed {
  name: string | null;
  /** Occurrences in the window, ids prefixed with the calendar's position. */
  events: Omit<CalendarEvent, 'calendar' | 'colour'>[];
}

/** Parses one iCal body and expands it into `window`. Throws on anything that isn't a calendar. */
export function parseCalendar(
  ics: string,
  window: { start: number; end: number },
  tz: string,
  prefix: string,
): Parsed {
  const jcal: unknown = ICAL.parse(ics);
  const roots = (Array.isArray(jcal) && Array.isArray(jcal[0]) ? jcal : [jcal]) as unknown[];
  const calendars = roots
    .map((root) => new ICAL.Component(root as unknown[]))
    .filter((c) => c.name === 'vcalendar');
  if (calendars.length === 0) throw new Error('not a calendar');

  const name = calendars.map((c) => textOf(c, 'x-wr-calname')).find((n) => n !== null) ?? null;
  const vevents = calendars.flatMap((c) => c.getAllSubcomponents('vevent'));
  const events: Parsed['events'] = [];

  const push = (comp: ICAL.Component, start: number, end: number, allDay: boolean, idTime: string): void => {
    if (start >= window.end || end <= window.start) return;
    const uid = textOf(comp, 'uid') ?? `${start}`;
    events.push({
      id: `${prefix}:${uid}:${idTime}`,
      title: textOf(comp, 'summary') ?? UNTITLED,
      start,
      end: Math.max(end, start),
      allDay,
      location: textOf(comp, 'location'),
    });
  };

  // Overrides (RECURRENCE-ID) stand alone; their master skips the occurrence they replace.
  const overridden = new Map<string, Set<number>>();
  for (const comp of vevents) {
    const rid = comp.getFirstPropertyValue('recurrence-id');
    const uid = textOf(comp, 'uid');
    if (!(rid instanceof ICAL.Time) || uid === null) continue;
    const set = overridden.get(uid) ?? new Set<number>();
    set.add(toMs(rid, tzidOf(comp, 'recurrence-id'), tz));
    overridden.set(uid, set);
  }

  for (const comp of vevents) {
    if (isCancelled(comp)) continue;
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(comp);
    } catch {
      continue;
    }
    if (!(comp.getFirstPropertyValue('dtstart') instanceof ICAL.Time)) continue;
    const startTzid = tzidOf(comp, 'dtstart');
    const allDay = event.startDate.isDate;

    if (event.isRecurrenceException() || !event.isRecurring()) {
      const start = toMs(event.startDate, startTzid, tz);
      const end =
        comp.hasProperty('dtend') || comp.hasProperty('duration')
          ? toMs(event.endDate, tzidOf(comp, 'dtend') ?? startTzid, tz)
          : start + (allDay ? DAY_MS : 0);
      const idTime = event.isRecurrenceException()
        ? event.recurrenceId.toString()
        : event.startDate.toString();
      push(comp, start, end, allDay, idTime);
      continue;
    }

    const skip = overridden.get(event.uid) ?? new Set<number>();
    const iterator = event.iterator(seriesStart(comp, event, toMs(event.startDate, startTzid, tz), window));
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = iterator.next();
      if (!next) break;
      const start = toMs(next, startTzid, tz);
      if (start >= window.end) break;
      if (skip.has(start)) continue;
      const details = event.getOccurrenceDetails(next);
      push(
        comp,
        start,
        toMs(details.endDate, tzidOf(comp, 'dtend') ?? startTzid, tz),
        allDay,
        next.toString(),
      );
    }
  }
  return { name, events };
}

// ---- the service ------------------------------------------------------------------------------

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

const byStart = (a: CalendarEvent, b: CalendarEvent): number =>
  a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.end - b.end || a.title.localeCompare(b.title);

export function createCalendarService(deps: CalendarDeps): CalendarService {
  const timeoutMs = deps.timeoutMs ?? WIDGET_FETCH_TIMEOUT_MS;
  const tz = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let known: { name: string; colour: string }[] = [];

  return {
    calendars: () => known.map((c) => ({ ...c })),

    async agenda(sources, cache) {
      if (sources.length === 0) {
        known = [];
        return { state: 'unconfigured', fetchedAt: null, events: [] };
      }
      const now = deps.now();
      const window = agendaWindow(now, tz);

      const results = await Promise.all(
        sources.map(async (source, index): Promise<Parsed | null> => {
          if (!isHttps(source.url)) return null;
          try {
            const body = await getText(deps.fetch, source.url, timeoutMs, MAX_BODY);
            return parseCalendar(body, window, tz, String(index));
          } catch {
            return null;
          }
        }),
      );

      const events: CalendarEvent[] = [];
      let failed = 0;
      const previous = known;
      known = sources.map((source, index) => {
        const result = results[index] ?? null;
        const colour = source.colour?.trim() || CALENDAR_PALETTE[index % CALENDAR_PALETTE.length]!;
        const name = source.name?.trim() || result?.name || previous[index]?.name || DEFAULT_CALENDAR_NAME;
        if (result) {
          for (const e of result.events) events.push({ ...e, calendar: name, colour });
        } else {
          failed++;
          // Keep this calendar's last good events that still fall in today's window.
          for (const e of cache?.events ?? []) {
            if (e.id.startsWith(`${index}:`) && e.end > window.start && e.start < window.end) events.push(e);
          }
        }
        return { name, colour };
      });

      events.sort(byStart);
      const capped = events.slice(0, AGENDA_MAX_EVENTS);
      if (failed === 0) return { state: 'ok', fetchedAt: now, events: capped };
      if (failed === sources.length && capped.length === 0 && !cache) {
        return { state: 'error', fetchedAt: null, events: [] };
      }
      return { state: 'stale', fetchedAt: cache?.fetchedAt ?? null, events: capped };
    },
  };
}
