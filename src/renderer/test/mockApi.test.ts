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

    const mini = vi.fn();
    const offMini = api.app.onMini(mini);
    api.emitMini(true);
    offMini();
    api.emitMini(false);
    expect(mini.mock.calls).toEqual([[true]]);

    const vis = vi.fn();
    api.app.onVisibility(vis);
    api.emitVisibility(false);
    expect(vis).toHaveBeenCalledWith(false);
  });

  it('emitFlush runs and awaits every onFlush callback', async () => {
    const api = mockApi();
    let done = false;
    const off = api.app.onFlush(() => Promise.resolve().then(() => void (done = true)));
    await api.emitFlush();
    expect(done).toBe(true);
    off();
    done = false;
    await api.emitFlush();
    expect(done).toBe(false);
    await expect(api.app.flushed()).resolves.toBeUndefined();
  });

  it('emitSettings drives settings.onChanged', async () => {
    const api = mockApi();
    const cb = vi.fn();
    const off = api.settings.onChanged(cb);
    const base = await api.settings.get();
    const next = { ...base, focusMinutes: 40 };
    api.emitSettings(next);
    off();
    api.emitSettings(base);
    expect(cb.mock.calls).toEqual([[next]]);
  });

  it('emitOpenTask and emitPlannerChanged drive the planner events, and unsubscribe', async () => {
    const api = mockApi();
    const open = vi.fn();
    const changed = vi.fn();
    const offOpen = api.planner.onOpenTask(open);
    const offChanged = api.planner.onChanged(changed);
    api.emitOpenTask(7);
    api.emitPlannerChanged();
    offOpen();
    offChanged();
    api.emitOpenTask(8);
    api.emitPlannerChanged();
    expect(open.mock.calls).toEqual([[7]]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith();
  });

  it('defaults the planner, task, subtask, list and timer additions', async () => {
    const api = mockApi();
    expect(await api.planner.week('2026-11-09')).toMatchObject({ tasks: [], deadlines: [], studiedMs: {} });
    expect(await api.planner.lists()).toEqual({ lists: [], tasks: [], deadlines: [] });
    expect(await api.planner.task(1)).toBeNull();
    expect(await api.tasks.create({ title: 'x' })).toEqual({ tasks: [], removed: [] });
    expect((await api.subtasks.add(1, 'x')).subtasks).toEqual([]);
    expect(await api.lists.remove(1)).toEqual({ lists: [], removed: [] });
    expect(await api.lists.create({ name: 'x' })).toEqual([]);
    expect(await api.timer.startTask(1)).toEqual(idleTimerState());
    expect(await api.timer.setIntention(null)).toEqual(idleTimerState());
    expect(await api.timer.setOutcome('p', 'done')).toEqual(idleTimerState());
    expect(await api.legacyTasks.list()).toEqual([]);
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

  it('returns a seven-day Monday..Sunday empty week', async () => {
    const week = await mockApi().stats.week();
    expect(week.days.map((d) => d.dayKey)).toEqual([
      '1970-01-05',
      '1970-01-06',
      '1970-01-07',
      '1970-01-08',
      '1970-01-09',
      '1970-01-10',
      '1970-01-11',
    ]);
    expect(week.days.every((d) => d.ms === 0)).toBe(true);
  });

  it('settings.set merges widgets and never exposes spotifyTokens', async () => {
    const api = mockApi();
    const out = await api.settings.set({
      widgets: { tasks: { open: true, x: 0.3, y: 0.3, autoHide: false, scale: 1 } },
    });
    expect(out.widgets.timer).toBeDefined();
    expect(out.widgets.tasks.open).toBe(true);
    expect('spotifyTokens' in out).toBe(false);
    expect('spotifyTokens' in (await api.settings.get())).toBe(false);
  });
});
