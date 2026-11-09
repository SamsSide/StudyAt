import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/ipc';
import { FLUSH_LIMIT_MS, createRendererFlush, type FlushTarget } from './flush';
import { QUIT_LIMIT_MS } from './windows';

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout: vi.fn((fn: () => void, _ms: number): unknown => {
      pending.set(next, fn);
      return next++;
    }),
    clearTimeout: vi.fn((h: unknown) => void pending.delete(h as number)),
    fire: () => {
      for (const [h, fn] of [...pending]) {
        pending.delete(h);
        fn();
      }
    },
    pending,
  };
}

const target = (id: number, destroyed = false) => ({
  id,
  isDestroyed: () => destroyed,
  send: vi.fn<FlushTarget['send']>(),
});

describe('createRendererFlush', () => {
  it('fits well inside the quit limit', () => {
    expect(FLUSH_LIMIT_MS).toBe(1_000);
    expect(FLUSH_LIMIT_MS).toBeLessThan(QUIT_LIMIT_MS);
  });

  it('sends app:flush to every live renderer and resolves once each has acked', async () => {
    const timers = fakeTimers();
    const a = target(1);
    const b = target(2);
    const gone = target(3, true);
    const f = createRendererFlush({ targets: () => [a, b, gone], ...timers });
    let done = false;
    const p = f.flush().then(() => (done = true));
    expect(a.send).toHaveBeenCalledWith(CHANNELS.events.appFlush, undefined);
    expect(b.send).toHaveBeenCalledWith(CHANNELS.events.appFlush, undefined);
    expect(gone.send).not.toHaveBeenCalled();
    f.ack({ id: 1 });
    f.ack({ id: 99 }); // not one of them
    await Promise.resolve();
    expect(done).toBe(false);
    f.ack({ id: 2 });
    await p;
    expect(done).toBe(true);
    expect(timers.pending.size).toBe(0); // the limit was cleared
  });

  it('gives up waiting after the limit', async () => {
    const timers = fakeTimers();
    const f = createRendererFlush({ targets: () => [target(1)], ...timers });
    const p = f.flush();
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), FLUSH_LIMIT_MS);
    timers.fire();
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves at once with no renderer, and when a send throws', async () => {
    const timers = fakeTimers();
    await createRendererFlush({ targets: () => [], ...timers }).flush();
    const broken = target(1);
    broken.send.mockImplementation(() => {
      throw new Error('frame disposed');
    });
    await createRendererFlush({ targets: () => [broken], ...timers }).flush();
    expect(timers.pending.size).toBe(0);
  });

  it('an ack outside a flush is ignored', async () => {
    const timers = fakeTimers();
    const f = createRendererFlush({ targets: () => [target(1)], ...timers });
    f.ack({ id: 1 });
    const p = f.flush();
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    f.ack({ id: 1 });
    await p;
  });
  it('a second flush while one is in flight returns the same promise and sends nothing again', async () => {
    const timers = fakeTimers();
    const a = target(1);
    const f = createRendererFlush({ targets: () => [a], ...timers });
    const first = f.flush();
    const second = f.flush();
    expect(second).toBe(first);
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(timers.setTimeout).toHaveBeenCalledTimes(1);
    f.ack({ id: 1 });
    await expect(second).resolves.toBeUndefined();
    // Once settled, a later flush asks again.
    void f.flush();
    expect(a.send).toHaveBeenCalledTimes(2);
  });
});
