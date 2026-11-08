import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../shared/ipc';
import { idleTimerState, installMockApi, mockApi } from './mockApi';

describe('mockApi', () => {
  it('covers every method named in CHANNELS', () => {
    const api = mockApi() as unknown as Record<string, Record<string, unknown>>;
    for (const [group, methods] of Object.entries(CHANNELS)) {
      if (group === 'events') continue;
      for (const method of Object.keys(methods)) {
        expect(typeof api[group]?.[method], `${group}.${method}`).toBe('function');
      }
    }
  });

  it('resolves an idle 25:00 timer and the six seed subjects', async () => {
    const api = mockApi();
    expect(await api.timer.get()).toEqual(idleTimerState());
    expect((await api.subjects.list()).map((s) => s.name)).toHaveLength(6);
    expect((await api.settings.get()).focusMinutes).toBe(25);
  });

  it('drives and unsubscribes event listeners', () => {
    const api = mockApi();
    const cb = vi.fn();
    const off = api.timer.onState(cb);
    api.emitState({ ...idleTimerState(), status: 'running' });
    off();
    api.emitState(idleTimerState());
    expect(cb).toHaveBeenCalledTimes(1);

    const away = vi.fn();
    api.timer.onAwayPrompt(away);
    api.emitAway({ awayMs: 1, deadline: 2 });
    api.emitAway(null);
    expect(away).toHaveBeenNthCalledWith(2, null);

    const end = vi.fn();
    api.timer.onSegmentEnd(end);
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    expect(end).toHaveBeenCalledWith({ mode: 'focus', next: 'short' });

    const fs = vi.fn();
    api.app.onFullscreen(fs)();
    api.emitFullscreen(true);
    expect(fs).not.toHaveBeenCalled();
  });

  it('honours overrides and installs on window', () => {
    const start = vi.fn(() => Promise.resolve({ ...idleTimerState(), status: 'running' as const }));
    const api = mockApi({ timer: { start } });
    installMockApi(api);
    expect(window.studyat).toBe(api);
    expect(api.timer.pause).toBeDefined();
    void window.studyat.timer.start();
    expect(start).toHaveBeenCalled();
  });
});
