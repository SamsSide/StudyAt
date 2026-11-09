import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StatsOverview } from '../../shared/types';
import { idleTimerState, installMockApi, mockApi } from '../test/mockApi';
import { formatHm, goalTooltip } from './format';
import { GoalRing } from './GoalRing';
import { resetStudyStore, useStudyStore } from './store';
import { TopBar } from './TopBar';

const overview = (patch: Partial<StatsOverview> = {}): StatsOverview => ({
  todayMs: 0,
  weekMs: 0,
  lastWeekMs: 0,
  weekDeltaPct: null,
  currentStreak: 4,
  longestStreak: 9,
  allTimeMs: 0,
  goalMs: 180 * 60_000,
  goalProgress: 0.69,
  ...patch,
});

beforeEach(() => resetStudyStore());

describe('format', () => {
  it('formats study time as Hh MMm, never rounding up', () => {
    expect(formatHm(7_500_000)).toBe('2h 05m');
    expect(formatHm(59_999)).toBe('0h 00m');
    expect(formatHm(36_000_000)).toBe('10h 00m');
  });

  it('goal ring tooltip copy from spec §3.14', () => {
    expect(goalTooltip(7_500_000, 180 * 60_000)).toBe('2h 5m of 3h today');
    expect(goalTooltip(0, 90 * 60_000)).toBe('0h 0m of 1h 30m today');
    expect(goalTooltip(600_000, 45 * 60_000)).toBe('0h 10m of 45m today');
  });
});

describe('TopBar', () => {
  it('top bar shows today as 2h 05m for 7 500 000 ms', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ timer: { ...idleTimerState(), todayFocusMs: 7_500_000 }, overview: overview() });
    render(<TopBar />);
    expect(screen.getByText('2h 05m')).toBeInTheDocument();
  });

  it('goal ring tooltip copy from spec §3.14', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ timer: { ...idleTimerState(), todayFocusMs: 7_500_000 }, overview: overview() });
    render(<TopBar />);
    expect(screen.getByTitle('2h 5m of 3h today')).toBeInTheDocument();
  });

  it('shows the streak, which opens stats', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    useStudyStore.setState({ overview: overview({ currentStreak: 4 }) });
    render(<TopBar />);
    const streak = screen.getByRole('button', { name: 'Day streak: 4' });
    await user.click(streak);
    expect(useStudyStore.getState().overlay).toBe('stats');
  });

  it('mini, fullscreen and settings buttons', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    installMockApi(api);
    render(<TopBar />);
    await user.click(screen.getByRole('button', { name: 'Show mini timer' }));
    expect(api.app.showMini).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Hide mini timer' }));
    expect(api.app.showMini).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Enter full screen' }));
    expect(api.app.toggleFullscreen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useStudyStore.getState().overlay).toBe('settings');
  });

  it('the Hide interface button turns focus view on', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    render(<TopBar />);
    await user.click(screen.getByRole('button', { name: 'Hide interface' }));
    expect(useStudyStore.getState().focusView).toBe(true);
  });
});

describe('GoalRing', () => {
  it('exposes its title and clamps progress', () => {
    render(<GoalRing progress={1.7} title="3h 0m of 3h today" />);
    const ring = screen.getByRole('img', { name: '3h 0m of 3h today' });
    expect(ring).toHaveAttribute('title', '3h 0m of 3h today');
    expect(ring).toHaveAttribute('data-progress', '1');
  });
});
