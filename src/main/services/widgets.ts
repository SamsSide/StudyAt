// The Weather and Calendar widgets' main side (widgets addendum §2, §3, §5): the safeStorage-backed
// store for the iCal addresses, and the freshness rules over the two fetch services. The renderer
// polls `weatherCurrent()` and `agenda()` while a widget is open; main refetches only when the last
// good result is older than 30 min (weather) or 15 min (calendar), or the place or addresses
// changed, and serves the stored cache otherwise. Overlapping calls share one request. A result
// that lands after the place or addresses changed is returned but never stored.
//
// The addresses are secrets (study-dev rule 9): encrypted on disk, kept in memory only without OS
// encryption, never logged and never in anything returned to the renderer.
import type { PublicSettings } from '../../shared/types';
import type { CalendarAgenda, CalendarStatus, Place, WeatherReport } from '../../shared/widgets';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { CALENDAR_PALETTE, DEFAULT_CALENDAR_NAME, type CalendarService } from './calendar';
import { publicSettings } from './settings';
import type { SafeStorageLike } from './spotify';
import type { WeatherService } from './weather';

export const WEATHER_FRESH_MS = 30 * 60_000;
export const AGENDA_FRESH_MS = 15 * 60_000;
/** After a failed refresh, no new request for this long: the cache (or the failure) is served meanwhile. */
export const RETRY_AFTER_FAILURE_MS = 120_000;

export interface CalendarUrlStore {
  load(): string[];
  /** An empty list removes the stored blob. */
  save(urls: string[]): void;
}

const isUrlList = (v: unknown): v is string[] => Array.isArray(v) && v.every((u) => typeof u === 'string');

/** Like the Spotify token store: JSON encrypted with safeStorage, base64 in `settings.calendarUrls`. */
export function calendarUrlStore(
  db: Db,
  safe: SafeStorageLike,
  log: (msg: string) => void = console.warn,
): CalendarUrlStore {
  const settings = settingsRepo(db);
  let cached: string[] | undefined;
  let warned = false;

  const available = (): boolean => {
    const ok = safe.isEncryptionAvailable();
    if (!ok && !warned) {
      warned = true;
      log('StudyAt: OS encryption is unavailable, so calendar addresses are kept in memory only');
    }
    return ok;
  };

  return {
    load() {
      if (cached !== undefined) return [...cached];
      cached = [];
      const blob = settings.get().calendarUrls;
      if (blob && available()) {
        try {
          const parsed: unknown = JSON.parse(safe.decryptString(Buffer.from(blob, 'base64')));
          if (isUrlList(parsed)) cached = parsed;
        } catch {
          // Unreadable (another Windows user, a reset key): treated as no calendars.
        }
      }
      return [...cached];
    },
    save(urls) {
      cached = [...urls];
      if (urls.length === 0) {
        settings.set({ calendarUrls: null });
        return;
      }
      settings.set({
        calendarUrls: available() ? safe.encryptString(JSON.stringify(urls)).toString('base64') : null,
      });
    },
  };
}

export interface WidgetsDeps {
  db: Db;
  weather: WeatherService;
  calendar: CalendarService;
  safe: SafeStorageLike;
  now: () => number;
  log?: (msg: string) => void;
}

const samePlace = (a: Place | null, b: Place | null): boolean =>
  a !== null && b !== null && a.latitude === b.latitude && a.longitude === b.longitude;

/** Fresh: a successful fetch at most `maxAge` ago (a clock that went backwards is not fresh). */
const isFresh = (r: { state: string; fetchedAt: number | null }, now: number, maxAge: number): boolean =>
  r.state === 'ok' && r.fetchedAt !== null && now >= r.fetchedAt && now - r.fetchedAt < maxAge;

/** Still inside the back-off after a failed refresh (a clock that went backwards is not). */
const isBackedOff = (failedAt: number, now: number): boolean =>
  now >= failedAt && now - failedAt < RETRY_AFTER_FAILURE_MS;

export function widgetsService(deps: WidgetsDeps) {
  const settings = settingsRepo(deps.db);
  const urls = calendarUrlStore(deps.db, deps.safe, deps.log);

  let weatherInFlight: { place: Place; promise: Promise<WeatherReport> } | null = null;
  /** Bumped by every setUrls, so a fetch for the old addresses is never stored or named. */
  let generation = 0;
  let namedGeneration = -1;
  let agendaInFlight: { generation: number; promise: Promise<CalendarAgenda> } | null = null;
  /** The last failed refresh and when it failed; served until RETRY_AFTER_FAILURE_MS has passed. */
  let weatherFailure: { place: Place; at: number; report: WeatherReport } | null = null;
  let agendaFailure: { generation: number; at: number; agenda: CalendarAgenda } | null = null;

  const fetchWeather = async (place: Place, cache: WeatherReport | null): Promise<WeatherReport> => {
    const report = await deps.weather.report(place, cache);
    if (samePlace(settings.get().weatherPlace, place))
      weatherFailure = report.state === 'ok' ? null : { place, at: deps.now(), report };
    if (report.state === 'ok' && samePlace(settings.get().weatherPlace, place))
      settings.set({ weatherCache: report });
    return report;
  };

  const fetchAgenda = async (
    list: string[],
    cache: CalendarAgenda | null,
    gen: number,
  ): Promise<CalendarAgenda> => {
    const agenda = await deps.calendar.agenda(
      list.map((url) => ({ url })),
      cache,
    );
    if (gen === generation) {
      namedGeneration = gen;
      agendaFailure = agenda.state === 'ok' ? null : { generation: gen, at: deps.now(), agenda };
      if (agenda.state === 'ok' || agenda.state === 'stale') settings.set({ calendarCache: agenda });
    }
    return agenda;
  };

  /**
   * Names and colours per address: from this run's last fetch, else the stored agenda's events
   * (a restart), else "Calendar" in the palette colour for its position.
   */
  const calendarStatus = (): CalendarStatus => {
    const list = urls.load();
    const fetched = namedGeneration === generation ? deps.calendar.calendars() : [];
    const events = settings.get().calendarCache?.events ?? [];
    return {
      configured: list.length > 0,
      calendars: list.map((_, i) => {
        const known = fetched[i];
        if (known) return { name: known.name, colour: known.colour };
        const e = events.find((ev) => ev.id.startsWith(`${i}:`));
        if (e) return { name: e.calendar, colour: e.colour };
        return { name: DEFAULT_CALENDAR_NAME, colour: CALENDAR_PALETTE[i % CALENDAR_PALETTE.length]! };
      }),
    };
  };

  return {
    searchPlaces: (q: string): Promise<Place[]> => deps.weather.searchPlaces(q),

    /** Picking a different place drops the old place's cache; the same place keeps it. */
    setPlace(place: Place | null): PublicSettings {
      weatherFailure = null;
      const current = settings.get().weatherPlace;
      const changed = place === null ? current !== null : !samePlace(current, place);
      return publicSettings(
        settings.set(changed ? { weatherPlace: place, weatherCache: null } : { weatherPlace: place }),
      );
    },

    weatherCurrent(): Promise<WeatherReport> {
      const s = settings.get();
      const place = s.weatherPlace;
      if (place === null) return Promise.resolve({ state: 'unconfigured', place: null, fetchedAt: null });
      const cache = s.weatherCache;
      const usable =
        cache !== null && cache.fetchedAt !== null && samePlace(cache.place, place) ? cache : null;
      if (usable && isFresh(usable, deps.now(), WEATHER_FRESH_MS)) return Promise.resolve(usable);
      if (
        weatherFailure &&
        samePlace(weatherFailure.place, place) &&
        isBackedOff(weatherFailure.at, deps.now())
      )
        return Promise.resolve(weatherFailure.report);
      if (weatherInFlight && samePlace(weatherInFlight.place, place)) return weatherInFlight.promise;
      const flight = { place, promise: fetchWeather(place, usable) };
      weatherInFlight = flight;
      return flight.promise.finally(() => {
        if (weatherInFlight === flight) weatherInFlight = null;
      });
    },

    calendarStatus,

    /** Stores already-validated addresses and clears the old agenda. */
    setCalendarUrls(input: string[]): CalendarStatus {
      const list = input.map((u) => u.trim()).filter((u) => u !== '');
      const stored = urls.load();
      if (list.length === stored.length && list.every((u, i) => u === stored[i])) return calendarStatus();
      generation++;
      agendaInFlight = null;
      agendaFailure = null;
      urls.save(list);
      settings.set({ calendarCache: null });
      return calendarStatus();
    },

    agenda(): Promise<CalendarAgenda> {
      const list = urls.load();
      if (list.length === 0) return Promise.resolve({ state: 'unconfigured', fetchedAt: null, events: [] });
      const cache = settings.get().calendarCache;
      const usable = cache !== null && cache.fetchedAt !== null ? cache : null;
      if (usable && isFresh(usable, deps.now(), AGENDA_FRESH_MS)) return Promise.resolve(usable);
      if (
        agendaFailure &&
        agendaFailure.generation === generation &&
        isBackedOff(agendaFailure.at, deps.now())
      )
        return Promise.resolve(agendaFailure.agenda);
      if (agendaInFlight && agendaInFlight.generation === generation) return agendaInFlight.promise;
      const flight = { generation, promise: fetchAgenda(list, usable, generation) };
      agendaInFlight = flight;
      return flight.promise.finally(() => {
        if (agendaInFlight === flight) agendaInFlight = null;
      });
    },
  };
}

export type WidgetsService = ReturnType<typeof widgetsService>;
