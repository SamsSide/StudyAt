import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarAgenda, CalendarEvent } from '../../shared/widgets';
import { useStudyStore } from '../shell/store';
import { installMockApi, mockApi } from '../test/mockApi';
import { CalendarWidget } from './CalendarWidget';

// Monday 9 November 2026, 10:15 local. Built from local parts, so the tests hold in any time zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const NOW = at(9, 10, 15);

let nextId = 0;
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: `e${++nextId}`,
  title: 'Event',
  start: at(9, 12),
  end: at(9, 13),
  allDay: false,
  calendar: 'Lectures',
  colour: '#7c9cff',
  location: null,
  ...over,
});

const agenda = (over: Partial<CalendarAgenda>): CalendarAgenda => ({
  state: 'ok',
  fetchedAt: NOW,
  events: [],
  ...over,
});

const setup = (a: CalendarAgenda | (() => Promise<CalendarAgenda>)) => {
  const api = mockApi({
    calendar: { agenda: vi.fn(typeof a === 'function' ? a : () => Promise.resolve(a)) },
  });
  installMockApi(api);
  return api;
};

/** Renders and lets the first poll answer. */
const show = async () => {
  render(<CalendarWidget />);
  await act(() => vi.advanceTimersByTimeAsync(0));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('CalendarWidget', () => {
  it('shows nothing before the first answer', () => {
    setup(() => new Promise<CalendarAgenda>(() => undefined));
    render(<CalendarWidget />);
    expect(screen.queryByText('Add your Google Calendar in Settings')).toBeNull();
    expect(screen.queryByText('Calendar unavailable')).toBeNull();
  });

  it('not set up: asks for a calendar in Settings and opens them', async () => {
    setup(agenda({ state: 'unconfigured', fetchedAt: null }));
    useStudyStore.getState().setOverlay(null);
    await show();
    expect(screen.getByText('Add your Google Calendar in Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(useStudyStore.getState().overlay).toBe('settings');
  });

  it("heads the list with today's weekday and date", async () => {
    setup(agenda({}));
    await show();
    expect(screen.getByRole('heading', { name: 'Monday 9 November' })).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it("lists today's events with their time range, then Tomorrow and later weekdays", async () => {
    setup(
      agenda({
        events: [
          event({ title: 'Maths lecture', start: at(9, 11), end: at(9, 12, 30) }),
          event({ title: 'Lab', start: at(10, 9), end: at(10, 11) }),
          event({ title: 'Seminar', start: at(11, 14), end: at(11, 15) }),
        ],
      }),
    );
    await show();
    const today = screen.getByRole('list', { name: 'Today' });
    expect(within(today).getByText('Maths lecture')).toBeInTheDocument();
    expect(within(today).getByText('11:00 – 12:30')).toBeInTheDocument();
    const tomorrow = screen.getByRole('list', { name: 'Tomorrow' });
    expect(within(tomorrow).getByText('Lab')).toBeInTheDocument();
    expect(within(tomorrow).getByText('09:00 – 11:00')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Wednesday' })).getByText('Seminar')).toBeInTheDocument();
  });

  it('labels all-day events "All day" and draws the calendar colour', async () => {
    setup(
      agenda({
        events: [
          event({ title: 'Reading week', allDay: true, start: at(9, 0), end: at(10, 0), colour: '#ff8a65' }),
        ],
      }),
    );
    await show();
    const item = screen.getByText('Reading week').closest('li');
    expect(item).not.toBeNull();
    expect(within(item!).getByText('All day')).toBeInTheDocument();
    expect(item!.querySelector('[data-colour]')).toHaveStyle({ backgroundColor: '#ff8a65' });
  });

  it('shows at most six events in all', async () => {
    const events = Array.from({ length: 9 }, (_, i) =>
      event({
        title: `Item ${i + 1}`,
        start: at(10 + Math.floor(i / 3), 9 + i),
        end: at(10 + Math.floor(i / 3), 10 + i),
      }),
    );
    setup(agenda({ events }));
    await show();
    expect(screen.getByText('Item 6')).toBeInTheDocument();
    expect(screen.queryByText('Item 7')).toBeNull();
  });

  it('drops events that have already ended and says when nothing is left today', async () => {
    setup(
      agenda({
        events: [
          event({ title: 'Breakfast talk', start: at(9, 8), end: at(9, 9) }),
          event({ title: 'Lab', start: at(10, 9), end: at(10, 11) }),
        ],
      }),
    );
    await show();
    expect(screen.queryByText('Breakfast talk')).toBeNull();
    expect(screen.getByText('No more events today')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
  });

  it('keeps an event that is under way today', async () => {
    setup(agenda({ events: [event({ title: 'Tutorial', start: at(9, 10), end: at(9, 11) })] }));
    await show();
    expect(screen.getByText('Tutorial')).toBeInTheDocument();
    expect(screen.queryByText('No more events today')).toBeNull();
  });

  it('stale: keeps the earlier list and says so, with the time it was updated', async () => {
    setup(
      agenda({
        state: 'stale',
        fetchedAt: at(9, 9, 30),
        events: [event({ title: 'Maths lecture', start: at(9, 11), end: at(9, 12) })],
      }),
    );
    await show();
    expect(screen.getByText('Maths lecture')).toBeInTheDocument();
    expect(screen.getByText("Couldn't refresh — showing earlier events")).toBeInTheDocument();
    expect(screen.getByText('Updated 09:30')).toBeInTheDocument();
  });

  it('error with nothing cached: "Calendar unavailable"', async () => {
    setup(agenda({ state: 'error', fetchedAt: null }));
    await show();
    expect(screen.getByText('Calendar unavailable')).toBeInTheDocument();
  });

  it('a rejected call reads as unavailable rather than breaking the widget', async () => {
    setup(() => Promise.reject(new Error('gone')));
    await show();
    expect(screen.getByText('Calendar unavailable')).toBeInTheDocument();
  });

  it('asks again every five minutes while the window is shown, and not while hidden', async () => {
    const api = setup(agenda({}));
    await show();
    expect(api.calendar.agenda).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(299_000));
    expect(api.calendar.agenda).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.calendar.agenda).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(900_000));
    expect(api.calendar.agenda).toHaveBeenCalledTimes(2);
  });

  it('refreshes once when the window regains focus', async () => {
    const api = setup(agenda({}));
    await show();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.calendar.agenda).toHaveBeenCalledTimes(2);
  });
  it('a bridge call that rejects after a good answer keeps the earlier list, marked stale', async () => {
    const answers: (() => Promise<CalendarAgenda>)[] = [
      () =>
        Promise.resolve(
          agenda({ events: [event({ title: 'Maths lecture', start: at(9, 11), end: at(9, 12) })] }),
        ),
      () => Promise.reject(new Error('gone')),
    ];
    let call = 0;
    setup(() => answers[Math.min(call++, 1)]!());
    await show();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Maths lecture')).toBeInTheDocument();
    expect(screen.getByText("Couldn't refresh — showing earlier events")).toBeInTheDocument();
  });

  it('trusts main when it later says error with no events: no earlier list is kept', async () => {
    const answers = [
      agenda({ events: [event({ title: 'Maths lecture', start: at(9, 11), end: at(9, 12) })] }),
      agenda({ state: 'error', fetchedAt: null, events: [] }),
    ];
    let call = 0;
    setup(() => Promise.resolve(answers[Math.min(call++, 1)]!));
    await show();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Calendar unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Maths lecture')).toBeNull();
  });

  it('an event that began before today shows under today', async () => {
    setup(agenda({ events: [event({ title: 'Conference', start: at(7, 9), end: at(10, 17) })] }));
    await show();
    const list = screen.getByRole('list', { name: 'Today' });
    expect(within(list).getByText('Conference')).toBeInTheDocument();
  });

  it('labels the next day "Tomorrow" across the clocks changing on 25 October 2026', async () => {
    vi.setSystemTime(new Date(2026, 9, 24, 10, 0).getTime());
    setup(
      agenda({
        events: [
          event({
            title: 'Sunday lab',
            start: new Date(2026, 9, 25, 12).getTime(),
            end: new Date(2026, 9, 25, 13).getTime(),
          }),
        ],
      }),
    );
    await show();
    expect(screen.getByRole('list', { name: 'Tomorrow' })).toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0).getTime());
    setup(
      agenda({
        events: [
          event({
            title: 'Monday lab',
            start: new Date(2026, 9, 26, 12).getTime(),
            end: new Date(2026, 9, 26, 13).getTime(),
          }),
        ],
      }),
    );
    await show();
    expect(screen.getByRole('list', { name: 'Tomorrow' })).toBeInTheDocument();
  });

  it('re-renders every minute without asking main: ended events go and the date rolls over', async () => {
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 30).getTime());
    const api = setup(
      agenda({
        events: [
          event({
            title: 'Late call',
            start: at(9, 23, 0),
            end: new Date(2026, 10, 9, 23, 59, 45).getTime(),
          }),
        ],
      }),
    );
    await show();
    expect(screen.getByText('Late call')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monday 9 November' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.queryByText('Late call')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tuesday 10 November' })).toBeInTheDocument();
    expect(api.calendar.agenda).toHaveBeenCalledTimes(1);
  });

  it('"Open settings" opens Settings on the Calendar section', async () => {
    setup(agenda({ state: 'unconfigured', fetchedAt: null }));
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(useStudyStore.getState().settingsSection).toBe('Calendar');
  });
});
