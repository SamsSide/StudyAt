import { EventEmitter } from 'node:events';
import type { MessageBoxOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { BackupInfo, TimerState } from '../shared/types';
import { FakeWindow, fakeSettings, fakeTimers } from './test-electron';
import {
  applyLoginItem,
  createMainWindow,
  installQuit,
  onceUntilFailure,
  resolveCorruptDb,
  restorableBounds,
  RESTORE_LATEST,
  SAVE_DEBOUNCE_MS,
  senderIsFrom,
  START_FRESH,
  trayTooltip,
  windowTitle,
  type MainWindowDeps,
} from './windows';

const MIN = 60_000;
const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 };

const state = (over: Partial<TimerState> = {}): TimerState => ({
  mode: 'focus',
  status: 'idle',
  remainingMs: 25 * MIN,
  segmentMs: 25 * MIN,
  completedFocusCount: 0,
  subjectId: null,
  pauseReason: null,
  todayFocusMs: 0,
  ...over,
});

function setup(over: Partial<MainWindowDeps> = {}, settingsInit = {}) {
  const settings = fakeSettings(settingsInit);
  const timers = fakeTimers();
  let fake!: FakeWindow;
  let quitting = false;
  const visibility: boolean[] = [];
  const deps: MainWindowDeps = {
    create: (opts) => {
      fake = new FakeWindow(opts);
      return fake.asWindow();
    },
    preload: '/out/preload/index.js',
    icon: '/assets/icons/icon.png',
    settings,
    workAreas: () => [SCREEN],
    isQuitting: () => quitting,
    trayNotice: vi.fn(),
    onVisibility: (v) => visibility.push(v),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...over,
  };
  const main = createMainWindow(deps);
  fake.emit('ready-to-show');
  return { main, fake, settings, timers, deps, visibility, quit: () => (quitting = true) };
}

describe('title and tooltip (spec §3.7)', () => {
  it('reads StudyAt while idle', () => {
    expect(windowTitle(state())).toBe('StudyAt');
    expect(trayTooltip(state())).toBe('StudyAt');
  });

  it('tray tooltip formats running time', () => {
    const s = state({ status: 'running', remainingMs: 12 * MIN + 33_200 });
    // Rounded up to the whole second, as the widget shows it.
    expect(trayTooltip(s)).toBe('12:34 · Focus');
    expect(windowTitle(s)).toBe('12:34 · Focus — StudyAt');
    expect(trayTooltip(state({ status: 'running', mode: 'short', remainingMs: 5 * MIN }))).toBe('05:00 · Short break');
    expect(trayTooltip(state({ status: 'running', mode: 'long', remainingMs: 90 * MIN }))).toBe('1:30:00 · Long break');
  });

  it('marks a paused timer', () => {
    const s = state({ status: 'paused', remainingMs: 10 * MIN, pauseReason: 'lock' });
    expect(windowTitle(s)).toBe('10:00 · Focus · Paused — StudyAt');
    expect(trayTooltip(s)).toBe('10:00 · Focus · Paused');
  });
});

describe('createMainWindow', () => {
  it('opens at 1280×800, min 960×600, sandboxed and hidden until ready', () => {
    const { fake } = setup();
    expect(fake.opts).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    expect(fake.show).toHaveBeenCalled();
  });

  it('close hides instead of quitting and shows tray notice once', () => {
    const { fake, deps, settings } = setup();
    expect(fake.close()).toBe(true);
    expect(fake.visible).toBe(false);
    expect(fake.destroyed).toBe(false);
    expect(deps.trayNotice).toHaveBeenCalledTimes(1);
    expect(settings.get().trayNoticeShown).toBe(true);

    fake.show();
    fake.close();
    expect(deps.trayNotice).toHaveBeenCalledTimes(1);
  });

  it('the tray notice stays shown across launches', () => {
    const { fake, deps } = setup({}, { trayNoticeShown: true });
    fake.close();
    expect(deps.trayNotice).not.toHaveBeenCalled();
  });

  it('closes for real once quitting has begun', () => {
    const { fake, quit } = setup();
    quit();
    expect(fake.close()).toBe(false);
    expect(fake.destroyed).toBe(true);
  });

  it('remembers bounds, debounced, and restores them on the next launch', () => {
    const { fake, settings, timers } = setup();
    fake.bounds = { x: 100, y: 80, width: 1400, height: 900 };
    fake.emit('resize');
    fake.emit('move');
    expect(settings.set).not.toHaveBeenCalled();
    expect(timers.size).toBe(1);
    timers.flush();
    expect(settings.get().windowBounds).toEqual({ x: 100, y: 80, width: 1400, height: 900 });
    expect(SAVE_DEBOUNCE_MS).toBe(500);

    const next = setup({}, { windowBounds: settings.get().windowBounds });
    expect(next.fake.opts).toMatchObject({ x: 100, y: 80, width: 1400, height: 900 });
  });

  it('flush writes pending bounds and then nothing more', () => {
    const { main, fake, settings, timers } = setup();
    fake.moveTo(50, 50);
    main.flush();
    expect(settings.get().windowBounds).toMatchObject({ x: 50, y: 50 });
    fake.moveTo(70, 70);
    timers.flush();
    expect(settings.get().windowBounds).toMatchObject({ x: 50, y: 50 });
    expect(timers.size).toBe(0);
  });

  it('pushes visibility on hide, minimise, restore and show, without repeats (R24)', () => {
    const { fake, visibility } = setup();
    fake.minimize();
    fake.restore();
    fake.close();
    fake.hide();
    fake.show();
    expect(visibility).toEqual([true, false, true, false, true]);
  });

  it('sets the title from the timer, only when the text changes', () => {
    const { main, fake } = setup();
    main.setTimerState(state({ status: 'running', remainingMs: 12 * MIN + 34_000 }));
    main.setTimerState(state({ status: 'running', remainingMs: 12 * MIN + 33_500 }));
    expect(fake.setTitle).toHaveBeenCalledTimes(1);
    expect(fake.title).toBe('12:34 · Focus — StudyAt');
    main.setTimerState(state());
    expect(fake.title).toBe('StudyAt');
  });

  it('keeps its own title when the page sets one', () => {
    const { fake } = setup();
    const e = { preventDefault: vi.fn() };
    fake.emit('page-title-updated', e, 'StudyAt');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('away prompt shows hidden main window', () => {
    const { main, fake } = setup();
    fake.close();
    main.onAwayPrompt(null);
    expect(fake.visible).toBe(false);
    main.onAwayPrompt({ awayMs: 11 * MIN, deadline: 0 });
    expect(fake.visible).toBe(true);
    expect(fake.focus).toHaveBeenCalled();
  });

  it('away prompt restores a minimised main window', () => {
    const { main, fake } = setup();
    fake.minimize();
    main.onAwayPrompt({ awayMs: 11 * MIN, deadline: 0 });
    expect(fake.restore).toHaveBeenCalled();
    expect(main.isVisible()).toBe(true);
  });

  it('toggle hides a visible window and reveals a hidden one', () => {
    const { main, fake } = setup();
    main.toggle();
    expect(fake.visible).toBe(false);
    main.toggle();
    expect(fake.visible).toBe(true);
    expect(fake.focus).toHaveBeenCalled();
  });
});

describe('restorableBounds', () => {
  it('drops bounds on a display that has gone', () => {
    expect(restorableBounds({ x: 3000, y: 100, width: 1280, height: 800 }, [SCREEN])).toBeNull();
    expect(restorableBounds(null, [SCREEN])).toBeNull();
  });

  it('keeps bounds whose title bar is reachable and lifts them to the minimum size', () => {
    expect(restorableBounds({ x: 1700, y: 10, width: 500, height: 300 }, [SCREEN])).toEqual({
      x: 1700,
      y: 10,
      width: 960,
      height: 600,
    });
  });
});

class FakeApp extends EventEmitter {
  quit = vi.fn(() => {
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    this.emit('before-quit', event);
    if (!event.prevented) this.exited = true;
  });
  exited = false;
}

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

describe('installQuit', () => {
  it('saves before quitting, once, and quits even if a step fails', async () => {
    const app = new FakeApp();
    const order: string[] = [];
    const shutdown = vi.fn(async () => {
      order.push('shutdown');
      await Promise.resolve();
      throw new Error('disk full');
    });
    const after = vi.fn(() => {
      order.push('server');
      return Promise.reject(new Error('already closed'));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const q = installQuit(app, shutdown, after);
    expect(q.isQuitting()).toBe(false);
    app.quit();
    app.quit(); // a second Quit while saving
    expect(q.isQuitting()).toBe(true);
    expect(app.exited).toBe(false);
    await flushPromises();
    expect(order).toEqual(['shutdown', 'server']);
    expect(app.exited).toBe(true);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('senderIsFrom', () => {
  const origin = 'http://127.0.0.1:41234';
  it('trusts the app’s own pages, main and mini', () => {
    expect(senderIsFrom({ senderFrame: { url: 'http://127.0.0.1:41234/' } }, origin)).toBe(true);
    expect(senderIsFrom({ senderFrame: { url: 'http://127.0.0.1:41234/mini.html' } }, origin)).toBe(true);
  });
  it('refuses other origins, a gone frame, no origin or a bad url', () => {
    expect(senderIsFrom({ senderFrame: { url: 'https://www.youtube.com/embed/x' } }, origin)).toBe(false);
    expect(senderIsFrom({ senderFrame: { url: 'http://127.0.0.1:9999/' } }, origin)).toBe(false);
    expect(senderIsFrom({ senderFrame: null }, origin)).toBe(false);
    expect(senderIsFrom({ senderFrame: { url: 'http://127.0.0.1:41234/' } }, null)).toBe(false);
    expect(senderIsFrom({ senderFrame: { url: 'nonsense' } }, origin)).toBe(false);
  });
});

describe('onceUntilFailure', () => {
  it('shares one run between callers', async () => {
    const fn = vi.fn(() => Promise.resolve());
    const stop = onceUntilFailure(fn);
    await Promise.all([stop(), stop()]);
    await stop();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure, so a failed flush is not given up', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const stop = onceUntilFailure(fn as () => Promise<void>);
    await expect(stop()).rejects.toThrow('disk full');
    await stop();
    await stop();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('applyLoginItem', () => {
  it('sets openAtLogin in a packaged app and skips development', () => {
    const app = { isPackaged: true, setLoginItemSettings: vi.fn() };
    expect(applyLoginItem(app, true)).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    const dev = { isPackaged: false, setLoginItemSettings: vi.fn() };
    expect(applyLoginItem(dev, true)).toBe(false);
    expect(dev.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

describe('resolveCorruptDb (spec §3.3)', () => {
  const backup: BackupInfo = { name: 'daily-2026-11-07.sqlite', size: 1, createdAt: new Date(2026, 10, 7, 9, 5).getTime() };
  const run = (response: number, latest: BackupInfo | null = backup, restored = true) => {
    const boxes: MessageBoxOptions[] = [];
    const restore = vi.fn(() => Promise.resolve(restored));
    const result = resolveCorruptDb({
      showMessageBox: (opts) => {
        boxes.push(opts);
        return Promise.resolve({ response });
      },
      keptAs: 'studyat.corrupt-2026-11-08_120000.sqlite',
      latestBackup: () => Promise.resolve(latest),
      restore,
    });
    return { result, boxes, restore };
  };

  it('offers Restore latest backup (the default, also on Esc) or Start fresh', async () => {
    const { result, boxes, restore } = run(0);
    expect(await result).toBe('restored');
    expect(boxes[0]).toMatchObject({ buttons: [RESTORE_LATEST, START_FRESH], defaultId: 0, cancelId: 0 });
    expect(RESTORE_LATEST).toBe('Restore latest backup');
    expect(START_FRESH).toBe('Start fresh');
    expect(boxes[0]?.detail).toContain('studyat.corrupt-2026-11-08_120000.sqlite');
    expect(boxes[0]?.detail).toContain('2026-11-07 09:05');
    expect(restore).toHaveBeenCalledWith('daily-2026-11-07.sqlite');
  });

  it('Start fresh restores nothing', async () => {
    const { result, restore } = run(1);
    expect(await result).toBe('fresh');
    expect(restore).not.toHaveBeenCalled();
  });

  it('says so when there is no backup, and starts fresh', async () => {
    const { result, boxes, restore } = run(0, null);
    expect(await result).toBe('fresh');
    expect(boxes[0]?.buttons).toEqual([START_FRESH]);
    expect(boxes[0]?.detail).toContain('No backup was found');
    expect(restore).not.toHaveBeenCalled();
  });
});
