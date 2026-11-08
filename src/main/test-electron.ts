// Stand-ins for Electron's BrowserWindow and settings store, for the window, tray and mini tests.
import { EventEmitter } from 'node:events';
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/settings';
import type { Settings } from '../shared/types';
import type { MainSettingsPatch } from './db/repos/settings';

export class FakeWindow extends EventEmitter {
  visible = false;
  minimized = false;
  destroyed = false;
  title = '';
  bounds: Rectangle;
  url = '';
  readonly webContents = { id: 1, isDestroyed: () => this.destroyed, send: vi.fn() };

  constructor(readonly opts: BrowserWindowConstructorOptions) {
    super();
    this.bounds = { x: opts.x ?? 0, y: opts.y ?? 0, width: opts.width ?? 800, height: opts.height ?? 600 };
  }

  isDestroyed = (): boolean => this.destroyed;
  isVisible = (): boolean => this.visible;
  isMinimized = (): boolean => this.minimized;
  show = vi.fn(() => {
    const was = this.visible && !this.minimized;
    this.visible = true;
    if (!was) this.emit('show');
  });
  showInactive = vi.fn(() => this.show());
  hide = vi.fn(() => {
    if (!this.visible) return;
    this.visible = false;
    this.emit('hide');
  });
  minimize = vi.fn(() => {
    this.minimized = true;
    this.emit('minimize');
  });
  restore = vi.fn(() => {
    this.minimized = false;
    this.emit('restore');
  });
  focus = vi.fn();
  setTitle = vi.fn((t: string) => {
    this.title = t;
  });
  setAlwaysOnTop = vi.fn();
  getNormalBounds = (): Rectangle => ({ ...this.bounds });
  getBounds = (): Rectangle => ({ ...this.bounds });
  setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y };
  });
  moveTo(x: number, y: number): void {
    this.bounds = { ...this.bounds, x, y };
    this.emit('move');
  }
  loadURL = vi.fn((url: string) => {
    this.url = url;
    return Promise.resolve();
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.emit('closed');
  });
  /** A user close (Alt+F4, the × button); returns whether it was prevented. */
  close(): boolean {
    let prevented = false;
    this.emit('close', { preventDefault: () => (prevented = true) });
    if (!prevented) this.destroy();
    return prevented;
  }

  asWindow(): BrowserWindow {
    return this as unknown as BrowserWindow;
  }
}

export function fakeSettings(initial: Partial<Settings> = {}) {
  let current: Settings = { ...DEFAULT_SETTINGS, ...initial } as Settings;
  const store = {
    get: (): Settings => current,
    set: vi.fn((patch: MainSettingsPatch): Settings => {
      const { spotifyTokens: _t, ...rest } = patch;
      current = mergeSettings(current, rest);
      return current;
    }),
  };
  return store;
}

/** setTimeout/clearTimeout driven by `flush()`. */
export function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    setTimeout: (fn: () => void): unknown => {
      pending.set(++id, fn);
      return id;
    },
    clearTimeout: (h: unknown): void => {
      pending.delete(h as number);
    },
    flush(): void {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    get size(): number {
      return pending.size;
    },
  };
}
