import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.settings.set).mockRejectedValueOnce(new Error('disk full'));
    await act(() => useStudyStore.getState().patchWidget('tasks', { x: 0.1, y: 0.2 }));
    expect(useStudyStore.getState().settings!.widgets.tasks).toEqual(before);
    stop();
  });

  it('setPanel and setOverlay', () => {
    useStudyStore.getState().setPanel('spaces');
    useStudyStore.getState().setOverlay('help');
    expect(useStudyStore.getState()).toMatchObject({ openPanel: 'spaces', overlay: 'help' });
  });
});
