import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStudyStore } from './shell/store';
import { installMockApi, mockApi } from './test/mockApi';

const chimes = vi.hoisted(() => ({ mounted: 0 }));
const recap = vi.hoisted(() => ({ mounted: 0 }));

vi.mock('./audio/useChimes', () => ({
  useChimes: () => {
    chimes.mounted += 1;
  },
}));
vi.mock('./stats/useRecapPopup', () => ({
  useRecapPopup: () => {
    recap.mounted += 1;
    return <div data-testid="recap-popup-host" />;
  },
}));

import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    resetStudyStore();
    chimes.mounted = 0;
    recap.mounted = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders background, away prompt host, dock with seven items (Spaces, Sounds, Timer, Tasks, Widgets, Stats, Settings), timer widget open by default, and mounts useChimes and useRecapPopup', async () => {
    installMockApi(mockApi());
    render(<App />);

    // Settings load asynchronously; the timer widget appears once they arrive.
    const timer = await screen.findByRole('group', { name: 'Timer' });
    expect(timer).toBeInTheDocument();
    expect(within(timer).getByRole('toolbar', { name: 'Timer mode' })).toBeInTheDocument();

    const dock = screen.getByRole('navigation', { name: 'Dock' });
    const labels = within(dock)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    // v1.2 spec §3.1: Spotify lives in the Widgets popover, not the dock.
    expect(labels).toEqual(['Spaces', 'Sounds', 'Timer', 'Tasks', 'Widgets', 'Stats', 'Settings']);

    expect(screen.getByTestId('app-background')).toBeInTheDocument();
    expect(screen.getByTestId('away-prompt-host')).toBeInTheDocument();
    expect(screen.getByTestId('recap-popup-host')).toBeInTheDocument();
    expect(chimes.mounted).toBeGreaterThan(0);
    expect(recap.mounted).toBeGreaterThan(0);
  });

  it('shows the away prompt from main even when the timer widget is closed', async () => {
    const api = mockApi();
    installMockApi(api);
    render(<App />);
    await screen.findByRole('group', { name: 'Timer' });
    act(() => api.emitAway({ awayMs: 12 * 60_000, deadline: Date.now() + 120_000 }));
    expect(await screen.findByRole('alertdialog', { name: 'Welcome back' })).toBeInTheDocument();
  });
});

describe('App bridge', () => {
  beforeEach(() => resetStudyStore());

  it('mirrors main window visibility and mini timer state from main', async () => {
    const { useWindowVisibility } = await import('./spaces/windowVisibility');
    const { useStudyStore } = await import('./shell/store');
    const api = mockApi();
    installMockApi(api);
    render(<App />);
    await screen.findByRole('group', { name: 'Timer' });
    act(() => api.emitVisibility(false));
    expect(useWindowVisibility.getState().visible).toBe(false);
    act(() => api.emitVisibility(true));
    expect(useWindowVisibility.getState().visible).toBe(true);
    act(() => api.emitMini(true));
    expect(useStudyStore.getState().miniShown).toBe(true);
    act(() => api.emitMini(false));
    expect(useStudyStore.getState().miniShown).toBe(false);
  });
});
