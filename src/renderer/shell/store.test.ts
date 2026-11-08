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

  it('follows app.onFullscreen', async () => {
    const api = mockApi();
    installMockApi(api);
    const stop = initStudyStore();
    api.emitFullscreen(true);
    expect(useStudyStore.getState().fullscreen).toBe(true);
    stop();
  });

  it('setPanel and setOverlay', () => {
    useStudyStore.getState().setPanel('spaces');
    useStudyStore.getState().setOverlay('help');
    expect(useStudyStore.getState()).toMatchObject({ openPanel: 'spaces', overlay: 'help' });
  });
});
