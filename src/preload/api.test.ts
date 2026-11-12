import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/ipc';
import { buildApi, EVENT_METHODS, type IpcRendererLike } from './api';

type Listener = (event: unknown, payload: unknown) => void;

function fakeIpc() {
  const listeners = new Map<string, Set<Listener>>();
  const ipc: IpcRendererLike = {
    invoke: vi.fn((channel: string, ...args: unknown[]) => Promise.resolve({ channel, args })),
    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(fn);
    },
    removeListener: (channel, fn) => {
      listeners.get(channel)?.delete(fn);
    },
  };
  const emit = (channel: string, payload: unknown): void => {
    for (const fn of listeners.get(channel) ?? []) fn({ sender: 'ipc' }, payload);
  };
  return { ipc, emit, listeners };
}

const names = (api: object): string[] =>
  Object.entries(api).flatMap(([group, methods]) =>
    Object.keys(methods as object).map((m) => `${group}.${m}`),
  );

describe('preload api', () => {
  it('preload exposes exactly the StudyAtApi method names', () => {
    const fromChannels = Object.entries(CHANNELS)
      .filter(([group]) => group !== 'events')
      .flatMap(([group, methods]) => Object.keys(methods).map((m) => `${group}.${m}`));
    const expected = [...fromChannels, ...Object.keys(EVENT_METHODS)].sort();
    expect(names(buildApi(fakeIpc().ipc)).sort()).toEqual(expected);
    // Every push channel has a subscription.
    expect(Object.values(EVENT_METHODS).sort()).toEqual(Object.values(CHANNELS.events).sort());
  });

  it('invokes the named channel with the arguments', async () => {
    const { ipc } = fakeIpc();
    const api = buildApi(ipc);
    await api.subjects.update(3, { name: 'Maths' });
    expect(ipc.invoke).toHaveBeenCalledWith('subjects:update', 3, { name: 'Maths' });
    await api.sounds.relocate(7);
    expect(ipc.invoke).toHaveBeenCalledWith('sounds:relocate', 7);
  });

  it('exposes timer.setTask and stats.byTask on their channels (v1.1 spec §5)', async () => {
    const { ipc } = fakeIpc();
    const api = buildApi(ipc);
    await api.timer.setTask(4);
    expect(ipc.invoke).toHaveBeenCalledWith('timer:setTask', 4);
    await api.timer.setTask(null);
    expect(ipc.invoke).toHaveBeenCalledWith('timer:setTask', null);
    await api.stats.byTask('month');
    expect(ipc.invoke).toHaveBeenCalledWith('stats:byTask', 'month');
  });

  it('exposes the sticky, deadline, stats widget and card channels (v1.2 spec §5)', async () => {
    const { ipc } = fakeIpc();
    const api = buildApi(ipc);
    await api.notes.popOut(2);
    await api.notes.dockBack(2);
    await api.deadlines.list({ past: true });
    await api.deadlines.create({ title: 'Exam', kind: 'exam', subjectId: null, due: '2026-12-01T09:00' });
    await api.deadlines.update(1, { done: true });
    await api.deadlines.remove(1);
    await api.statWidgets.list();
    await api.statWidgets.add();
    await api.statWidgets.update(4, { range: 'month' });
    await api.statWidgets.remove(4);
    await api.stats.card('goal', 'week');
    expect((ipc.invoke as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['notes:popOut', 2],
      ['notes:dockBack', 2],
      ['deadlines:list', { past: true }],
      ['deadlines:create', { title: 'Exam', kind: 'exam', subjectId: null, due: '2026-12-01T09:00' }],
      ['deadlines:update', 1, { done: true }],
      ['deadlines:remove', 1],
      ['statWidgets:list'],
      ['statWidgets:add'],
      ['statWidgets:update', 4, { range: 'month' }],
      ['statWidgets:remove', 4],
      ['stats:card', 'goal', 'week'],
    ]);
  });

  it('exposes the planner, task, subtask, list and legacy groups on their channels', async () => {
    const { ipc } = fakeIpc();
    const api = buildApi(ipc);
    await api.planner.week('2026-11-09');
    await api.planner.task(7);
    await api.tasks.move(3, { day: '2026-11-10', index: 0 });
    await api.subtasks.reorder(3, [2, 1]);
    await api.lists.clearDone(4);
    await api.legacyTasks.list();
    await api.timer.startTask(5);
    await api.timer.setIntention(null);
    await api.timer.setOutcome('p1', 'partly');
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      ['planner:week', '2026-11-09'],
      ['planner:task', 7],
      ['tasks:move', 3, { day: '2026-11-10', index: 0 }],
      ['subtasks:reorder', 3, [2, 1]],
      ['lists:clearDone', 4],
      ['legacyTasks:list'],
      ['timer:startTask', 5],
      ['timer:setIntention', null],
      ['timer:setOutcome', 'p1', 'partly'],
    ]);
  });

  it('planner.onOpenTask passes only the task id; onChanged unsubscribes', () => {
    const { ipc, emit, listeners } = fakeIpc();
    const api = buildApi(ipc);
    const open = vi.fn();
    const off = api.planner.onOpenTask(open);
    emit(CHANNELS.events.plannerOpenTask, 12);
    off();
    emit(CHANNELS.events.plannerOpenTask, 13);
    expect(open.mock.calls).toEqual([[12]]);
    expect(listeners.get('planner:openTask')?.size).toBe(0);
    const changed = vi.fn();
    const offChanged = api.planner.onChanged(changed);
    emit(CHANNELS.events.plannerChanged, undefined);
    offChanged();
    emit(CHANNELS.events.plannerChanged, undefined);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('exposes the five images channels (v1.1 spec §5)', async () => {
    const { ipc } = fakeIpc();
    const api = buildApi(ipc);
    await api.images.list();
    await api.images.addFile();
    await api.images.addUrl('https://example.com/a.gif');
    await api.images.update(3, { x: 0.2, bare: true });
    await api.images.remove(3);
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      ['images:list'],
      ['images:addFile'],
      ['images:addUrl', 'https://example.com/a.gif'],
      ['images:update', 3, { x: 0.2, bare: true }],
      ['images:remove', 3],
    ]);
  });

  it('subscriptions pass only the payload and unsubscribe', () => {
    const { ipc, emit, listeners } = fakeIpc();
    const api = buildApi(ipc);
    const cb = vi.fn();
    const off = api.timer.onAwayPrompt(cb);
    emit(CHANNELS.events.timerAway, { awayMs: 1, deadline: 2 });
    off();
    emit(CHANNELS.events.timerAway, null);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ awayMs: 1, deadline: 2 });
    expect(listeners.get(CHANNELS.events.timerAway)?.size).toBe(0);

    const fs = vi.fn();
    api.app.onFullscreen(fs);
    emit(CHANNELS.events.appFullscreen, true);
    expect(fs).toHaveBeenCalledWith(true);
  });

  it('pushes settings changes made in main', () => {
    const { ipc, emit, listeners } = fakeIpc();
    const api = buildApi(ipc);
    const cb = vi.fn();
    const off = api.settings.onChanged(cb);
    emit(CHANNELS.events.settingsChanged, { focusMinutes: 40 });
    off();
    emit(CHANNELS.events.settingsChanged, { focusMinutes: 50 });
    expect(cb.mock.calls).toEqual([[{ focusMinutes: 40 }]]);
    expect(listeners.get('settings:changed')?.size).toBe(0);
  });

  it('pushes mini-window and main-window visibility changes (R24)', () => {
    const { ipc, emit } = fakeIpc();
    const api = buildApi(ipc);
    const mini = vi.fn();
    const offMini = api.app.onMini(mini);
    emit(CHANNELS.events.appMini, true);
    offMini();
    emit(CHANNELS.events.appMini, false);
    expect(mini.mock.calls).toEqual([[true]]);

    const vis = vi.fn();
    api.app.onVisibility(vis);
    emit(CHANNELS.events.appVisibility, false);
    emit(CHANNELS.events.appVisibility, true);
    expect(vis.mock.calls).toEqual([[false], [true]]);
  });

  it('runs every onFlush callback on app:flush, then acks with app.flushed', async () => {
    const { ipc, emit } = fakeIpc();
    const api = buildApi(ipc);
    const order: string[] = [];
    let release!: () => void;
    api.app.onFlush(() => new Promise<void>((r) => (release = () => (order.push('slow'), r()))));
    const off = api.app.onFlush(() => void order.push('gone'));
    api.app.onFlush(() => {
      throw new Error('a failing listener still acks');
    });
    off();
    emit(CHANNELS.events.appFlush, undefined);
    await Promise.resolve();
    expect(ipc.invoke).not.toHaveBeenCalledWith(CHANNELS.app.flushed);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['slow']);
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.app.flushed);
  });

  it('acks app:flush at once with no onFlush listener', async () => {
    const { ipc, emit } = fakeIpc();
    buildApi(ipc);
    emit(CHANNELS.events.appFlush, undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.app.flushed);
  });
});
