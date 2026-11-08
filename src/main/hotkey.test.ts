import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db/db';
import { NOW, openTestDb, tempDir } from './db/test-helpers';
import { GlobalHotkey, guardHotkeySetting, PRESS_GAP_MS, type ShortcutRegistry } from './hotkey';
import { TimerController } from './timer/controller';
import { FakeClock } from './timer/test-clock';

/** A stand-in for Electron's `globalShortcut`; `taken` accelerators belong to another app. */
function fakeRegistry(taken: string[] = []) {
  const live = new Map<string, () => void>();
  const registry: ShortcutRegistry = {
    register: vi.fn((accel: string, cb: () => void) => {
      if (accel === 'Nonsense+') throw new Error('Failed to parse accelerator');
      if (taken.includes(accel) || live.has(accel)) return false;
      live.set(accel, cb);
      return true;
    }),
    unregister: vi.fn((accel: string) => {
      live.delete(accel);
    }),
  };
  const press = (accel: string): void => live.get(accel)?.();
  return { registry, live, press };
}

describe('GlobalHotkey', () => {
  let time = 0;
  const now = (): number => time;

  it('registers the accelerator and calls onPress', () => {
    const { registry, live, press } = fakeRegistry();
    const onPress = vi.fn();
    const hk = new GlobalHotkey(registry, onPress, now);
    expect(hk.register('Ctrl+Alt+P')).toEqual({ ok: true });
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
    press('Ctrl+Alt+P');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hk.active).toBe('Ctrl+Alt+P');
  });

  it('hotkey registration failure returns error', () => {
    const { registry, live } = fakeRegistry(['Ctrl+Alt+S']);
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    hk.register('Ctrl+Alt+P');
    expect(hk.register('Ctrl+Alt+S')).toEqual({
      ok: false,
      error: 'Ctrl+Alt+S is in use by another app. Choose another shortcut.',
    });
    // The previous hotkey stays live.
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
    expect(hk.active).toBe('Ctrl+Alt+P');
  });

  it('a malformed accelerator is an error, not a throw', () => {
    const { registry } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    expect(hk.register('Nonsense+')).toEqual({
      ok: false,
      error: 'Nonsense+ can’t be used as a shortcut. Choose another shortcut.',
    });
    expect(hk.active).toBe('');
  });

  it('switches to a new accelerator and releases the old one', () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    hk.register('Ctrl+Alt+P');
    expect(hk.register('Ctrl+Shift+F')).toEqual({ ok: true });
    expect([...live.keys()]).toEqual(['Ctrl+Shift+F']);
  });

  it('re-registering the same accelerator is a no-op', () => {
    const { registry } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    hk.register('Ctrl+Alt+P');
    expect(hk.register('Ctrl+Alt+P')).toEqual({ ok: true });
    expect(registry.register).toHaveBeenCalledTimes(1);
  });

  it('an empty accelerator turns the hotkey off', () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    hk.register('Ctrl+Alt+P');
    expect(hk.register('')).toEqual({ ok: true });
    expect(live.size).toBe(0);
    expect(hk.active).toBe('');
  });

  it('ignores key-repeat presses that arrive within the gap', () => {
    const { registry, press } = fakeRegistry();
    const onPress = vi.fn();
    const hk = new GlobalHotkey(registry, onPress, now);
    hk.register('Ctrl+Alt+P');
    time = 1_000;
    press('Ctrl+Alt+P');
    time += 30;
    press('Ctrl+Alt+P');
    time += PRESS_GAP_MS;
    press('Ctrl+Alt+P');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('dispose releases the shortcut', () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), now);
    hk.register('Ctrl+Alt+P');
    hk.dispose();
    expect(live.size).toBe(0);
  });
});

describe('guardHotkeySetting', () => {
  const setup = (taken: string[] = [], trusted = true) => {
    const { registry, live } = fakeRegistry(taken);
    const hk = new GlobalHotkey(registry, vi.fn(), () => 0);
    hk.register('Ctrl+Alt+P');
    type Listener = (event: unknown, ...args: unknown[]) => unknown;
    const handlers = new Map<string, Listener>();
    const ipc = { handle: (c: string, l: Listener) => void handlers.set(c, l) };
    const saved: unknown[] = [];
    const guarded = guardHotkeySetting(ipc, 'settings:set', hk, () => trusted);
    guarded.handle('settings:set', (_e, patch) => {
      saved.push(patch);
      return patch;
    });
    guarded.handle('timer:get', () => 'state');
    const call = (c: string, ...args: unknown[]): unknown => handlers.get(c)?.({}, ...args);
    return { hk, live, saved, call };
  };

  it('a taken hotkey rejects before saving and keeps the old one live and stored', () => {
    const { hk, live, saved, call } = setup(['Ctrl+Alt+K']);
    expect(() => call('settings:set', { globalHotkey: 'Ctrl+Alt+K', notifications: false })).toThrow(
      'Ctrl+Alt+K is in use by another app. Choose another shortcut.',
    );
    expect(saved).toEqual([]);
    expect(hk.active).toBe('Ctrl+Alt+P');
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
  });

  it('a free hotkey is registered, then the patch is saved', () => {
    const { hk, saved, call } = setup();
    call('settings:set', { globalHotkey: 'Ctrl+Shift+F' });
    expect(hk.active).toBe('Ctrl+Shift+F');
    expect(saved).toEqual([{ globalHotkey: 'Ctrl+Shift+F' }]);
  });

  it('other patches and channels pass straight through', () => {
    const { hk, saved, call } = setup();
    call('settings:set', { notifications: false });
    expect(call('timer:get')).toBe('state');
    expect(saved).toEqual([{ notifications: false }]);
    expect(hk.active).toBe('Ctrl+Alt+P');
  });

  // Review finding 3: a patch that fails to save leaves the previous hotkey live.
  it('a save that throws puts the previous hotkey back', () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), () => 0);
    hk.register('Ctrl+Alt+P');
    let listener: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
    const guarded = guardHotkeySetting({ handle: (_c, l) => void (listener = l) }, 'settings:set', hk);
    guarded.handle('settings:set', () => {
      throw new Error('Invalid settings');
    });
    expect(() => listener?.({}, { globalHotkey: 'Ctrl+Shift+F', notifications: 'yes' })).toThrow('Invalid settings');
    expect(hk.active).toBe('Ctrl+Alt+P');
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
  });

  it('a save that rejects puts the previous hotkey back', async () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), () => 0);
    hk.register('Ctrl+Alt+P');
    let listener: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
    const guarded = guardHotkeySetting({ handle: (_c, l) => void (listener = l) }, 'settings:set', hk);
    guarded.handle('settings:set', () => Promise.reject(new Error('disk full')));
    await expect(listener?.({}, { globalHotkey: 'Ctrl+Shift+F' })).rejects.toThrow('disk full');
    expect(hk.active).toBe('Ctrl+Alt+P');
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
  });

  it('turning the hotkey off is undone too when the save fails', () => {
    const { registry, live } = fakeRegistry();
    const hk = new GlobalHotkey(registry, vi.fn(), () => 0);
    hk.register('Ctrl+Alt+P');
    let listener: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
    const guarded = guardHotkeySetting({ handle: (_c, l) => void (listener = l) }, 'settings:set', hk);
    guarded.handle('settings:set', () => {
      throw new Error('Invalid settings');
    });
    expect(() => listener?.({}, { globalHotkey: '' })).toThrow('Invalid settings');
    expect(hk.active).toBe('Ctrl+Alt+P');
    expect([...live.keys()]).toEqual(['Ctrl+Alt+P']);
  });

  it('an untrusted sender never touches the hotkey', () => {
    const { hk, call } = setup([], false);
    call('settings:set', { globalHotkey: 'Ctrl+Shift+F' });
    expect(hk.active).toBe('Ctrl+Alt+P');
  });
});

describe('GlobalHotkey with the real timer (Review Focus 5)', () => {
  let cleanup: () => void;
  let db: Db;
  let clock: FakeClock;
  let timer: TimerController;

  beforeEach(async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    db = await openTestDb(t.dir, NOW);
    clock = new FakeClock(NOW);
    timer = new TimerController({
      db,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      uuid: () => 'p-1',
      idleSeconds: () => 0,
      emit: { state: () => undefined, away: () => undefined, segmentEnd: () => undefined },
    });
  });
  afterEach(async () => {
    timer.dispose();
    await db.close();
    cleanup();
  });

  it('hotkey resumes a lock-paused timer once', () => {
    const { registry, press } = fakeRegistry();
    const toggle = vi.spyOn(timer, 'toggle');
    const hk = new GlobalHotkey(registry, () => timer.toggle(), clock.now);
    hk.register('Ctrl+Alt+P');

    timer.start();
    clock.advance(60_000);
    timer.onLock();
    clock.advance(60_000);
    timer.onUnlock();
    expect(timer.getState()).toMatchObject({ status: 'paused', pauseReason: 'lock' });

    press('Ctrl+Alt+P');
    clock.advance(20); // the key auto-repeats while held
    press('Ctrl+Alt+P');

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(timer.getState()).toMatchObject({ status: 'running', pauseReason: null });
  });
});
