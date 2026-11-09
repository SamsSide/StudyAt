import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarAgenda, CalendarStatus, Place, WeatherReport } from '../../shared/widgets';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import type { CalendarService } from './calendar';
import type { SafeStorageLike } from './spotify';
import type { WeatherService } from './weather';
import { AGENDA_FRESH_MS, calendarUrlStore, WEATHER_FRESH_MS, widgetsService } from './widgets';

let cleanup: () => void;
let db: Db;
let now: number;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
  now = NOW;
});

afterEach(async () => {
  await db.close();
  cleanup();
});

/** Reversible stand-in for safeStorage: never stores the text as is. */
const fakeSafe = (available: boolean): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decryptString: (b) => [...b.toString('utf8')].reverse().join(''),
});

const DURHAM: Place = {
  name: 'Durham',
  latitude: 54.77,
  longitude: -1.57,
  country: 'United Kingdom',
  admin1: 'England',
};
const LEEDS: Place = {
  name: 'Leeds',
  latitude: 53.8,
  longitude: -1.55,
  country: 'United Kingdom',
  admin1: 'England',
};
const URL_A = 'https://calendar.google.com/calendar/ical/a%40gmail.com/private-secret/basic.ics';
const URL_B = 'https://example.org/b.ics';

const okReport = (place: Place, at: number): WeatherReport => ({
  state: 'ok',
  place,
  fetchedAt: at,
  current: { tempC: 9, code: 3, isDay: true },
  daily: [{ date: '2026-11-09', maxC: 12, minC: 5, code: 3 }],
});

function fakeWeather() {
  return {
    searchPlaces: vi.fn((_q: string) => Promise.resolve([DURHAM])),
    report: vi.fn((place: Place | null, _cache: WeatherReport | null): Promise<WeatherReport> =>
      Promise.resolve(place ? okReport(place, now) : { state: 'unconfigured', place: null, fetchedAt: null }),
    ),
  } satisfies WeatherService;
}

const event = (index: number, name: string, colour: string) => ({
  id: `${index}:uid:20261109T090000`,
  title: 'Lecture',
  start: NOW,
  end: NOW + 3_600_000,
  allDay: false,
  calendar: name,
  colour,
  location: null,
});

function fakeCalendar() {
  let known: { name: string; colour: string }[] = [];
  return {
    calendars: vi.fn(() => known),
    agenda: vi.fn((sources: { url: string }[], _cache: CalendarAgenda | null): Promise<CalendarAgenda> => {
      known = sources.map((_, i) => ({ name: `Cal ${i}`, colour: `#00000${i}` }));
      return Promise.resolve({ state: 'ok', fetchedAt: now, events: [event(0, 'Cal 0', '#000000')] });
    }),
  } satisfies CalendarService;
}

function setup(safe = fakeSafe(true)) {
  const weather = fakeWeather();
  const calendar = fakeCalendar();
  const log = vi.fn();
  const svc = widgetsService({ db, weather, calendar, safe, now: () => now, log });
  return { svc, weather, calendar, log };
}

describe('weather', () => {
  it('is unconfigured without a place, without fetching', async () => {
    const { svc, weather } = setup();
    expect(await svc.weatherCurrent()).toEqual({ state: 'unconfigured', place: null, fetchedAt: null });
    expect(weather.report).not.toHaveBeenCalled();
  });

  it('fetches, stores the cache, serves it for 30 minutes, then refetches', async () => {
    const { svc, weather } = setup();
    svc.setPlace(DURHAM);
    expect((await svc.weatherCurrent()).state).toBe('ok');
    expect(settingsRepo(db).get().weatherCache).toEqual(okReport(DURHAM, NOW));
    now = NOW + WEATHER_FRESH_MS - 1;
    expect((await svc.weatherCurrent()).fetchedAt).toBe(NOW);
    expect(weather.report).toHaveBeenCalledTimes(1);
    now = NOW + WEATHER_FRESH_MS;
    expect((await svc.weatherCurrent()).fetchedAt).toBe(now);
    expect(weather.report).toHaveBeenCalledTimes(2);
    expect(WEATHER_FRESH_MS).toBe(30 * 60_000);
  });

  it('uses a fresh cache from settings after a restart', async () => {
    settingsRepo(db).set({ weatherPlace: DURHAM, weatherCache: okReport(DURHAM, NOW - 60_000) });
    const { svc, weather } = setup();
    expect((await svc.weatherCurrent()).fetchedAt).toBe(NOW - 60_000);
    expect(weather.report).not.toHaveBeenCalled();
  });

  it('refetches when the place changes, and setPlace clears the old cache', async () => {
    const { svc, weather } = setup();
    svc.setPlace(DURHAM);
    await svc.weatherCurrent();
    const out = svc.setPlace(LEEDS);
    expect(out.weatherPlace).toEqual(LEEDS);
    expect(out).not.toHaveProperty('weatherCache');
    expect(settingsRepo(db).get().weatherCache).toBeNull();
    expect((await svc.weatherCurrent()).place).toEqual(LEEDS);
    expect(weather.report).toHaveBeenCalledTimes(2);
    // Picking the same place again keeps its cache.
    svc.setPlace({ ...LEEDS });
    expect(settingsRepo(db).get().weatherCache).not.toBeNull();
    svc.setPlace(null);
    expect(await svc.weatherCurrent()).toMatchObject({ state: 'unconfigured' });
  });

  it('passes only a cache for the same place with a fetchedAt, and does not store a failure', async () => {
    settingsRepo(db).set({
      weatherPlace: DURHAM,
      weatherCache: { ...okReport(DURHAM, NOW), fetchedAt: null },
    });
    const { svc, weather } = setup();
    weather.report.mockResolvedValueOnce({ state: 'error', place: DURHAM, fetchedAt: null });
    expect((await svc.weatherCurrent()).state).toBe('error');
    expect(weather.report).toHaveBeenLastCalledWith(DURHAM, null);
    expect(settingsRepo(db).get().weatherCache?.current?.tempC).toBe(9);

    settingsRepo(db).set({ weatherCache: okReport(LEEDS, NOW - WEATHER_FRESH_MS * 2) });
    await svc.weatherCurrent();
    expect(weather.report).toHaveBeenLastCalledWith(DURHAM, null);

    const old = okReport(DURHAM, NOW - WEATHER_FRESH_MS * 2);
    settingsRepo(db).set({ weatherCache: old });
    weather.report.mockResolvedValueOnce({ ...old, state: 'stale' });
    await svc.weatherCurrent();
    expect(weather.report).toHaveBeenLastCalledWith(DURHAM, old);
  });

  it('shares one request between overlapping calls', async () => {
    const { svc, weather } = setup();
    svc.setPlace(DURHAM);
    const [a, b] = await Promise.all([svc.weatherCurrent(), svc.weatherCurrent()]);
    expect(a).toEqual(b);
    expect(weather.report).toHaveBeenCalledTimes(1);
  });

  it('does not store a report that finished after the place changed', async () => {
    const { svc, weather } = setup();
    svc.setPlace(DURHAM);
    let finish: (r: WeatherReport) => void = () => undefined;
    weather.report.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = svc.weatherCurrent();
    svc.setPlace(LEEDS);
    finish(okReport(DURHAM, now));
    await pending;
    expect(settingsRepo(db).get().weatherCache).toBeNull();
  });
});

describe('calendarUrlStore', () => {
  it('stores the addresses encrypted and reads them back after a restart', () => {
    calendarUrlStore(db, fakeSafe(true)).save([URL_A]);
    const blob = settingsRepo(db).get().calendarUrls!;
    expect(blob).not.toContain('private-secret');
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('private-secret');
    expect(calendarUrlStore(db, fakeSafe(true)).load()).toEqual([URL_A]);
    calendarUrlStore(db, fakeSafe(true)).save([]);
    expect(settingsRepo(db).get().calendarUrls).toBeNull();
  });

  it('keeps the addresses in memory only, warning once without the address, when OS encryption is unavailable', () => {
    const log = vi.fn();
    const store = calendarUrlStore(db, fakeSafe(false), log);
    store.save([URL_A]);
    store.save([URL_A, URL_B]);
    expect(store.load()).toEqual([URL_A, URL_B]);
    expect(settingsRepo(db).get().calendarUrls).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-secret');
  });

  it('treats an unreadable blob as no calendars', () => {
    settingsRepo(db).set({ calendarUrls: 'not-a-blob' });
    expect(calendarUrlStore(db, fakeSafe(true)).load()).toEqual([]);
  });
});

describe('calendar', () => {
  it('is unconfigured with no addresses, without fetching', async () => {
    const { svc, calendar } = setup();
    expect(svc.calendarStatus()).toEqual({ configured: false, calendars: [] });
    expect(await svc.agenda()).toEqual({ state: 'unconfigured', fetchedAt: null, events: [] });
    expect(calendar.agenda).not.toHaveBeenCalled();
  });

  it('setUrls stores, clears the cache and reports default names until the first fetch', async () => {
    settingsRepo(db).set({
      calendarCache: { state: 'ok', fetchedAt: NOW, events: [event(0, 'Old', '#111111')] },
    });
    const { svc } = setup();
    const status: CalendarStatus = svc.setCalendarUrls([URL_A, URL_B]);
    expect(settingsRepo(db).get().calendarCache).toBeNull();
    expect(status).toEqual({
      configured: true,
      calendars: [
        { name: 'Calendar', colour: '#7c9cff' },
        { name: 'Calendar', colour: '#5ccfb0' },
      ],
    });
    expect(JSON.stringify(status)).not.toContain('https');
    await svc.agenda();
    expect(svc.calendarStatus().calendars).toEqual([
      { name: 'Cal 0', colour: '#000000' },
      { name: 'Cal 1', colour: '#000001' },
    ]);
  });

  it('fetches, stores the cache, serves it for 15 minutes, then refetches', async () => {
    const { svc, calendar } = setup();
    svc.setCalendarUrls([URL_A]);
    expect((await svc.agenda()).state).toBe('ok');
    expect(calendar.agenda).toHaveBeenLastCalledWith([{ url: URL_A }], null);
    expect(settingsRepo(db).get().calendarCache?.fetchedAt).toBe(NOW);
    now = NOW + AGENDA_FRESH_MS - 1;
    await svc.agenda();
    expect(calendar.agenda).toHaveBeenCalledTimes(1);
    now = NOW + AGENDA_FRESH_MS;
    await svc.agenda();
    expect(calendar.agenda).toHaveBeenCalledTimes(2);
    expect(AGENDA_FRESH_MS).toBe(15 * 60_000);
  });

  it('after a restart, names come from the stored agenda (then defaults), and a fresh cache is served', async () => {
    calendarUrlStore(db, fakeSafe(true)).save([URL_A, URL_B]);
    settingsRepo(db).set({
      calendarCache: { state: 'ok', fetchedAt: NOW - 60_000, events: [event(0, 'Lectures', '#e57aa8')] },
    });
    const { svc, calendar } = setup();
    expect(svc.calendarStatus()).toEqual({
      configured: true,
      calendars: [
        { name: 'Lectures', colour: '#e57aa8' },
        { name: 'Calendar', colour: '#5ccfb0' },
      ],
    });
    expect((await svc.agenda()).fetchedAt).toBe(NOW - 60_000);
    expect(calendar.agenda).not.toHaveBeenCalled();
  });

  it('passes a cache only when it has a fetchedAt, and does not store an error', async () => {
    calendarUrlStore(db, fakeSafe(true)).save([URL_A]);
    settingsRepo(db).set({ calendarCache: { state: 'stale', fetchedAt: null, events: [] } });
    const { svc, calendar } = setup();
    calendar.agenda.mockResolvedValueOnce({ state: 'error', fetchedAt: null, events: [] });
    expect((await svc.agenda()).state).toBe('error');
    expect(calendar.agenda).toHaveBeenLastCalledWith([{ url: URL_A }], null);
    expect(settingsRepo(db).get().calendarCache).toEqual({ state: 'stale', fetchedAt: null, events: [] });

    const old: CalendarAgenda = { state: 'ok', fetchedAt: NOW - AGENDA_FRESH_MS, events: [] };
    settingsRepo(db).set({ calendarCache: old });
    await svc.agenda();
    expect(calendar.agenda).toHaveBeenLastCalledWith([{ url: URL_A }], old);
  });

  it('drops an agenda that finished after the addresses changed', async () => {
    const { svc, calendar } = setup();
    svc.setCalendarUrls([URL_A]);
    let finish: (a: CalendarAgenda) => void = () => undefined;
    calendar.agenda.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = svc.agenda();
    svc.setCalendarUrls([URL_B]);
    finish({ state: 'ok', fetchedAt: now, events: [event(0, 'Old', '#111111')] });
    await pending;
    expect(settingsRepo(db).get().calendarCache).toBeNull();
  });

  it('shares one request between overlapping calls', async () => {
    const { svc, calendar } = setup();
    svc.setCalendarUrls([URL_A]);
    await Promise.all([svc.agenda(), svc.agenda()]);
    expect(calendar.agenda).toHaveBeenCalledTimes(1);
  });
});
