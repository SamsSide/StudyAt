import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { idleTimerState, installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { Shell } from './Shell';
import { resetStudyStore, useStudyStore } from './store';
import { testRegistry } from './testRegistry';
import { SHORTCUTS } from './useShortcuts';

const onboarded = (): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, onboarded: true };
};

const onboardedApi = (): MockApi => mockApi({ settings: { get: vi.fn(() => Promise.resolve(onboarded())) } });

async function renderShell(api: MockApi = onboardedApi()) {
  installMockApi(api);
  render(<Shell registry={testRegistry()} />);
  await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
  return api;
}

beforeEach(() => resetStudyStore());
afterEach(() => vi.useRealTimers());

describe('Shell', () => {
  it('renders the background, the seven dock items and the timer widget open by default', async () => {
    await renderShell();
    expect(screen.getByTestId('background')).toBeInTheDocument();
    const dock = screen.getByRole('navigation', { name: 'Dock' });
    const labels = within(dock).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Spaces', 'Sounds', 'Timer', 'Tasks', 'Spotify', 'Stats', 'Settings']);
    expect(screen.getByTestId('timer-widget')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-widget')).not.toBeInTheDocument();
  });

  it('dock opens sounds panel and closing it via Esc', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole('button', { name: 'Sounds' }));
    expect(screen.getByTestId('sounds-panel')).toBeInTheDocument();
    expect(useStudyStore.getState().openPanel).toBe('sounds');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('sounds-panel')).not.toBeInTheDocument();
  });

  it('Esc closes the top overlay first, then the panel', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(screen.getByRole('button', { name: 'Spaces' }));
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(screen.getByRole('dialog', { name: 'Stats' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Stats' })).not.toBeInTheDocument();
    expect(screen.getByTestId('spaces-panel')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('spaces-panel')).not.toBeInTheDocument();
  });

  it('dock toggles the tasks widget through settings.set', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(api.settings.set).toHaveBeenCalledWith({
      widgets: { tasks: { ...DEFAULT_SETTINGS.widgets.tasks, open: true } },
    });
    expect(await screen.findByTestId('tasks-widget')).toBeInTheDocument();
  });

  it("S opens stats overlay, typing S in an input doesn't", async () => {
    const user = userEvent.setup();
    await renderShell();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await user.keyboard('s');
    expect(useStudyStore.getState().overlay).toBeNull();
    input.blur();
    input.remove();
    await user.keyboard('s');
    expect(screen.getByRole('dialog', { name: 'Stats' })).toBeInTheDocument();
    expect(screen.getByTestId('stats-overlay')).toBeInTheDocument();
  });

  it('Space calls timer.start when idle and pause when running', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    await user.keyboard(' ');
    expect(api.timer.start).toHaveBeenCalledTimes(1);
    act(() => api.emitState({ ...idleTimerState(), status: 'running' }));
    await user.keyboard(' ');
    expect(api.timer.pause).toHaveBeenCalledTimes(1);
    act(() => api.emitState({ ...idleTimerState(), status: 'paused', pauseReason: 'user' }));
    await user.keyboard(' ');
    expect(api.timer.resume).toHaveBeenCalledTimes(1);
  });

  it('Space on a focused button presses the button, not the timer', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    screen.getByRole('button', { name: 'Sounds' }).focus();
    await user.keyboard(' ');
    expect(api.timer.start).not.toHaveBeenCalled();
    expect(useStudyStore.getState().openPanel).toBe('sounds');
  });

  it('the timer keys call the API directly', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    await user.keyboard('rn123mf');
    expect(api.timer.reset).toHaveBeenCalledTimes(1);
    expect(api.timer.skip).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.timer.setMode).mock.calls).toEqual([['focus'], ['short'], ['long']]);
    expect(api.app.showMini).toHaveBeenCalledWith(true);
    expect(api.app.toggleFullscreen).toHaveBeenCalledTimes(1);
    await user.keyboard('m');
    expect(api.app.showMini).toHaveBeenLastCalledWith(false);
  });

  it('T toggles tasks, K the sounds panel and G the spaces panel', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.keyboard('k');
    expect(useStudyStore.getState().openPanel).toBe('sounds');
    await user.keyboard('g');
    expect(useStudyStore.getState().openPanel).toBe('spaces');
    await user.keyboard('g');
    expect(useStudyStore.getState().openPanel).toBeNull();
    await user.keyboard('t');
    expect(await screen.findByTestId('tasks-widget')).toBeInTheDocument();
  });

  it('? shows shortcut help listing every key of spec §3.7', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.keyboard('?');
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const keys = within(help).getAllByRole('term').map((k) => k.textContent);
    expect(keys).toEqual(['Space', 'R', 'N', '1 / 2 / 3', 'S', 'T', 'K', 'G', 'M', 'F', 'Esc', '?']);
    expect(SHORTCUTS).toHaveLength(12);
  });

  it('welcome card shows until Got it then sets onboarded', async () => {
    const user = userEvent.setup();
    const api = await renderShell(mockApi());
    expect(
      screen.getByText(
        'Welcome to StudyAt — pick a space, start a Pomodoro, and your study time is tracked from here.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(api.settings.set).toHaveBeenCalledWith({ onboarded: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument());
  });

  it('auto-hide hides chrome after 5 s and mouse move shows it', async () => {
    await renderShell();
    vi.useFakeTimers();
    fireEvent.mouseMove(window);
    const shell = screen.getByTestId('shell');
    expect(shell).toHaveAttribute('data-chrome', 'shown');
    act(() => vi.advanceTimersByTime(4999));
    expect(shell).toHaveAttribute('data-chrome', 'shown');
    act(() => vi.advanceTimersByTime(1));
    expect(shell).toHaveAttribute('data-chrome', 'hidden');
    fireEvent.mouseMove(window);
    expect(shell).toHaveAttribute('data-chrome', 'shown');
  });
});
