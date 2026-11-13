import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsOverview } from '../../shared/types';
import { makeSpace, sampleSpaces } from '../spaces/fixtures';
import { resetSpacesStore, useSpacesStore } from '../spaces/spacesStore';
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

beforeEach(() => {
  resetStudyStore();
  resetSpacesStore();
});

afterEach(() => vi.unstubAllGlobals());

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

describe('TopBar background button (v1.2 spec §3.4)', () => {
  const useSpace = (id: number, spaces = sampleSpaces()) =>
    useSpacesStore.setState({ spaces, activeId: id, loaded: true });
  const bar = () => within(screen.getByRole('banner'));

  it('with a YouTube space it pauses and plays the background', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    useSpace(3);
    render(<TopBar />);
    await user.click(bar().getByRole('button', { name: 'Pause background' }));
    expect(useSpacesStore.getState().backgroundPaused).toBe(true);
    await user.click(bar().getByRole('button', { name: 'Play background' }));
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
    expect(bar().getByRole('button', { name: 'Pause background' })).toBeInTheDocument();
  });

  it('is hidden for an image space', () => {
    installMockApi(mockApi());
    useSpace(2);
    render(<TopBar />);
    expect(bar().queryByRole('button', { name: /background/ })).not.toBeInTheDocument();
  });

  it('is hidden once there is no active space', () => {
    installMockApi(mockApi());
    useSpace(3);
    render(<TopBar />);
    expect(bar().getByRole('button', { name: 'Pause background' })).toBeInTheDocument();
    act(() => useSpacesStore.setState({ activeId: null }));
    expect(bar().queryByRole('button', { name: /background/ })).not.toBeInTheDocument();
  });

  describe('under reduced motion', () => {
    const reducedMotion = () =>
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

    it('reads "Play background" on the still, and clicking it plays', async () => {
      const user = userEvent.setup();
      reducedMotion();
      installMockApi(mockApi());
      useSpace(3);
      render(<TopBar />);
      await user.click(bar().getByRole('button', { name: 'Play background' }));
      expect(useSpacesStore.getState().stillPlayId).toBe(3);
      expect(useSpacesStore.getState().backgroundPaused).toBe(false);
      await user.click(bar().getByRole('button', { name: 'Pause background' }));
      expect(useSpacesStore.getState().backgroundPaused).toBe(true);
      expect(bar().getByRole('button', { name: 'Play background' })).toBeInTheDocument();
    });

    it('goes back to "Play background" when the space changes', () => {
      reducedMotion();
      installMockApi(mockApi());
      useSpace(3);
      render(<TopBar />);
      act(() => useSpacesStore.getState().playBackground());
      expect(bar().getByRole('button', { name: 'Pause background' })).toBeInTheDocument();
      act(() => useSpacesStore.setState({ activeId: 1 }));
      expect(bar().getByRole('button', { name: 'Play background' })).toBeInTheDocument();
    });
  });

  it('is hidden for a missing file, a blocked embed and an offline YouTube space', () => {
    installMockApi(mockApi());
    useSpace(1, [makeSpace({ id: 1, missing: true })]);
    const { unmount } = render(<TopBar />);
    expect(bar().queryByRole('button', { name: /background/ })).not.toBeInTheDocument();
    unmount();
    useSpace(3);
    useSpacesStore.setState({ embedErrors: { 3: 'embed' } });
    const second = render(<TopBar />);
    expect(bar().queryByRole('button', { name: /background/ })).not.toBeInTheDocument();
    second.unmount();
    useSpacesStore.setState({ embedErrors: {} });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<TopBar />);
    expect(bar().queryByRole('button', { name: /background/ })).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
