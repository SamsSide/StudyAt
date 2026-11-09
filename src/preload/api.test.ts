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
