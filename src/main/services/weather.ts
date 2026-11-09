// Weather from Open-Meteo, fetched in main (widgets addendum §3): place search for Settings and a
// current + five-day report for the widget. No key, no account. Each call is one short request
// with a 10 s deadline; a failed refresh falls back to the last good report for the same place.
import type { Place, WeatherReport } from '../../shared/widgets';
import { getText, WIDGET_FETCH_TIMEOUT_MS } from './fetch-timeout';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_BODY = 256 * 1024;
const FORECAST_DAYS = 5;

export const PLACE_QUERY_MIN = 2;
export const PLACE_QUERY_MAX = 100;

export interface WeatherDeps {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs?: number;
}

export interface WeatherService {
  /** Up to five places for `q` (2–100 characters after trimming, else none). Rejects when offline. */
  searchPlaces(q: string): Promise<Place[]>;
  /** Never rejects: a failure is `stale` (cached report for this place) or `error`. */
  report(place: Place | null, cache: WeatherReport | null): Promise<WeatherReport>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The place search's `results`, keeping only entries with a name and real coordinates. */
export function parsePlaces(body: unknown): Place[] {
  if (!isObj(body) || !Array.isArray(body.results)) return [];
  const places: Place[] = [];
  for (const r of body.results) {
    if (!isObj(r)) continue;
    const name = str(r.name);
    const latitude = num(r.latitude);
    const longitude = num(r.longitude);
    if (name === null || latitude === null || longitude === null) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    places.push({ name, latitude, longitude, country: str(r.country), admin1: str(r.admin1) });
  }
  return places.slice(0, 5);
}

type Forecast = Required<Pick<WeatherReport, 'current' | 'daily'>>;

/** The forecast body, or null if anything the widget shows is missing. */
export function parseForecast(body: unknown): Forecast | null {
  if (!isObj(body) || !isObj(body.current) || !isObj(body.daily)) return null;
  const tempC = num(body.current.temperature_2m);
  const code = num(body.current.weather_code);
  const isDay = num(body.current.is_day);
  if (tempC === null || code === null || isDay === null) return null;

  const { time, weather_code, temperature_2m_max, temperature_2m_min } = body.daily;
  if (![time, weather_code, temperature_2m_max, temperature_2m_min].every(Array.isArray)) return null;
  const days = time as unknown[];
  const daily: Forecast['daily'] = [];
  for (let i = 0; i < Math.min(days.length, FORECAST_DAYS); i++) {
    const date = str(days[i]);
    const dayCode = num((weather_code as unknown[])[i]);
    const maxC = num((temperature_2m_max as unknown[])[i]);
    const minC = num((temperature_2m_min as unknown[])[i]);
    if (
      date === null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      dayCode === null ||
      maxC === null ||
      minC === null
    ) {
      return null;
    }
    daily.push({ date, maxC, minC, code: dayCode });
  }
  if (daily.length === 0) return null;
  return { current: { tempC, code, isDay: isDay !== 0 }, daily };
}

const samePlace = (a: Place | null, b: Place): boolean =>
  a !== null && a.latitude === b.latitude && a.longitude === b.longitude;

export function createWeatherService(deps: WeatherDeps): WeatherService {
  const timeoutMs = deps.timeoutMs ?? WIDGET_FETCH_TIMEOUT_MS;

  const getJson = async (url: string): Promise<unknown> =>
    JSON.parse(await getText(deps.fetch, url, timeoutMs, MAX_BODY)) as unknown;

  return {
    async searchPlaces(q) {
      const query = q.trim();
      if (query.length < PLACE_QUERY_MIN || query.length > PLACE_QUERY_MAX) return [];
      const params = new URLSearchParams({ name: query, count: '5', language: 'en' });
      try {
        return parsePlaces(await getJson(`${GEOCODING_URL}?${params.toString()}`));
      } catch {
        throw new Error('Place search is unavailable right now');
      }
    },

    async report(place, cache) {
      if (place === null) return { state: 'unconfigured', place: null, fetchedAt: null };
      const params = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: 'temperature_2m,weather_code,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min',
        timezone: 'auto',
        forecast_days: String(FORECAST_DAYS),
      });
      let forecast: Forecast | null;
      try {
        forecast = parseForecast(await getJson(`${FORECAST_URL}?${params.toString()}`));
      } catch {
        forecast = null;
      }
      if (forecast) return { state: 'ok', place, fetchedAt: deps.now(), ...forecast };
      if (cache?.current && cache.daily && samePlace(cache.place, place)) {
        return {
          state: 'stale',
          place,
          fetchedAt: cache.fetchedAt,
          current: cache.current,
          daily: cache.daily,
        };
      }
      return { state: 'error', place, fetchedAt: null };
    },
  };
}
