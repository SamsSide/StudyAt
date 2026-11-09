import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleTimerState, installMockApi, mockApi, seedSubjects } from '../test/mockApi';
import { initStudyStore, resetStudyStore, useStudyStore } from './store';

beforeEach(() => resetStudyStore());

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe('useStudyStore', () => {
  it('init loads timer, settings, overview and subjects, and follows timer.onState', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const s = useStudyStore.getState();
    expect(s.settings?.goalMinutes).toBe(180);
    expect(s.overview?.goalMs).toBe(180 * 60_000);
    expect(s.subjects).toEqual(seedSubjects());
    api.emitState({ ...idleTimerState(), status: 'running', remainingMs: 1000 });
    expect(useStudyStore.getState().timer.remainingMs).toBe(1000);
    stop();
    api.emitState({ ...idleTimerState(), remainingMs: 5 });
    expect(useStudyStore.getState().timer.remainingMs).toBe(1000);
  });

  it('refreshes the overview when today crosses a whole minute, not every tick', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const calls = vi.mocked(api.stats.overview).mock.calls.length;
    api.emitState({ ...idleTimerState(), todayFocusMs: 30_000 });
    api.emitState({ ...idleTimerState(), todayFocusMs: 31_000 });
    expect(api.stats.overview).toHaveBeenCalledTimes(calls);
    api.emitState({ ...idleTimerState(), todayFocusMs: 60_000 });
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 1);
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 2);
    stop();
  });

  it('openSettings opens Settings, optionally on a section, and closes the Widgets popover', () => {
    useStudyStore.setState({ widgetsPopover: true });
    useStudyStore.getState().openSettings('Weather');
    let s = useStudyStore.getState();
    expect(s.overlay).toBe('settings');
    expect(s.settingsSection).toBe('Weather');
    expect(s.widgetsPopover).toBe(false);
    s.openSettings();
    s = useStudyStore.getState();
    expect(s.overlay).toBe('settings');
    expect(s.settingsSection).toBeNull();
  });

  it('replaces settings with what main pushes, and stops on unsubscribe', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const base = useStudyStore.getState().settings!;
    const london = {
      name: 'London',
      admin1: 'England',
      country: 'United Kingdom',
      latitude: 51.5,
      longitude: -0.13,
    };
    api.emitSettings({ ...base, weatherPlace: london });
    expect(useStudyStore.getState().settings?.weatherPlace).toEqual(london);
    stop();
    api.emitSettings({ ...base, focusMinutes: 40 });
    expect(useStudyStore.getState().settings?.focusMinutes).toBe(base.focusMinutes);
  });

  it('follows app.onFullscreen', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    api.emitFullscreen(true);
    expect(useStudyStore.getState().fullscreen).toBe(true);
    stop();
  });

  it('refreshes the overview when the window regains focus or becomes visible', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const calls = vi.mocked(api.stats.overview).mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 2);
    stop();
    window.dispatchEvent(new Event('focus'));
    expect(api.stats.overview).toHaveBeenCalledTimes(calls + 2);
  });

  it('a widget change that fails to save goes back to what main has', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const before = useStudyStore.getState().settings!.widgets.tasks;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(api.settings.set).mockRejectedValueOnce(new Error('disk full'));
    await act(() => useStudyStore.getState().patchWidget('tasks', { x: 0.1, y: 0.2 }));
    expect(useStudyStore.getState().settings!.widgets.tasks).toEqual(before);
    stop();
  });

  it('refreshes the overview when the goal, streak threshold or rollover hour changes', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    await flush();
    const overview = vi.mocked(api.stats.overview);
    const base = useStudyStore.getState().settings!;
    let calls = overview.mock.calls.length;
    // Anything else changing leaves the overview alone.
    api.emitSettings({ ...base, autoHideSeconds: 9 });
    expect(overview).toHaveBeenCalledTimes(calls);
    api.emitSettings({ ...base, goalMinutes: 120 });
    expect(overview).toHaveBeenCalledTimes(++calls);
    api.emitSettings({ ...base, goalMinutes: 120, streakMinutes: 40 });
    expect(overview).toHaveBeenCalledTimes(++calls);
    await act(() => useStudyStore.getState().updateSettings({ rolloverHour: 5 }));
    expect(overview).toHaveBeenCalledTimes(++calls);
    stop();
    api.emitSettings({ ...base, goalMinutes: 60 });
    expect(overview).toHaveBeenCalledTimes(calls);
  });

  describe('a failed settings load', () => {
    afterEach(() => vi.useRealTimers());

    it('tries again with a backoff before giving up', async () => {
      vi.useFakeTimers();
      const api = mockApi();
      installMockApi(api);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const get = vi.mocked(api.settings.get);
      const real = get.getMockImplementation()!;
      get.mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'));
      const stop = initStudyStore();
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(get).toHaveBeenCalledTimes(1);
      expect(useStudyStore.getState().settings).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(get).toHaveBeenCalledTimes(3);
      expect(useStudyStore.getState().settings).not.toBeNull();
      expect(useStudyStore.getState().settingsFailed).toBe(false);
      expect(warn).toHaveBeenCalled();
      get.mockImplementation(real);
      stop();
    });

    it('after three failures says so, and retrySettings loads them', async () => {
      vi.useFakeTimers();
      const api = mockApi();
      installMockApi(api);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const get = vi.mocked(api.settings.get);
      const real = get.getMockImplementation()!;
      get.mockRejectedValue(new Error('busy'));
      const stop = initStudyStore();
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(get).toHaveBeenCalledTimes(3);
      expect(useStudyStore.getState().settingsFailed).toBe(true);
      get.mockImplementation(real);
      await act(() => useStudyStore.getState().retrySettings());
      expect(useStudyStore.getState().settingsFailed).toBe(false);
      expect(useStudyStore.getState().settings).not.toBeNull();
      stop();
    });
  });

  it('setPanel and setOverlay', () => {
    useStudyStore.getState().setPanel('spaces');
    useStudyStore.getState().setOverlay('help');
    expect(useStudyStore.getState()).toMatchObject({ openPanel: 'spaces', overlay: 'help' });
  });

  it('focus view starts off, toggles and is off again after a reset', () => {
    const store = useStudyStore.getState();
    expect(store.focusView).toBe(false);
    store.toggleFocusView();
    expect(useStudyStore.getState().focusView).toBe(true);
    store.toggleFocusView();
    expect(useStudyStore.getState().focusView).toBe(false);
    store.setFocusView(true);
    expect(useStudyStore.getState().focusView).toBe(true);
    resetStudyStore();
    expect(useStudyStore.getState().focusView).toBe(false);
  });
});
