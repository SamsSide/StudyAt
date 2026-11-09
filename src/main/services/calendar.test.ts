import { describe, expect, it, vi } from 'vitest';
import type { CalendarAgenda } from '../../shared/widgets';
import { agendaWindow, CALENDAR_PALETTE, createCalendarService, zonedToUtc } from './calendar';

const TZ = 'Europe/London';
// Monday 9 November 2026, 10:00 in London (GMT). The window runs to Monday 16 November 00:00.
const NOW = Date.UTC(2026, 10, 9, 10, 0);
const UNI_URL = 'https://example.invalid/calendar/uni-secret/basic.ics';
const HOME_URL = 'https://example.invalid/calendar/home-secret/basic.ics';

const ics = (...lines: string[]): string => [...lines].join('\r\n');

const LONDON_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const UNI = ics(
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'X-WR-CALNAME:Uni',
  ...LONDON_VTIMEZONE,
  // Weekly lecture Mon/Wed/Thu at 09:00 London, Thursday 12th cancelled, Monday 9th moved to 11:00.
  'BEGIN:VEVENT',
  'UID:lecture@example.invalid',
  'DTSTART;TZID=Europe/London:20261012T090000',
  'DTEND;TZID=Europe/London:20261012T100000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,TH;UNTIL=20261231T235959Z',
  'EXDATE;TZID=Europe/London:20261112T090000',
  'SUMMARY:Networks lecture',
  'LOCATION:Calman Learning Centre',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:lecture@example.invalid',
  'RECURRENCE-ID;TZID=Europe/London:20261109T090000',
  'DTSTART;TZID=Europe/London:20261109T110000',
  'DTEND;TZID=Europe/London:20261109T120000',
  'SUMMARY:Networks lecture (moved)',
  'END:VEVENT',
  // Three evening revision sessions from Saturday: the third falls outside the window.
  'BEGIN:VEVENT',
  'UID:revision@example.invalid',
  'DTSTART:20261114T180000Z',
  'DTEND:20261114T190000Z',
  'RRULE:FREQ=DAILY;COUNT=3',
  'SUMMARY:Revision',
  'END:VEVENT',
  // A series that ended last week.
  'BEGIN:VEVENT',
  'UID:old@example.invalid',
  'DTSTART:20261001T120000Z',
  'DTEND:20261001T130000Z',
  'RRULE:FREQ=WEEKLY;UNTIL=20261105T000000Z',
  'SUMMARY:Old seminar',
  'END:VEVENT',
  // All-day events: one inside, one already running when the window opens, one past.
  'BEGIN:VEVENT',
  'UID:deadline@example.invalid',
  'DTSTART;VALUE=DATE:20261110',
  'DTEND;VALUE=DATE:20261111',
  'SUMMARY:Coursework deadline',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:reading@example.invalid',
  'DTSTART;VALUE=DATE:20261107',
  'DTEND;VALUE=DATE:20261110',
  'SUMMARY:Reading week',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:past@example.invalid',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261102',
  'SUMMARY:Past',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled@example.invalid',
  'DTSTART:20261111T150000Z',
  'DTEND:20261111T160000Z',
  'STATUS:CANCELLED',
  'SUMMARY:Called off',
  'END:VEVENT',
  'END:VCALENDAR',
);

// No VTIMEZONE and no name: TZIDs fall back to the IANA zones of the same name.
const HOME = ics(
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:call@example.invalid',
  'DTSTART;TZID=America/New_York:20261110T090000',
  'DTEND;TZID=America/New_York:20261110T093000',
  'SUMMARY:Call home',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gym@example.invalid',
  'DTSTART;TZID=Europe/London:20261113T073000',
  'DTEND;TZID=Europe/London:20261113T083000',
  'END:VEVENT',
  'END:VCALENDAR',
);

const at = (d: number, h: number, m = 0): number => Date.UTC(2026, 10, d, h, m);
const DAY = 86_400_000;

const fetchFrom =
  (bodies: Record<string, string | Error>): typeof fetch =>
  async (input) => {
    const body = bodies[String(input)];
    if (body === undefined || body instanceof Error) throw body ?? new TypeError('fetch failed');
    return new Response(body, { status: 200 });
  };

const service = (fetchFn: typeof fetch, now = NOW) =>
  createCalendarService({ fetch: fetchFn, now: () => now, timeZone: TZ });

describe('zonedToUtc and agendaWindow', () => {
  it('turns London wall time into instants either side of the clocks changing', () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, 0, TZ)).toBe(Date.UTC(2026, 6, 1, 8, 0));
    expect(zonedToUtc(2026, 11, 9, 9, 0, 0, TZ)).toBe(Date.UTC(2026, 10, 9, 9, 0));
    expect(zonedToUtc(2026, 11, 10, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 10, 10, 14, 0));
  });

  it('runs from local midnight today to midnight seven days later, even across a DST change', () => {
    expect(agendaWindow(NOW, TZ)).toEqual({ start: at(9, 0), end: at(16, 0) });
    // Clocks go back on Sunday 25 October 2026: that week is an hour longer.
    const w = agendaWindow(Date.UTC(2026, 9, 24, 12), TZ);
    expect(w.start).toBe(Date.UTC(2026, 9, 23, 23));
    expect(w.end).toBe(Date.UTC(2026, 9, 31, 0));
    // Just after midnight local in summer is still "today" though UTC says yesterday.
    expect(agendaWindow(Date.UTC(2026, 6, 1, 23, 30), TZ).start).toBe(Date.UTC(2026, 6, 1, 23));
  });
});

describe('agenda', () => {
  it('is unconfigured with no calendars and fetches nothing', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await service(fetchFn).agenda([], null)).toEqual({
      state: 'unconfigured',
      fetchedAt: null,
      events: [],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('expands recurrences, overrides, exclusions and all-day events into the window, sorted', async () => {
    const result = await service(fetchFrom({ [UNI_URL]: UNI })).agenda([{ url: UNI_URL }], null);
    expect(result.state).toBe('ok');
    expect(result.fetchedAt).toBe(NOW);
    expect(result.events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ['Reading week', Date.UTC(2026, 10, 7), at(10, 0), true],
      ['Networks lecture (moved)', at(9, 11), at(9, 12), false],
      ['Coursework deadline', at(10, 0), at(11, 0), true],
      ['Networks lecture', at(11, 9), at(11, 10), false],
      ['Revision', at(14, 18), at(14, 19), false],
      ['Revision', at(15, 18), at(15, 19), false],
    ]);
    const lecture = result.events.find((e) => e.title === 'Networks lecture');
    expect(lecture).toMatchObject({
      calendar: 'Uni',
      colour: CALENDAR_PALETTE[0],
      location: 'Calman Learning Centre',
    });
    expect(result.events.find((e) => e.title === 'Revision')?.location).toBeNull();
  });

  it('reads a TZID without a VTIMEZONE as that IANA zone, and names an unnamed calendar', async () => {
    const result = await service(fetchFrom({ [HOME_URL]: HOME })).agenda([{ url: HOME_URL }], null);
    expect(result.events.map((e) => [e.title, e.start, e.end, e.calendar])).toEqual([
      ['Call home', at(10, 14), at(10, 14, 30), 'Calendar'],
      ['(No title)', at(13, 7, 30), at(13, 8, 30), 'Calendar'],
    ]);
  });

  it('gives each occurrence an id that is unique and stable across refreshes', async () => {
    const fetchFn = fetchFrom({ [UNI_URL]: UNI });
    const first = await service(fetchFn).agenda([{ url: UNI_URL }], null);
    const later = await service(fetchFn, NOW + 3_600_000).agenda([{ url: UNI_URL }], first);
    const ids = first.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(later.events.map((e) => e.id)).toEqual(ids);
  });

  it('uses given names and colours, else the palette by position', async () => {
    const svc = service(fetchFrom({ [UNI_URL]: UNI, [HOME_URL]: HOME }));
    const result = await svc.agenda(
      [{ url: UNI_URL, name: 'Lectures', colour: '#123456' }, { url: HOME_URL }],
      null,
    );
    expect(svc.calendars()).toEqual([
      { name: 'Lectures', colour: '#123456' },
      { name: 'Calendar', colour: CALENDAR_PALETTE[1] },
    ]);
    expect(new Set(result.events.map((e) => e.calendar))).toEqual(new Set(['Lectures', 'Calendar']));
  });

  it('expands series that began years ago, keeping their weekly rhythm', async () => {
    const longRunning = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...LONDON_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:daily@example.invalid',
      'DTSTART;TZID=Europe/London:20000101T090000',
      'DTEND;TZID=Europe/London:20000101T091500',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Flashcards',
      'END:VEVENT',
      // Every other week on Tuesday and Thursday; DTSTART is an off-pattern Monday in 2015.
      'BEGIN:VEVENT',
      'UID:fortnightly@example.invalid',
      'DTSTART;TZID=Europe/London:20150105T090000',
      'DTEND;TZID=Europe/London:20150105T100000',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
      'SUMMARY:Tutorial',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const started = performance.now();
    const result = await service(fetchFrom({ [UNI_URL]: longRunning })).agenda([{ url: UNI_URL }], null);
    expect(performance.now() - started).toBeLessThan(1_000);
    const flashcards = result.events.filter((e) => e.title === 'Flashcards').map((e) => e.start);
    expect(flashcards).toEqual([9, 10, 11, 12, 13, 14, 15].map((d) => at(d, 9)));
    const tutorials = result.events.filter((e) => e.title === 'Tutorial').map((e) => e.start);
    expect(tutorials).toEqual([at(10, 9), at(12, 9)]);
  });

  it('caps the agenda at 50 events', async () => {
    const hourly = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:hourly@example.invalid',
      'DTSTART:20261109T000000Z',
      'DTEND:20261109T003000Z',
      'RRULE:FREQ=HOURLY',
      'SUMMARY:Ping',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const result = await service(fetchFrom({ [UNI_URL]: hourly })).agenda([{ url: UNI_URL }], null);
    expect(result.events).toHaveLength(50);
    expect(result.events[49]?.start).toBe(at(11, 1));
  });

  it('keeps the cached events, marked stale, when a refresh fails', async () => {
    const good = await service(fetchFrom({ [UNI_URL]: UNI })).agenda([{ url: UNI_URL }], null);
    for (const failing of [fetchFrom({}), fetchFrom({ [UNI_URL]: '<html>Sign in</html>' })]) {
      const result = await service(failing, NOW + 60_000).agenda([{ url: UNI_URL }], good);
      expect(result).toEqual({ state: 'stale', fetchedAt: NOW, events: good.events });
    }
  });

  it('drops cached events that have left the window', async () => {
    const good = await service(fetchFrom({ [UNI_URL]: UNI })).agenda([{ url: UNI_URL }], null);
    const twoDaysOn = Date.UTC(2026, 10, 11, 8);
    const result = await service(fetchFrom({}), twoDaysOn).agenda([{ url: UNI_URL }], good);
    expect(result.state).toBe('stale');
    expect(result.events.map((e) => e.title)).toEqual(['Networks lecture', 'Revision', 'Revision']);
  });

  it('refreshes the calendars that load and keeps cached events for the one that failed', async () => {
    const sources = [{ url: UNI_URL }, { url: HOME_URL }];
    const good = await service(fetchFrom({ [UNI_URL]: UNI, [HOME_URL]: HOME })).agenda(sources, null);
    const result = await service(fetchFrom({ [HOME_URL]: HOME }), NOW + 60_000).agenda(sources, good);
    expect(result.state).toBe('stale');
    expect(result.events).toEqual(good.events);
  });

  it('is an error with nothing cached', async () => {
    const result = await service(fetchFrom({})).agenda([{ url: UNI_URL }], null);
    expect(result).toEqual({ state: 'error', fetchedAt: null, events: [] });
  });

  it('never fetches a non-https address', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const svc = service(fetchFn);
    for (const url of [
      'http://example.invalid/basic.ics',
      'webcal://example.invalid/basic.ics',
      'not a url',
    ]) {
      expect((await svc.agenda([{ url }], null)).state).toBe('error');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('gives up on a calendar after the timeout', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const cache: CalendarAgenda = { state: 'ok', fetchedAt: NOW - 1, events: [] };
    vi.useFakeTimers();
    try {
      const pending = createCalendarService({
        fetch: hang,
        now: () => NOW,
        timeZone: TZ,
        timeoutMs: 10_000,
      }).agenda([{ url: UNI_URL }], cache);
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).state).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays an error when a failure follows a failure (an error result is not a cache)', async () => {
    const svc = service(fetchFrom({}));
    const first = await svc.agenda([{ url: UNI_URL }], null);
    expect(first).toEqual({ state: 'error', fetchedAt: null, events: [] });
    const second = await service(fetchFrom({}), NOW + 60_000).agenda([{ url: UNI_URL }], first);
    expect(second).toEqual({ state: 'error', fetchedAt: null, events: [] });
  });

  it('skips an event whose recurrence rule cannot be expanded and keeps the rest', async () => {
    const broken = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      // Parses, but ical.js refuses to iterate it (BYYEARDAY is only allowed with YEARLY).
      'BEGIN:VEVENT',
      'UID:impossible@example.invalid',
      'DTSTART:20261109T080000Z',
      'DTEND:20261109T083000Z',
      'RRULE:FREQ=MONTHLY;BYYEARDAY=10',
      'SUMMARY:Impossible',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:good@example.invalid',
      'DTSTART:20261110T120000Z',
      'DTEND:20261110T130000Z',
      'SUMMARY:Good',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const result = await service(fetchFrom({ [UNI_URL]: broken })).agenda([{ url: UNI_URL }], null);
    expect(result.state).toBe('ok');
    expect(result.events.map((e) => [e.title, e.start, e.end])).toEqual([['Good', at(10, 12), at(10, 13)]]);
  });

  it('ends an all-day event without DTEND at the next local midnight, even on a 23-hour day', async () => {
    // Clocks go forward on Sunday 29 March 2026: London's day runs 00:00 GMT to 00:00 BST.
    const springForward = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:clocks@example.invalid',
      'DTSTART;VALUE=DATE:20260329',
      'SUMMARY:Clocks go forward',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const result = await service(fetchFrom({ [UNI_URL]: springForward }), Date.UTC(2026, 2, 28, 12)).agenda(
      [{ url: UNI_URL }],
      null,
    );
    expect(result.events.map((e) => [e.start, e.end, e.allDay])).toEqual([
      [Date.UTC(2026, 2, 29, 0), Date.UTC(2026, 2, 29, 23), true],
    ]);
  });

  it('reads a summer (BST) event in its own zone', async () => {
    const summer = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...LONDON_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:exam@example.invalid',
      'DTSTART;TZID=Europe/London:20260701T093000',
      'DTEND;TZID=Europe/London:20260701T113000',
      'SUMMARY:Exam',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    // Monday 29 June 2026, 12:00 BST.
    const result = await service(fetchFrom({ [UNI_URL]: summer }), Date.UTC(2026, 5, 29, 11)).agenda(
      [{ url: UNI_URL }],
      null,
    );
    expect(result.events.map((e) => [e.title, e.start, e.end])).toEqual([
      ['Exam', Date.UTC(2026, 6, 1, 8, 30), Date.UTC(2026, 6, 1, 10, 30)],
    ]);
  });

  it('times the end of each recurring occurrence in the zone of its start', async () => {
    // DTEND in a different zone from DTSTART. 09:00 New York to 15:00 London (neither has a
    // VTIMEZONE) is one hour, so 14:00-15:00 UTC. 08:00 London (VTIMEZONE) to 04:00 New York (none)
    // is also one hour, 08:00-09:00 UTC.
    const mixed = ics(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...LONDON_VTIMEZONE,
      'BEGIN:VEVENT',
      'UID:early@example.invalid',
      'DTSTART;TZID=Europe/London:20261110T080000',
      'DTEND;TZID=America/New_York:20261110T040000',
      'RRULE:FREQ=DAILY;COUNT=2',
      'SUMMARY:Early',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:standup@example.invalid',
      'DTSTART;TZID=America/New_York:20261110T090000',
      'DTEND;TZID=Europe/London:20261110T150000',
      'RRULE:FREQ=DAILY;COUNT=2',
      'SUMMARY:Stand-up',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const result = await service(fetchFrom({ [UNI_URL]: mixed })).agenda([{ url: UNI_URL }], null);
    expect(result.events.map((e) => [e.title, e.start, e.end])).toEqual([
      ['Early', at(10, 8), at(10, 9)],
      ['Stand-up', at(10, 14), at(10, 15)],
      ['Early', at(11, 8), at(11, 9)],
      ['Stand-up', at(11, 14), at(11, 15)],
    ]);
  });

  it('refuses a calendar that redirects to a non-https address', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://example.invalid/basic.ics' } }),
      )
      .mockResolvedValue(new Response(UNI, { status: 200 }));
    const result = await service(fetchFn).agenda([{ url: UNI_URL }], null);
    expect(result.state).toBe('error');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('parses a ~3 MB calendar quickly (benchmark, R26)', async () => {
    // A decade of one-off events (most long past, some far ahead) plus a handful of series: the
    // shape of a big, old Google calendar.
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...LONDON_VTIMEZONE];
    let n = 0;
    while (lines.join('\r\n').length < 3 * 1024 * 1024 - 400 && n < 40_000) {
      for (let k = 0; k < 500; k++, n++) {
        const day = new Date(Date.UTC(2018, 0, 1) + (n % 4_000) * DAY);
        const ymd = day.toISOString().slice(0, 10).replaceAll('-', '');
        lines.push(
          'BEGIN:VEVENT',
          `UID:bulk-${n}@example.invalid`,
          `DTSTAMP:20260101T000000Z`,
          `DTSTART;TZID=Europe/London:${ymd}T1${n % 10}0000`,
          `DTEND;TZID=Europe/London:${ymd}T1${n % 10}3000`,
          `SUMMARY:Bulk event number ${n} with a reasonably long title`,
          'DESCRIPTION:Some notes that Google keeps with every event\\, as most real events have.',
          'LOCATION:Somewhere on campus',
          'END:VEVENT',
        );
      }
    }
    lines.push(
      'BEGIN:VEVENT',
      'UID:weekly@example.invalid',
      'DTSTART;TZID=Europe/London:20190107T090000',
      'DTEND;TZID=Europe/London:20190107T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'SUMMARY:Weekly',
      'END:VEVENT',
      'END:VCALENDAR',
    );
    const body = lines.join('\r\n');
    expect(body.length).toBeGreaterThan(2.5 * 1024 * 1024);
    const started = performance.now();
    const result = await service(fetchFrom({ [UNI_URL]: body })).agenda([{ url: UNI_URL }], null);
    const ms = performance.now() - started;
    console.info(`[bench] ${(body.length / 1024 / 1024).toFixed(2)} MB, ${n} events: ${ms.toFixed(0)} ms`);
    expect(result.state).toBe('ok');
    expect(result.events.some((e) => e.title === 'Weekly' && e.start === at(9, 9))).toBe(true);
    expect(ms).toBeLessThan(5_000);
  });

  it('never puts the secret address in the result', async () => {
    const ok = await service(fetchFrom({ [UNI_URL]: UNI })).agenda([{ url: UNI_URL }], null);
    const failed = await service(fetchFrom({})).agenda([{ url: UNI_URL }], ok);
    expect(JSON.stringify([ok, failed])).not.toContain('uni-secret');
  });
});
