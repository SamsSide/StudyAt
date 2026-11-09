import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings, WeatherUnits } from '../../shared/types';
import type { Place, WeatherReport } from '../../shared/widgets';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { useWindowVisibility } from '../spaces/windowVisibility';
import { installMockApi, mockApi } from '../test/mockApi';
import { placeLabel, shortWeekday, temperature } from './format';
import { WeatherWidget } from './WeatherWidget';

const NOW = new Date(2026, 10, 9, 15, 0).getTime();
const DURHAM: Place = {
  name: 'Durham',
  latitude: 54.78,
  longitude: -1.57,
  country: 'United Kingdom',
  admin1: 'England',
};

const report = (over: Partial<WeatherReport> = {}): WeatherReport => ({
  state: 'ok',
  place: DURHAM,
  fetchedAt: NOW,
  current: { tempC: 8.4, code: 2, isDay: true },
  daily: [
    { date: '2026-11-09', maxC: 11.6, minC: 4.6, code: 2 },
    { date: '2026-11-10', maxC: 9, minC: 3, code: 61 },
    { date: '2026-11-11', maxC: 8, minC: 2, code: 3 },
    { date: '2026-11-12', maxC: 7, minC: 1, code: 71 },
    { date: '2026-11-13', maxC: 10, minC: 5, code: 95 },
  ],
  ...over,
});

const withUnits = (units: WeatherUnits): PublicSettings => {
  const {
    spotifyTokens: _t,
    calendarUrls: _u,
    calendarCache: _c,
    weatherCache: _w,
    ...rest
  } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, weatherUnits: units, weatherPlace: DURHAM };
};

const setup = (r: WeatherReport | (() => Promise<WeatherReport>), units: WeatherUnits = 'celsius') => {
  const api = mockApi({
    weather: { current: vi.fn(typeof r === 'function' ? r : () => Promise.resolve(r)) },
  });
  installMockApi(api);
  useStudyStore.setState({ settings: withUnits(units) });
  return api;
};

const show = async () => {
  render(<WeatherWidget />);
  await act(() => vi.advanceTimersByTimeAsync(0));
};

beforeEach(() => {
  resetStudyStore();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  useWindowVisibility.getState().setVisible(true);
});

describe('weather format', () => {
  it('converts and rounds temperatures', () => {
    expect(temperature(8.4, 'celsius')).toBe(8);
    expect(temperature(-0.4, 'celsius')).toBe(0);
    expect(temperature(10, 'fahrenheit')).toBe(50);
    expect(temperature(-40, 'fahrenheit')).toBe(-40);
  });

  it('names a place with its region and country, without repeats', () => {
    expect(placeLabel(DURHAM)).toBe('Durham, England, United Kingdom');
    expect(placeLabel({ ...DURHAM, name: 'London', admin1: 'London' })).toBe('London, United Kingdom');
    expect(placeLabel({ ...DURHAM, admin1: null, country: null })).toBe('Durham');
  });

  it('reads a forecast date as a calendar day, whatever the time zone', () => {
    expect(shortWeekday('2026-11-09')).toBe('Mon');
    expect(shortWeekday('2026-11-15')).toBe('Sun');
  });
});

describe('WeatherWidget', () => {
  it('shows nothing before the first answer', () => {
    setup(() => new Promise<WeatherReport>(() => undefined));
    render(<WeatherWidget />);
    expect(screen.queryByText('Choose your location in Settings')).toBeNull();
    expect(screen.queryByText('Weather unavailable')).toBeNull();
  });

  it('not set up: asks for a location in Settings and opens them', async () => {
    setup({ state: 'unconfigured', place: null, fetchedAt: null });
    await show();
    expect(screen.getByText('Choose your location in Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(useStudyStore.getState().overlay).toBe('settings');
  });

  it("shows the place, current temperature, condition and today's high and low", async () => {
    setup(report());
    await show();
    expect(screen.getByText('Durham')).toBeInTheDocument();
    expect(screen.getByText('8°', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Partly cloudy')).toBeInTheDocument();
    expect(screen.getByText('H:12° L:5°')).toBeInTheDocument();
    expect(screen.getByText('Weather data by Open-Meteo.com')).toBeInTheDocument();
  });

  it('shows a five-day row with short weekdays, icons and highs and lows', async () => {
    setup(report());
    await show();
    const days = within(screen.getByRole('list', { name: 'Five-day forecast' })).getAllByRole('listitem');
    expect(days).toHaveLength(5);
    expect(days.map((d) => d.querySelector('[data-day]')?.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
    ]);
    expect(within(days[1]!).getByRole('img', { name: 'Light rain' })).toBeInTheDocument();
    expect(days[1]).toHaveTextContent('9°');
    expect(days[1]).toHaveTextContent('3°');
  });

  it('shows Fahrenheit when the setting says so', async () => {
    setup(report({ current: { tempC: 10, code: 0, isDay: false } }), 'fahrenheit');
    await show();
    expect(screen.getByText('50°', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('H:53° L:40°')).toBeInTheDocument();
    expect(screen.getByText('Clear', { selector: 'p' })).toBeInTheDocument();
  });

  it('stale: keeps the last report and says when it was updated', async () => {
    setup(report({ state: 'stale', fetchedAt: new Date(2026, 10, 9, 14, 30).getTime() }));
    await show();
    expect(screen.getByText('8°', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Updated 14:30')).toBeInTheDocument();
  });

  it('error with nothing cached: "Weather unavailable"', async () => {
    setup({ state: 'error', place: DURHAM, fetchedAt: null });
    await show();
    expect(screen.getByText('Weather unavailable')).toBeInTheDocument();
  });

  it('a rejected call reads as unavailable', async () => {
    setup(() => Promise.reject(new Error('gone')));
    await show();
    expect(screen.getByText('Weather unavailable')).toBeInTheDocument();
  });

  it('asks again every ten minutes while shown, on focus, and when the place changes', async () => {
    const api = setup(report());
    await show();
    expect(api.weather.current).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(599_000));
    expect(api.weather.current).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.weather.current).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.weather.current).toHaveBeenCalledTimes(3);
    await act(async () => {
      const s = useStudyStore.getState().settings!;
      useStudyStore.setState({
        settings: { ...s, weatherPlace: { ...DURHAM, name: 'York', latitude: 53.96 } },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.weather.current).toHaveBeenCalledTimes(4);
  });

  it('stops asking while the window is hidden, and asks at once when shown again', async () => {
    const api = setup(report());
    await show();
    // Minimised or hidden to the tray: main says so; `document.hidden` stays false.
    act(() => useWindowVisibility.getState().setVisible(false));
    await act(() => vi.advanceTimersByTimeAsync(1_800_000));
    expect(api.weather.current).toHaveBeenCalledTimes(1);
    // Shown again: ask at once rather than waiting out the interval.
    await act(async () => {
      useWindowVisibility.getState().setVisible(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.weather.current).toHaveBeenCalledTimes(2);
  });
  it('ignores an answer that arrives after a newer one', async () => {
    let releaseOld: (r: WeatherReport) => void = () => undefined;
    const answers: (() => Promise<WeatherReport>)[] = [
      () => new Promise<WeatherReport>((res) => (releaseOld = res)),
      () => Promise.resolve(report({ current: { tempC: 20, code: 0, isDay: true } })),
    ];
    let call = 0;
    setup(() => answers[Math.min(call++, 1)]!());
    render(<WeatherWidget />);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('20°', { selector: 'p' })).toBeInTheDocument();
    await act(async () => {
      releaseOld(report({ current: { tempC: 1, code: 0, isDay: true } }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('20°', { selector: 'p' })).toBeInTheDocument();
  });

  it('a stale report with no fetch time still says it could not refresh', async () => {
    setup(report({ state: 'stale', fetchedAt: null }));
    await show();
    expect(screen.getByText("Couldn't refresh")).toBeInTheDocument();
    expect(screen.queryByText(/^Updated/)).toBeNull();
  });

  it('the big condition icon is decorative; only the five-day icons are labelled', async () => {
    setup(report());
    await show();
    // Day one is also "Partly cloudy": exactly one labelled image, the one in the forecast row.
    const imgs = screen.getAllByRole('img', { name: 'Partly cloudy' });
    expect(imgs).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Five-day forecast' })).toContainElement(imgs[0]!);
  });

  it('"Open settings" opens Settings on the Weather section', async () => {
    setup({ state: 'unconfigured', place: null, fetchedAt: null });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(useStudyStore.getState().settingsSection).toBe('Weather');
  });
});
