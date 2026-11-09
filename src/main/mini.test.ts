import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/types';
import { MINI_MARGIN, MINI_SIZE, MiniWindow, placeMini, type MiniDeps } from './mini';
import { FakeWindow, fakeSettings, fakeTimers } from './test-electron';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 1280, height: 984 };

function setup(init: Partial<Settings> = {}) {
  const settings = fakeSettings(init);
  const timers = fakeTimers();
  const wins: FakeWindow[] = [];
  const shown: boolean[] = [];
  const removers: ReturnType<typeof vi.fn>[] = [];
  let quitting = false;
  const deps: MiniDeps = {
    create: (opts) => {
      const w = new FakeWindow(opts);
      wins.push(w);
      return w.asWindow();
    },
    preload: '/out/preload/index.js',
    url: () => Promise.resolve('http://127.0.0.1:5000/mini.html'),
    harden: vi.fn(),
    addTarget: vi.fn(() => {
      const r = vi.fn();
      removers.push(r);
      return r;
    }),
    settings,
    screen: { workAreas: () => [PRIMARY, SECOND], primaryWorkArea: () => PRIMARY },
    isQuitting: () => quitting,
    onShown: (s) => shown.push(s),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const mini = new MiniWindow(deps);
  const win = (): FakeWindow => {
    const w = wins[0];
    if (!w) throw new Error('no mini window yet');
    return w;
  };
  /** Lets an auto show finish loading. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  return { mini, deps, settings, timers, wins, win, shown, removers, settle, quit: () => (quitting = true) };
}

describe('placeMini', () => {
  it('defaults to the bottom-right of the primary work area, 24 px in', () => {
    expect(placeMini(null, [PRIMARY], PRIMARY)).toEqual({
      x: 1920 - MINI_SIZE.width - MINI_MARGIN,
      y: 1040 - MINI_SIZE.height - MINI_MARGIN,
    });
    expect(MINI_SIZE).toEqual({ width: 240, height: 96 });
    expect(MINI_MARGIN).toBe(24);
  });

  it('keeps a saved spot on any display', () => {
    expect(placeMini({ x: 2000, y: 100 }, [PRIMARY, SECOND], PRIMARY)).toEqual({ x: 2000, y: 100 });
  });

  it('pulls a partly off-screen spot back inside', () => {
    expect(placeMini({ x: 1800, y: 1000 }, [PRIMARY], PRIMARY)).toEqual({ x: 1680, y: 944 });
  });

  it('falls back when the saved display has gone', () => {
    expect(placeMini({ x: 2000, y: 100 }, [PRIMARY], PRIMARY)).toEqual({ x: 1656, y: 920 });
  });
});

describe('MiniWindow', () => {
  it('is a 240×96 frameless, transparent, always-on-top, sandboxed window off the taskbar', async () => {
    const { mini, win, deps } = setup();
    await mini.show();
    expect(win().opts).toMatchObject({
      width: 240,
      height: 96,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: '/out/preload/index.js',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    expect(win().setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(win().url).toBe('http://127.0.0.1:5000/mini.html');
    expect(deps.harden).toHaveBeenCalledWith(win().webContents);
    expect(deps.addTarget).toHaveBeenCalledWith(win().webContents);
    // Shown without stealing focus.
    expect(win().showInactive).toHaveBeenCalled();
  });

  it('pushes app:mini on every show and hide, whatever the cause (R24)', async () => {
    const { mini, win, shown } = setup();
    await mini.show();
    mini.hide();
    await mini.toggle();
    win().close(); // Alt+F4 hides
    expect(win().destroyed).toBe(false);
    expect(shown).toEqual([true, false, true, false]);
    expect(mini.isShown()).toBe(false);
  });

  it('mini shows when main hidden and timer running, hides when main shown', async () => {
    const { mini, win, settle } = setup();
    mini.syncWithMain(true, true);
    mini.syncWithMain(false, true);
    await settle();
    expect(mini.isShown()).toBe(true);
    expect(win().showInactive).toHaveBeenCalledTimes(1);
    mini.syncWithMain(true, true);
    expect(mini.isShown()).toBe(false);
  });

  it('mini stays hidden when miniWhenHidden false', async () => {
    const { mini, wins, settle } = setup({ miniWhenHidden: false });
    mini.syncWithMain(false, true);
    await settle();
    expect(mini.isShown()).toBe(false);
    expect(wins).toHaveLength(0);
  });

  it('does not appear for a paused timer, but does once it runs while hidden', async () => {
    const { mini, settle } = setup();
    mini.syncWithMain(false, false);
    await settle();
    expect(mini.isShown()).toBe(false);
    mini.syncWithMain(false, true); // e.g. the hotkey started it
    await settle();
    expect(mini.isShown()).toBe(true);
  });

  it('a mini Sam opened stays when the main window returns', async () => {
    const { mini } = setup();
    await mini.show();
    mini.syncWithMain(false, true);
    mini.syncWithMain(true, true);
    expect(mini.isShown()).toBe(true);
  });

  it('a mini Sam closed is not reopened by every tick', async () => {
    const { mini, settle } = setup();
    mini.syncWithMain(false, true);
    await settle();
    mini.hide();
    mini.syncWithMain(false, true);
    await settle();
    expect(mini.isShown()).toBe(false);
  });

  it('a hide while still loading wins', async () => {
    const { mini, wins } = setup();
    const showing = mini.show();
    mini.hide();
    await showing;
    expect(wins[0]?.showInactive).not.toHaveBeenCalled();
    expect(mini.isShown()).toBe(false);
  });

  it('remembers its position, debounced, and reopens there', async () => {
    const { mini, win, settings, timers } = setup();
    await mini.show();
    win().moveTo(400, 300);
    win().moveTo(420, 310);
    expect(settings.set).not.toHaveBeenCalled();
    timers.flush();
    expect(settings.get().miniPos).toEqual({ x: 420, y: 310 });

    const next = setup({ miniPos: { x: 420, y: 310 } });
    await next.mini.show();
    expect(next.win().setPosition).toHaveBeenLastCalledWith(420, 310);
  });

  it('is clamped onto a visible display when shown', async () => {
    const { mini, win } = setup({ miniPos: { x: 5000, y: 5000 } });
    await mini.show();
    expect(win().setPosition).toHaveBeenLastCalledWith(1656, 920);
  });

  it('flush writes a pending position and then nothing more', async () => {
    const { mini, win, settings, timers } = setup();
    await mini.show();
    win().moveTo(10, 20);
    mini.flush();
    expect(settings.get().miniPos).toEqual({ x: 10, y: 20 });
    win().moveTo(30, 40);
    timers.flush();
    expect(settings.get().miniPos).toEqual({ x: 10, y: 20 });
  });

  it('closes for real when quitting and leaves the broadcaster', async () => {
    const { mini, win, quit, removers, shown } = setup();
    await mini.show();
    quit();
    win().close();
    expect(win().destroyed).toBe(true);
    expect(removers[0]).toHaveBeenCalled();
    expect(shown).toEqual([true, false]);
  });

  it('a load failure is logged and the next show tries again', async () => {
    const { mini, deps, wins } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const url = vi.spyOn(deps, 'url').mockRejectedValueOnce(new Error('server gone'));
    await mini.show();
    expect(err).toHaveBeenCalled();
    expect(wins[0]?.destroyed).toBe(true);
    await mini.show();
    expect(url).toHaveBeenCalledTimes(2);
    expect(mini.isShown()).toBe(true);
  });
});
