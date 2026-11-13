import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CardData,
  GoalCardData,
  StatCard,
  StatRange,
  StatWidget as StatWidgetData,
  SubjectsCardData,
  TimerState,
  TotalCardData,
} from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { StatWidgets } from './StatWidget';
import { refreshStatCards, resetStatWidgetsStore, useStatWidgetsStore } from './statWidgetsStore';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const widget = (over: Partial<StatWidgetData> = {}): StatWidgetData => ({
  id: 1,
  card: 'total',
  range: 'week',
  x: 0.5,
  y: 0.3,
  scale: 1,
  bare: false,
  ...over,
});

const total = (over: Partial<TotalCardData> = {}): TotalCardData => ({
  card: 'total',
  range: 'week',
  totalMs: 2 * HOUR + 5 * MINUTE,
  previousMs: HOUR,
  deltaPct: 12,
  todayMs: 30 * MINUTE,
  ...over,
});

const subjects = (): SubjectsCardData => ({
  card: 'subjects',
  range: 'week',
  bars: [
    { key: '1', name: 'Maths', colour: '#e07a5f', ms: 3 * HOUR },
    { key: '2', name: 'Physics', colour: '#81b29a', ms: 90 * MINUTE },
    { key: 'other', name: 'Other', colour: '#9a9a9a', ms: 40 * MINUTE },
  ],
});

const days = (hits: boolean[], elapsed: number) =>
  Array.from({ length: 7 }, (_, i) => ({
    dayKey: `2026-11-${String(9 + i).padStart(2, '0')}`,
    hit: hits[i] ?? false,
    future: i >= elapsed,
  }));

const goal = (over: Partial<GoalCardData> = {}): GoalCardData => ({
  card: 'goal',
  range: 'today',
  goalMs: 3 * HOUR,
  todayMs: 90 * MINUTE,
  days: [],
  hitDays: 0,
  elapsedDays: 1,
  streak: 3,
  ...over,
});

const timer = (todayFocusMs: number): TimerState => ({
  ...useStudyStore.getState().timer,
  status: 'running',
  mode: 'focus',
  todayFocusMs,
});

let api: MockApi;

/** Renders the stats widgets over a mock API that lists `widgets`, echoes updates and answers cards. */
function renderWidgets(widgets: StatWidgetData[], card?: (c: StatCard, r: StatRange) => CardData): MockApi {
  api = mockApi();
  vi.mocked(api.statWidgets.list).mockResolvedValue(widgets);
  vi.mocked(api.statWidgets.update).mockImplementation((id, p) => {
    const was = useStatWidgetsStore.getState().widgets.find((w) => w.id === id);
    return Promise.resolve(was ? { ...was, ...p } : null);
  });
  if (card) vi.mocked(api.stats.card).mockImplementation((c, r) => Promise.resolve(card(c, r)));
  installMockApi(api);
  render(<StatWidgets />);
  return api;
}

beforeEach(() => {
  resetStudyStore();
  resetStatWidgetsStore();
});

describe('StatWidgets', () => {
  it('loads and renders each widget from statWidgets.list', async () => {
    renderWidgets([widget({ id: 1 }), widget({ id: 2, card: 'subjects', range: 'month', y: 0.5 })]);
    expect(await screen.findByRole('group', { name: 'Total time' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'By subject' })).toBeInTheDocument();
    expect(api.statWidgets.list).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledWith('subjects', 'month'));
    expect(api.stats.card).toHaveBeenCalledWith('total', 'week');
  });

  it('the range switch saves { range: today } and refetches that card', async () => {
    renderWidgets([widget()], (c, r) => (c === 'total' ? total({ range: r }) : total()));
    const frame = await screen.findByRole('group', { name: 'Total time' });
    const range = within(frame).getByRole('radiogroup', { name: 'Range' });
    expect(within(range).getByRole('radio', { name: 'Week' })).toBeChecked();
    await userEvent.click(within(range).getByRole('radio', { name: 'Today' }));
    expect(api.statWidgets.update).toHaveBeenCalledWith(1, { range: 'today' });
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledWith('total', 'today'));
    expect(within(range).getByRole('radio', { name: 'Today' })).toBeChecked();
  });

  it('the menu changes the card, hides the background and removes', async () => {
    renderWidgets([widget()], (_c, r) => total({ range: r }));
    await screen.findByRole('group', { name: 'Total time' });

    await userEvent.click(screen.getByRole('button', { name: 'Stats widget menu' }));
    const menu = screen.getByRole('menu');
    for (const name of ['Total time', 'By subject', 'Goal + streak']) {
      expect(within(menu).getByRole('menuitemradio', { name })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole('menuitemradio', { name: 'Estimates' })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'By subject' }));
    expect(api.statWidgets.update).toHaveBeenCalledWith(1, { card: 'subjects' });
    expect(await screen.findByRole('group', { name: 'By subject' })).toBeInTheDocument();
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledWith('subjects', 'week'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stats widget menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide background' }));
    expect(api.statWidgets.update).toHaveBeenLastCalledWith(1, { bare: true });
    // Bare: no header (no title handle or close button); the toolbar holds the controls.
    const frame = screen.getByRole('group', { name: 'By subject' });
    expect(within(frame).queryByRole('button', { name: 'Remove stats widget' })).not.toBeInTheDocument();
    expect(frame.querySelector('[class*="widgetHeader"]')).toBeNull();
    expect(frame.querySelector('[class*="bareTools"]')).toContainElement(
      within(frame).getByRole('button', { name: 'Stats widget menu' }),
    );
    expect(within(frame).getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stats widget menu' }));
    expect(screen.getByRole('menuitem', { name: 'Show background' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(api.statWidgets.remove).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'By subject' })).not.toBeInTheDocument());
  });

  it('the menu closes on Escape and gives focus back to its button', async () => {
    renderWidgets([widget()]);
    await screen.findByRole('group', { name: 'Total time' });
    const trigger = screen.getByRole('button', { name: 'Stats widget menu' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: 'Total time' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Total shows the total and the change vs last week', async () => {
    renderWidgets([widget()], () => total());
    expect(await screen.findByText('2h 05m')).toBeInTheDocument();
    expect(screen.getByText('+12% vs last week')).toBeInTheDocument();
  });

  it('Total says yesterday for Today and last month for Month', async () => {
    renderWidgets([widget({ id: 1, range: 'today' }), widget({ id: 2, range: 'month' })], (_c, r) =>
      total({ range: r, deltaPct: r === 'today' ? -10 : 5 }),
    );
    expect(await screen.findByText('−10% vs yesterday')).toBeInTheDocument();
    expect(await screen.findByText('+5% vs last month')).toBeInTheDocument();
  });

  it('Today’s total ticks with the running focus segment', async () => {
    useStudyStore.setState({ timer: timer(10 * MINUTE) });
    renderWidgets([widget({ range: 'today' })], () =>
      total({ range: 'today', totalMs: 10 * MINUTE, todayMs: 10 * MINUTE, deltaPct: null }),
    );
    expect(await screen.findByText('0h 10m')).toBeInTheDocument();
    act(() => useStudyStore.setState({ timer: timer(11 * MINUTE) }));
    expect(await screen.findByText('0h 11m')).toBeInTheDocument();
  });

  it('an idle timer adds nothing: a deleted session stays off the card', async () => {
    // The timer's today figure is stale (main pushes no state on a delete); the card is not.
    useStudyStore.setState({ timer: { ...timer(60 * MINUTE), status: 'idle' } });
    renderWidgets([widget({ range: 'today' })], () =>
      total({ range: 'today', totalMs: 30 * MINUTE, todayMs: 30 * MINUTE, deltaPct: null }),
    );
    expect(await screen.findByText('0h 30m')).toBeInTheDocument();
    expect(screen.queryByText('1h 00m')).not.toBeInTheDocument();
  });

  it('a break or a pause adds nothing to the total', async () => {
    useStudyStore.setState({ timer: { ...timer(60 * MINUTE), mode: 'short' } });
    renderWidgets([widget({ id: 1, range: 'today' }), widget({ id: 2, range: 'week', y: 0.6 })], (_c, r) =>
      total({ range: r, totalMs: (r === 'today' ? 30 : 90) * MINUTE, todayMs: 30 * MINUTE }),
    );
    expect(await screen.findByText('0h 30m')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    act(() => useStudyStore.setState({ timer: { ...timer(60 * MINUTE), status: 'paused' } }));
    expect(screen.getByText('0h 30m')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('running focus adds only the time since the card’s fetch', async () => {
    useStudyStore.setState({ timer: timer(10 * MINUTE + 59_000) });
    // The first answer already counts the live figure (main's withLiveAccrual); later ones hang,
    // so what shows after the minute is the fetched total plus the 2 s accrued since.
    let calls = 0;
    api = mockApi();
    vi.mocked(api.statWidgets.list).mockResolvedValue([widget({ range: 'today' })]);
    vi.mocked(api.stats.card).mockImplementation(() =>
      calls++ === 0
        ? Promise.resolve(
            total({
              range: 'today',
              totalMs: 10 * MINUTE + 59_000,
              todayMs: 10 * MINUTE + 59_000,
              deltaPct: null,
            }),
          )
        : new Promise<CardData>(() => {}),
    );
    installMockApi(api);
    render(<StatWidgets />);
    expect(await screen.findByText('0h 10m')).toBeInTheDocument();
    act(() => useStudyStore.setState({ timer: timer(11 * MINUTE + 1_000) }));
    expect(screen.getByText('0h 11m')).toBeInTheDocument();
  });

  it('a whole focus minute refetches every card', async () => {
    useStudyStore.setState({ timer: timer(10 * MINUTE + 30_000) });
    renderWidgets([widget()], () => total());
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(1));
    act(() => useStudyStore.setState({ timer: timer(10 * MINUTE + 45_000) }));
    expect(api.stats.card).toHaveBeenCalledTimes(1);
    act(() => useStudyStore.setState({ timer: timer(11 * MINUTE) }));
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(2));
  });

  it('By subject shows a bar per subject with Other last', async () => {
    renderWidgets([widget({ card: 'subjects' })], () => subjects());
    const list = await screen.findByRole('list', { name: 'By subject' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Maths3h', 'Physics1h 30m', 'Other40m']);
  });

  it('By subject keeps the full name in a title and the module code visible', async () => {
    renderWidgets(
      [widget({ card: 'subjects' })],
      () => ({
        ...subjects(),
        bars: [{ key: '9', name: 'COMP2221 Programming Paradigms', colour: '#e07a5f', ms: HOUR }],
      }),
    );
    const list = await screen.findByRole('list', { name: 'By subject' });
    expect(within(list).getByTitle('COMP2221 Programming Paradigms')).toBeInTheDocument();
    expect(within(list).getByText('COMP2221')).toBeInTheDocument();
  });

  it('By subject with no focus time says so, with no full stop', async () => {
    renderWidgets([widget({ card: 'subjects' })], () => ({ ...subjects(), bars: [] }));
    expect(await screen.findByText('No focus time in this range yet')).toBeInTheDocument();
  });

  it('Goal Today shows the ring and the streak', async () => {
    renderWidgets([widget({ card: 'goal', range: 'today' })], () => goal());
    expect(await screen.findByRole('img', { name: '1h 30m of 3h today' })).toBeInTheDocument();
    expect(screen.getByText('🔥 3-day streak')).toBeInTheDocument();
  });

  it('Goal Week shows the days hit and a dot per day', async () => {
    renderWidgets([widget({ card: 'goal', range: 'week' })], () =>
      goal({ range: 'week', days: days([true, false, true], 3), hitDays: 2, elapsedDays: 3 }),
    );
    expect(await screen.findByText('Goal hit 2 of 3 days')).toBeInTheDocument();
    const dots = within(screen.getByRole('list', { name: 'Goal by day' })).getAllByRole('listitem');
    expect(dots).toHaveLength(7);
    expect(dots[0]).toHaveAttribute('data-state', 'hit');
    expect(dots[1]).toHaveAttribute('data-state', 'missed');
    expect(dots[6]).toHaveAttribute('data-state', 'future');
    expect(screen.getByText('🔥 3-day streak')).toBeInTheDocument();
  });

  it('a segment end refetches', async () => {
    renderWidgets([widget()], () => total());
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(1));
    act(() => api.emitSegmentEnd({ mode: 'focus', next: 'short' }));
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(2));
  });

  it('refreshStatCards refetches', async () => {
    renderWidgets([widget()], () => total());
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(1));
    act(() => refreshStatCards());
    await waitFor(() => expect(api.stats.card).toHaveBeenCalledTimes(2));
  });
});

describe('statWidgetsStore', () => {
  it('add does nothing at six', async () => {
    api = mockApi();
    installMockApi(api);
    useStatWidgetsStore.setState({ widgets: [1, 2, 3, 4, 5, 6].map((id) => widget({ id })) });
    await useStatWidgetsStore.getState().add();
    expect(api.statWidgets.add).not.toHaveBeenCalled();
  });

  it('add appends main’s new widget', async () => {
    api = mockApi();
    installMockApi(api);
    await useStatWidgetsStore.getState().add();
    expect(api.statWidgets.add).toHaveBeenCalledTimes(1);
    expect(useStatWidgetsStore.getState().widgets).toEqual([widget()]);
  });

  it('a failed patch is undone', async () => {
    api = mockApi();
    vi.mocked(api.statWidgets.update).mockRejectedValue(new Error('No such stats widget'));
    installMockApi(api);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useStatWidgetsStore.setState({ widgets: [widget()] });
    const saving = useStatWidgetsStore.getState().patch(1, { range: 'today' });
    expect(useStatWidgetsStore.getState().widgets[0]?.range).toBe('today');
    await saving;
    expect(useStatWidgetsStore.getState().widgets[0]?.range).toBe('week');
  });
});
