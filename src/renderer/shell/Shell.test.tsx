import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { idleTimerState, installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { sampleSpaces } from '../spaces/fixtures';
import { resetSpacesStore, useSpacesStore } from '../spaces/spacesStore';
import { useImagesStore } from '../images/imagesStore';
import { useStatWidgetsStore } from '../statWidgets/statWidgetsStore';
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

beforeEach(() => {
  resetStudyStore();
  resetSpacesStore();
});

/** Unmounts the shell and empties the store, for a second render in the same test. */
function cleanupShell(): void {
  cleanup();
  resetStudyStore();
}
afterEach(() => vi.useRealTimers());

describe('Shell', () => {
  it('renders the background, the seven dock items and the timer widget open by default', async () => {
    await renderShell();
    expect(screen.getByTestId('background')).toBeInTheDocument();
    const dock = screen.getByRole('navigation', { name: 'Dock' });
    const labels = within(dock)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['Spaces', 'Sounds', 'Timer', 'Tasks', 'Widgets', 'Stats', 'Settings']);
    expect(screen.getByTestId('timer-widget')).toBeInTheDocument();
    expect(screen.queryByTestId('tasks-widget')).not.toBeInTheDocument();
  });

  it('loads the image widgets on init and shows them after the fixed widgets', async () => {
    const api = onboardedApi();
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: 2,
        url: 'studyat-media://image/2',
        width: 100,
        height: 100,
        x: 0.5,
        y: 0.5,
        scale: 1,
        bare: false,
      },
    ]);
    await renderShell(api);
    const img = await screen.findByRole('img', { name: 'Image 1' });
    expect(api.images.list).toHaveBeenCalledTimes(1);
    const timer = screen.getByTestId('timer-widget');
    expect(timer.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('loads the notes on init and floats popped-out ones after the images (v1.2 spec §3.2)', async () => {
    const api = onboardedApi();
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: 2,
        url: 'studyat-media://image/2',
        width: 100,
        height: 100,
        x: 0.5,
        y: 0.5,
        scale: 1,
        bare: false,
      },
    ]);
    const base = {
      colour: 'yellow' as const,
      createdAt: 1,
      updatedAt: 1,
      x: 0.5,
      y: 0.3,
      scale: 1,
      bare: false,
    };
    vi.mocked(api.notes.list).mockResolvedValue([
      { ...base, id: 1, text: 'Shopping\nmilk', sort: 1, popped: true },
      { ...base, id: 2, text: 'Docked', sort: 2, popped: false },
    ]);
    await renderShell(api);
    const sticky = await screen.findByRole('group', { name: 'Shopping' });
    expect(api.notes.list).toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Docked')).not.toBeInTheDocument();
    const img = await screen.findByRole('img', { name: 'Image 1' });
    expect(img.compareDocumentPosition(sticky) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('Deadlines background toggle', () => {
    const withDeadlines = (bare: boolean): MockApi => {
      const s = onboarded();
      s.widgets.deadlines = { ...s.widgets.deadlines, open: true, bare };
      return mockApi({ settings: { get: vi.fn(() => Promise.resolve(s)) } });
    };

    it('framed, it is an icon named "Hide background"; bare, a "Show background" text button', async () => {
      await renderShell(withDeadlines(false));
      const hide = screen.getByRole('button', { name: 'Hide background' });
      expect(hide.textContent).toBe('');
      expect(hide).toHaveAttribute('title', 'Hide background');
      cleanupShell();
      await renderShell(withDeadlines(true));
      const show = screen.getByRole('button', { name: 'Show background' });
      expect(show.className).toMatch(/toolText/);
      expect(show.className).not.toMatch(/small/);
    });

    it('bare, the body holding the list is no drag-button; a toolbar handle moves it', async () => {
      await renderShell(withDeadlines(true));
      const body = screen.getByTestId('deadlines-widget');
      expect(body.closest('[role="button"]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Move Deadlines' })).toBeInTheDocument();
    });
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

  it('typing in a contenteditable leaves the shortcuts alone', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    const note = document.createElement('div');
    note.setAttribute('contenteditable', 'true');
    note.tabIndex = 0;
    document.body.appendChild(note);
    note.focus();
    await user.keyboard('sr ');
    expect(useStudyStore.getState().overlay).toBeNull();
    expect(api.timer.reset).not.toHaveBeenCalled();
    expect(api.timer.start).not.toHaveBeenCalled();
    note.remove();
  });

  it('behind an open overlay the timer and panel keys do nothing; Esc, ? and S still work', async () => {
    const user = userEvent.setup();
    const api = await renderShell();
    act(() => useStudyStore.getState().setOverlay('settings'));
    await user.keyboard(' rn123kgtmfw');
    expect(api.timer.start).not.toHaveBeenCalled();
    expect(api.timer.reset).not.toHaveBeenCalled();
    expect(api.timer.skip).not.toHaveBeenCalled();
    expect(api.timer.setMode).not.toHaveBeenCalled();
    expect(api.app.showMini).not.toHaveBeenCalled();
    expect(api.app.toggleFullscreen).not.toHaveBeenCalled();
    expect(api.settings.set).not.toHaveBeenCalled();
    expect(useStudyStore.getState().openPanel).toBeNull();
    expect(useStudyStore.getState().widgetsPopover).toBe(false);
    await user.keyboard('s');
    expect(useStudyStore.getState().overlay).toBe('stats');
    await user.keyboard('?');
    expect(useStudyStore.getState().overlay).toBe('help');
    await user.keyboard('{Escape}');
    expect(useStudyStore.getState().overlay).toBeNull();
  });

  it('swapping overlays moves focus into the new one, and Esc gives it back to the dock', async () => {
    const user = userEvent.setup();
    installMockApi(onboardedApi());
    const registry = testRegistry();
    registry.overlays.settings = () => <button type="button">A settings control</button>;
    render(<Shell registry={registry} />);
    await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
    const dockSettings = within(screen.getByRole('navigation', { name: 'Dock' })).getByRole('button', {
      name: 'Settings',
    });
    await user.click(dockSettings);
    screen.getByRole('button', { name: 'A settings control' }).focus();
    await user.keyboard('s');
    const stats = screen.getByRole('dialog', { name: 'Stats' });
    expect(stats).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(dockSettings).toHaveFocus();
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

  it('V pauses and plays the background, but not while typing or behind an overlay', async () => {
    const user = userEvent.setup();
    await renderShell();
    act(() => useSpacesStore.setState({ spaces: sampleSpaces(), activeId: 3, loaded: true }));
    await user.keyboard('v');
    expect(useSpacesStore.getState().backgroundPaused).toBe(true);
    await user.keyboard('v');
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
    const box = document.createElement('input');
    document.body.appendChild(box);
    box.focus();
    await user.keyboard('v');
    box.remove();
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
    act(() => useStudyStore.getState().setOverlay('settings'));
    await user.keyboard('v');
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('V does nothing for an image space', async () => {
    const user = userEvent.setup();
    await renderShell();
    act(() => useSpacesStore.setState({ spaces: sampleSpaces(), activeId: 2, loaded: true }));
    await user.keyboard('v');
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('B opens the Tasks board, closes it again, swaps from Stats, and not while typing', async () => {
    const user = userEvent.setup();
    await renderShell();
    const shell = () => document.querySelector('[data-overlay]');
    await user.keyboard('b');
    expect(shell()).toHaveAttribute('data-overlay', 'tasks');
    await user.keyboard('b');
    expect(shell()).toHaveAttribute('data-overlay', 'none');
    act(() => useStudyStore.getState().setOverlay('stats'));
    await user.keyboard('b');
    expect(shell()).toHaveAttribute('data-overlay', 'tasks');
    act(() => useStudyStore.getState().setOverlay(null));
    const box = document.createElement('textarea');
    document.body.appendChild(box);
    box.focus();
    await user.keyboard('b');
    box.remove();
    expect(shell()).toHaveAttribute('data-overlay', 'none');
  });

  it('? shows shortcut help listing every key of spec §3.7', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.keyboard('?');
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const keys = within(help)
      .getAllByRole('term')
      .map((k) => k.textContent);
    expect(keys).toEqual([
      'Space',
      'R',
      'N',
      '1 / 2 / 3',
      '4',
      'S',
      'B',
      'T',
      'W',
      'K',
      'G',
      'M',
      'F',
      'H',
      'V',
      'Esc',
      '?',
    ]);
    expect(SHORTCUTS).toHaveLength(17);
    expect(SHORTCUTS.find((k) => k.keys === 'B')?.action).toBe('Tasks board');
    expect(SHORTCUTS.find((k) => k.keys === 'V')?.action).toBe('Pause or play the background');
    expect(SHORTCUTS.find((k) => k.keys === 'H')?.action).toBe('Hide or show the interface');
    expect(SHORTCUTS.find((k) => k.keys === '4')?.action).toBe('Countdown');
    expect(SHORTCUTS.find((k) => k.keys === 'W')?.action).toBe('Widgets');
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

  it('when Got it fails to save, the welcome stays and says so kindly', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(api.settings.set).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'settings:set': Error: EACCES: permission denied, open 'C:\\x'",
      ),
    );
    await renderShell(api);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that. Please try again.");
    expect(screen.getByRole('region', { name: 'Welcome' }).textContent).not.toMatch(/EACCES|C:/);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument());
  });

  it("when settings won't load, a calm message offers Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const get = vi.mocked(api.settings.get);
    const real = get.getMockImplementation()!;
    get.mockRejectedValue(new Error('EACCES: permission denied'));
    installMockApi(api);
    render(<Shell registry={testRegistry()} />);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const message = screen.getByRole('alert');
    expect(message).toHaveTextContent("StudyAt couldn't load your settings.");
    expect(message.textContent).not.toMatch(/EACCES/);
    get.mockImplementation(real);
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
    expect(screen.queryByText("StudyAt couldn't load your settings.")).not.toBeInTheDocument();
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

  describe('Widgets popover', () => {
    const popover = () => screen.getByRole('dialog', { name: 'Widgets' });

    it('the dock Widgets item opens a popover of six switches, focusing the first', async () => {
      const user = userEvent.setup();
      await renderShell();
      const trigger = screen.getByRole('button', { name: 'Widgets' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const switches = within(popover()).getAllByRole('switch');
      expect(switches.map((s) => s.textContent)).toEqual([
        'Spotify',
        'Calendar',
        'Weather',
        'Quote',
        'Notes',
        'Deadlines',
      ]);
      for (const s of switches) expect(s).toHaveAttribute('aria-checked', 'false');
      expect(switches[0]).toHaveFocus();
    });

    it('a switch toggles its widget through settings.set', async () => {
      const user = userEvent.setup();
      const api = await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.click(within(popover()).getByRole('switch', { name: 'Notes' }));
      expect(api.settings.set).toHaveBeenCalledWith({
        widgets: { notes: { ...DEFAULT_SETTINGS.widgets.notes, open: true } },
      });
      expect(await screen.findByTestId('notes-widget')).toBeInTheDocument();
      expect(within(popover()).getByRole('switch', { name: 'Notes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await user.click(within(popover()).getByRole('switch', { name: 'Notes' }));
      await waitFor(() => expect(screen.queryByTestId('notes-widget')).not.toBeInTheDocument());
    });

    it('the Spotify switch toggles widgets.spotify.open through settings.set', async () => {
      const user = userEvent.setup();
      const api = await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.click(within(popover()).getByRole('switch', { name: 'Spotify' }));
      expect(api.settings.set).toHaveBeenCalledWith({
        widgets: { spotify: { ...DEFAULT_SETTINGS.widgets.spotify, open: true } },
      });
    });

    it('has no Spotify button in the dock and a divider before Stats', async () => {
      await renderShell();
      const dock = screen.getByRole('navigation', { name: 'Dock' });
      expect(within(dock).queryByRole('button', { name: 'Spotify' })).not.toBeInTheDocument();
      const stats = within(dock).getByRole('button', { name: /^Stats/ });
      expect(stats.closest('li')?.querySelector('[aria-hidden="true"]:not(span)')).not.toBeNull();
      expect(stats.previousElementSibling).not.toBeNull();
    });

    it('"Add stats widget…" adds one through statWidgets.add and closes the popover', async () => {
      const user = userEvent.setup();
      const api = await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.click(within(popover()).getByRole('button', { name: 'Add stats widget…' }));
      expect(api.statWidgets.add).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
    });

    it('"Add stats widget…" is disabled at six, saying why', async () => {
      const user = userEvent.setup();
      const api = await renderShell();
      const w = (id: number) => ({
        id,
        card: 'total' as const,
        range: 'week' as const,
        x: 0.5,
        y: 0.3,
        scale: 1,
        bare: false,
      });
      useStatWidgetsStore.setState({ widgets: [1, 2, 3, 4, 5, 6].map(w) });
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      const add = within(popover()).getByRole('button', { name: 'Add stats widget…' });
      expect(add).toHaveAttribute('aria-disabled', 'true');
      expect(add).toHaveAttribute('title', 'Up to 6 stats widgets');
      expect(add).toHaveAccessibleDescription('Up to 6 stats widgets');
      add.focus();
      expect(add).toHaveFocus();
      await user.click(add);
      expect(popover()).toBeInTheDocument();
      expect(api.statWidgets.add).not.toHaveBeenCalled();
      useStatWidgetsStore.setState({ widgets: [] });
    });

    it('"Add image…" still opens the image dialog', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.click(within(popover()).getByRole('button', { name: 'Add image…' }));
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
      expect(useImagesStore.getState().adding).toBe(true);
      useImagesStore.getState().setAdding(false);
    });

    it('Esc closes only the popover and gives focus back to the dock item', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.click(screen.getByRole('button', { name: 'Spaces' }));
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
      expect(screen.getByTestId('spaces-panel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Widgets' })).toHaveFocus();
    });

    it('a click outside closes it; a second click on the dock item does too', async () => {
      const user = userEvent.setup();
      await renderShell();
      const trigger = screen.getByRole('button', { name: 'Widgets' });
      await user.click(trigger);
      await user.click(screen.getByTestId('background'));
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
      await user.click(trigger);
      expect(popover()).toBeInTheDocument();
      await user.click(trigger);
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
    });

    it('W toggles it, but not while typing', async () => {
      const user = userEvent.setup();
      await renderShell();
      const box = document.createElement('textarea');
      document.body.appendChild(box);
      box.focus();
      await user.keyboard('w');
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
      box.remove();
      await user.keyboard('w');
      expect(popover()).toBeInTheDocument();
      // Focus is on the first switch now; W still closes it.
      await user.keyboard('w');
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
    });

    it('fades with the rest of the chrome when it auto-hides', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      const nav = screen.getByRole('navigation', { name: 'Dock' });
      const fades = [...nav.classList].find((c) => /fades/.test(c));
      expect(fades).toBeDefined();
      expect(popover()).toHaveClass(fades!);
      expect(popover().closest('[data-chrome]')).not.toBeNull();
    });

    it('opening a full-window overlay closes it', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.click(screen.getByRole('button', { name: 'Widgets' }));
      await user.keyboard('s');
      expect(screen.getByRole('dialog', { name: 'Stats' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
    });
  });

  describe('Focus view', () => {
    const shell = () => screen.getByTestId('shell');
    const fadesClass = () => {
      const nav = screen.getByRole('navigation', { name: 'Dock' });
      return [...nav.classList].find((c) => /fades/.test(c))!;
    };

    it('H hides the interface and a mouse move keeps it hidden; H again shows it', async () => {
      const user = userEvent.setup();
      await renderShell();
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
      await user.keyboard('h');
      expect(useStudyStore.getState().focusView).toBe(true);
      expect(shell()).toHaveAttribute('data-chrome', 'hidden');
      fireEvent.mouseMove(window);
      await user.keyboard('r');
      expect(shell()).toHaveAttribute('data-chrome', 'hidden');
      await user.keyboard('h');
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
    });

    it('Esc with nothing open leaves focus view', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('h');
      await user.keyboard('{Escape}');
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
    });

    it('Stats opens over focus view, and Esc closes Stats but stays in focus view', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('h');
      await user.keyboard('s');
      expect(screen.getByRole('dialog', { name: 'Stats' })).toBeInTheDocument();
      expect(shell()).toHaveAttribute('data-overlay', 'stats');
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Stats' })).not.toBeInTheDocument();
      expect(useStudyStore.getState().focusView).toBe(true);
      expect(shell()).toHaveAttribute('data-chrome', 'hidden');
    });

    it('Esc in focus view leaves it and leaves an open panel alone, which shows again', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('g');
      await user.keyboard('h');
      await user.keyboard('{Escape}');
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(useStudyStore.getState().openPanel).toBe('spaces');
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
      await user.keyboard('{Escape}');
      expect(useStudyStore.getState().openPanel).toBeNull();
    });

    it.each([
      ['w', () => useStudyStore.getState().widgetsPopover],
      ['k', () => useStudyStore.getState().openPanel === 'sounds'],
      ['g', () => useStudyStore.getState().openPanel === 'spaces'],
    ])('%s leaves focus view and opens what it names', async (key, isOpen) => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('h');
      await user.keyboard(key);
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(isOpen()).toBe(true);
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
    });

    it('G leaves focus view and keeps a hidden Spaces panel open rather than closing it', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('g');
      await user.keyboard('h');
      await user.keyboard('g');
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(useStudyStore.getState().openPanel).toBe('spaces');
    });

    it('T leaves focus view when Tasks auto-hides, and shows it open', async () => {
      const user = userEvent.setup();
      const settings = onboarded();
      settings.widgets.tasks = { ...settings.widgets.tasks, open: false, autoHide: true };
      await renderShell(mockApi({ settings: { get: vi.fn(() => Promise.resolve(settings)) } }));
      await user.keyboard('h');
      await user.keyboard('t');
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
      expect(await screen.findByRole('group', { name: 'Tasks' })).toBeInTheDocument();
    });

    it('T on an auto-hide Tasks that is already open shows it rather than closing it', async () => {
      const user = userEvent.setup();
      const settings = onboarded();
      settings.widgets.tasks = { ...settings.widgets.tasks, open: true, autoHide: true };
      await renderShell(mockApi({ settings: { get: vi.fn(() => Promise.resolve(settings)) } }));
      await user.keyboard('h');
      await user.keyboard('t');
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(screen.getByRole('group', { name: 'Tasks' })).toBeInTheDocument();
    });

    it('T stays in focus view when Tasks does not auto-hide', async () => {
      const user = userEvent.setup();
      const settings = onboarded();
      settings.widgets.tasks = { ...settings.widgets.tasks, open: false, autoHide: false };
      await renderShell(mockApi({ settings: { get: vi.fn(() => Promise.resolve(settings)) } }));
      await user.keyboard('h');
      await user.keyboard('t');
      expect(useStudyStore.getState().focusView).toBe(true);
      expect(await screen.findByRole('group', { name: 'Tasks' })).toBeInTheDocument();
    });

    it('the Show interface capsule appears only with the pointer in the top-left corner', async () => {
      const user = userEvent.setup();
      await renderShell();
      const capsule = () => screen.queryByRole('button', { name: 'Show interface' });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
      expect(capsule()).not.toBeInTheDocument();
      await user.keyboard('h');
      fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
      expect(capsule()).not.toBeInTheDocument();
      fireEvent.pointerMove(window, { clientX: 64, clientY: 20 });
      expect(capsule()).not.toBeInTheDocument();
      fireEvent.pointerMove(window, { clientX: 63, clientY: 63 });
      expect(capsule()).toBeInTheDocument();
      fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
      expect(capsule()).not.toBeInTheDocument();
      fireEvent.pointerMove(window, { clientX: 20, clientY: 20 });
      fireEvent.click(capsule()!);
      expect(useStudyStore.getState().focusView).toBe(false);
      expect(shell()).toHaveAttribute('data-chrome', 'shown');
      expect(capsule()).not.toBeInTheDocument();
    });

    it('hides auto-hide widgets and leaves the others', async () => {
      const user = userEvent.setup();
      const settings = onboarded();
      settings.widgets.tasks = { ...settings.widgets.tasks, open: true, autoHide: true };
      await renderShell(mockApi({ settings: { get: vi.fn(() => Promise.resolve(settings)) } }));
      await user.keyboard('h');
      const fades = fadesClass();
      expect(shell()).toHaveAttribute('data-chrome', 'hidden');
      expect(shell()).toHaveAttribute('data-focus-view', 'on');
      expect(screen.getByRole('group', { name: 'Tasks' })).toHaveClass(fades);
      expect(screen.getByRole('group', { name: 'Timer' })).not.toHaveClass(fades);
    });

    it('4 switches the timer to Countdown', async () => {
      const user = userEvent.setup();
      const api = await renderShell();
      await user.keyboard('4');
      expect(api.timer.setMode).toHaveBeenCalledWith('countdown');
    });

    it('is off after a reset', async () => {
      const user = userEvent.setup();
      await renderShell();
      await user.keyboard('h');
      act(() => resetStudyStore());
      expect(useStudyStore.getState().focusView).toBe(false);
    });
  });
});
