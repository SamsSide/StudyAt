import { describe, expect, it, vi } from 'vitest';
import type { Place, WeatherReport } from '../../shared/widgets';
import { createWeatherService } from './weather';

const NOW = Date.UTC(2026, 10, 9, 14, 30);
const DURHAM: Place = {
  name: 'Durham',
  latitude: 54.77676,
  longitude: -1.57566,
  country: 'United Kingdom',
  admin1: 'England',
};

const GEOCODING = {
  results: [
    {
      id: 1,
      name: 'Durham',
      latitude: 54.77676,
      longitude: -1.57566,
      country: 'United Kingdom',
      admin1: 'England',
    },
    {
      id: 2,
      name: 'Durham',
      latitude: 35.99403,
      longitude: -78.89862,
      country: 'United States',
      admin1: 'North Carolina',
    },
    { id: 3, name: 'Durham Island', latitude: -10.5, longitude: 160.2 },
    { id: 4, name: 'Broken', latitude: 'north', longitude: 2 },
  ],
  generationtime_ms: 0.5,
};

const FORECAST = {
  latitude: 54.78,
  longitude: -1.58,
  timezone: 'Europe/London',
  current: { time: '2026-11-09T14:30', interval: 900, temperature_2m: 8.4, weather_code: 3, is_day: 1 },
  daily: {
    time: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
    weather_code: [3, 61, 80, 2, 0],
    temperature_2m_max: [9.1, 10.2, 8, 7.5, 6],
    temperature_2m_min: [3.2, 5, 2.1, 1, -1.4],
  },
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const service = (fetchFn: typeof fetch, timeoutMs?: number) =>
  createWeatherService({ fetch: fetchFn, now: () => NOW, timeoutMs });

describe('searchPlaces', () => {
  it('asks the geocoding API for five English results and maps the usable ones', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(GEOCODING));
    const places = await service(fetchFn).searchPlaces('  Durham ');
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ name: 'Durham', count: '5', language: 'en' });
    expect(places).toEqual([
      DURHAM,
      {
        name: 'Durham',
        latitude: 35.99403,
        longitude: -78.89862,
        country: 'United States',
        admin1: 'North Carolina',
      },
      { name: 'Durham Island', latitude: -10.5, longitude: 160.2, country: null, admin1: null },
    ]);
  });

  it('returns nothing without asking when the query is under 2 or over 100 characters', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await service(fetchFn).searchPlaces(' a ')).toEqual([]);
    expect(await service(fetchFn).searchPlaces('x'.repeat(101))).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns nothing when the API finds no places', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ generationtime_ms: 0.2 }));
    expect(await service(fetchFn).searchPlaces('Nowhereville')).toEqual([]);
  });

  it('rejects with a readable message when offline', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(service(fetchFn).searchPlaces('Durham')).rejects.toThrow(
      'Place search is unavailable right now',
    );
  });
});

describe('report', () => {
  it('is unconfigured without a place and asks nothing', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await service(fetchFn).report(null, null)).toEqual({
      state: 'unconfigured',
      place: null,
      fetchedAt: null,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('asks for current and five daily values in the place time zone and maps them', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(FORECAST));
    const report = await service(fetchFn).report(DURHAM, null);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '54.77676',
      longitude: '-1.57566',
      current: 'temperature_2m,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '5',
    });
    expect(report).toEqual({
      state: 'ok',
      place: DURHAM,
      fetchedAt: NOW,
      current: { tempC: 8.4, code: 3, isDay: true },
      daily: [
        { date: '2026-11-09', maxC: 9.1, minC: 3.2, code: 3 },
        { date: '2026-11-10', maxC: 10.2, minC: 5, code: 61 },
        { date: '2026-11-11', maxC: 8, minC: 2.1, code: 80 },
        { date: '2026-11-12', maxC: 7.5, minC: 1, code: 2 },
        { date: '2026-11-13', maxC: 6, minC: -1.4, code: 0 },
      ],
    });
  });

  it('reads is_day 0 as night', async () => {
    const night = { ...FORECAST, current: { ...FORECAST.current, is_day: 0 } };
    const report = await service(vi.fn<typeof fetch>().mockResolvedValue(json(night))).report(DURHAM, null);
    expect(report.current?.isDay).toBe(false);
  });

  const cached: WeatherReport = {
    state: 'ok',
    place: DURHAM,
    fetchedAt: NOW - 3_600_000,
    current: { tempC: 7, code: 0, isDay: true },
    daily: [{ date: '2026-11-09', maxC: 9, minC: 3, code: 0 }],
  };

  it('falls back to the cached report for the same place, marked stale, when offline', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await service(fetchFn).report(DURHAM, cached)).toEqual({ ...cached, state: 'stale' });
  });

  it('is stale too when the server errors or sends something unreadable', async () => {
    const httpError = vi.fn<typeof fetch>().mockResolvedValue(json({ error: true, reason: 'x' }, 500));
    expect((await service(httpError).report(DURHAM, cached)).state).toBe('stale');
    const garbled = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }));
    expect((await service(garbled).report(DURHAM, cached)).state).toBe('stale');
    const missing = vi.fn<typeof fetch>().mockResolvedValue(json({ ...FORECAST, daily: { time: [] } }));
    expect((await service(missing).report(DURHAM, cached)).state).toBe('stale');
  });

  it('is an error with nothing cached, or with a cache for another place', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await service(fetchFn).report(DURHAM, null)).toEqual({
      state: 'error',
      place: DURHAM,
      fetchedAt: null,
    });
    const elsewhere = { ...cached, place: { ...DURHAM, latitude: 51.5, longitude: -0.12 } };
    expect((await service(fetchFn).report(DURHAM, elsewhere)).state).toBe('error');
  });

  it('gives up after the timeout and falls back', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    vi.useFakeTimers();
    try {
      const pending = service(hang, 10_000).report(DURHAM, cached);
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).state).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });
});
