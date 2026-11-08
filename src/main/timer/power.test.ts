import { EventEmitter } from 'node:events';
import type { PowerMonitor } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { TimerController } from './controller';
import { systemIdleSeconds, wirePower } from './power';

function fakeController() {
  return { onSuspend: vi.fn(), onResume: vi.fn(), onLock: vi.fn(), onUnlock: vi.fn() };
}

describe('wirePower', () => {
  it('routes suspend, resume, lock and unlock to the controller', () => {
    const pm = new EventEmitter();
    const c = fakeController();
    wirePower(pm as unknown as PowerMonitor, c as unknown as TimerController);
    pm.emit('suspend');
    pm.emit('resume');
    pm.emit('lock-screen');
    pm.emit('unlock-screen');
    expect(c.onSuspend).toHaveBeenCalledTimes(1);
    expect(c.onResume).toHaveBeenCalledTimes(1);
    expect(c.onLock).toHaveBeenCalledTimes(1);
    expect(c.onUnlock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes every listener', () => {
    const pm = new EventEmitter();
    const off = wirePower(pm as unknown as PowerMonitor, fakeController() as unknown as TimerController);
    off();
    expect(pm.eventNames()).toEqual([]);
  });

  it('reads the system idle time', () => {
    expect(systemIdleSeconds({ getSystemIdleTime: () => 42 })()).toBe(42);
  });
});
