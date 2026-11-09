// The mini timer (spec §3.7; Sam's extra): a 240×96 frameless, transparent, always-on-top window
// showing `mini.html`. Toggled from the tray, the timer widget and `M`; with `miniWhenHidden` it
// shows by itself when the main window is hidden or minimised while the timer runs, and goes again
// when the main window returns. Its position is remembered in `settings.miniPos`. Every show and
// hide, whatever the cause, is pushed as `app:mini` (R24). Electron is injected for the tests.
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, WebContents } from 'electron';
import { SAVE_DEBOUNCE_MS, type SettingsStore } from './windows';

export const MINI_SIZE = { width: 240, height: 96 } as const;
/** Distance from the work area's edges for the default bottom-right spot. */
export const MINI_MARGIN = 24;

/**
 * Where the mini window goes: the saved spot if it is wholly on a display, pulled inside the work
 * area it overlaps most if partly off-screen, else bottom-right of the primary work area.
 */
export function placeMini(
  saved: { x: number; y: number } | null,
  workAreas: Rectangle[],
  primary: Rectangle,
): { x: number; y: number } {
  const fallback = {
    x: primary.x + primary.width - MINI_SIZE.width - MINI_MARGIN,
    y: primary.y + primary.height - MINI_SIZE.height - MINI_MARGIN,
  };
  if (!saved) return fallback;
  const rect = { ...saved, ...MINI_SIZE };
  let best: Rectangle | null = null;
  let bestArea = 0;
  for (const a of workAreas) {
    const w = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
    const h = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
    const area = Math.max(0, w) * Math.max(0, h);
    if (area > bestArea) {
      best = a;
      bestArea = area;
    }
  }
  if (!best) return fallback;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: clamp(saved.x, best.x, best.x + best.width - MINI_SIZE.width),
    y: clamp(saved.y, best.y, best.y + best.height - MINI_SIZE.height),
  };
}

export interface MiniDeps {
  create(opts: BrowserWindowConstructorOptions): BrowserWindow;
  preload: string;
  /** The renderer's `mini.html` URL (dev server or the local renderer server). */
  url(): Promise<string>;
  /** `hardenWebContents`: no window.open, no navigation off-origin. */
  harden(wc: WebContents): void;
  /** `broadcaster.add`: the mini gets every push; returns the remover. */
  addTarget(wc: WebContents): () => void;
  settings: SettingsStore;
  screen: { workAreas(): Rectangle[]; primaryWorkArea(): Rectangle };
  isQuitting(): boolean;
  /** Every show and hide (R24 `app:mini`, the tray's ✓). */
  onShown(shown: boolean): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class MiniWindow {
  private win: BrowserWindow | null = null;
  private loading: Promise<BrowserWindow> | null = null;
  private shown = false;
  /** Wanted on screen; a show still loading checks this before it appears. */
  private wanted = false;
  /** Shown by `syncWithMain` rather than by Sam, so the main window's return hides it. */
  private auto = false;
  private lastSync: string | null = null;
  private saveTimer: unknown = null;
  private frozen = false;

  constructor(private readonly deps: MiniDeps) {}

  isShown(): boolean {
    return this.shown;
  }

  /** Shows without taking focus from whatever Sam is working in. */
  async show(auto = false): Promise<void> {
    this.wanted = true;
    this.auto = auto;
    let win: BrowserWindow;
    try {
      win = await this.ensure();
    } catch (err) {
      console.error('StudyAt: the mini timer could not load', err);
      return;
    }
    if (!this.wanted || win.isDestroyed()) return;
    const pos = placeMini(
      this.deps.settings.get().miniPos,
      this.deps.screen.workAreas(),
      this.deps.screen.primaryWorkArea(),
    );
    win.setPosition(pos.x, pos.y);
    win.showInactive();
  }

  hide(): void {
    this.wanted = false;
    this.auto = false;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  toggle(): Promise<void> {
    if (this.wanted) {
      this.hide();
      return Promise.resolve();
    }
    return this.show();
  }

  /**
   * Spec §3.7 `miniWhenHidden`. Acts only when the main window's visibility or the running state
   * changes, so a mini Sam closed stays closed until something changes again.
   */
  syncWithMain(mainVisible: boolean, running: boolean): void {
    const key = `${mainVisible}|${running}`;
    if (key === this.lastSync) return;
    this.lastSync = key;
    if (mainVisible) {
      if (this.auto && this.wanted) this.hide();
      return;
    }
    if (running && !this.wanted && this.deps.settings.get().miniWhenHidden) void this.show(true);
  }

  /** Writes a pending position now; nothing is written afterwards (the database is closing). */
  flush(): void {
    this.savePos();
    this.frozen = true;
  }

  destroy(): void {
    this.flush();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }

  private ensure(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve(this.win);
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<BrowserWindow> {
    const { deps } = this;
    const pos = placeMini(
      deps.settings.get().miniPos,
      deps.screen.workAreas(),
      deps.screen.primaryWorkArea(),
    );
    const win = deps.create({
      ...MINI_SIZE,
      ...pos,
      title: 'StudyAt mini timer',
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: deps.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    // 'floating' keeps it above ordinary windows without covering system UI.
    win.setAlwaysOnTop(true, 'floating');
    deps.harden(win.webContents);
    const remove = deps.addTarget(win.webContents);

    win.on('show', () => this.setShown(true));
    win.on('hide', () => this.setShown(false));
    win.on('move', () => this.schedulePos());
    win.on('close', (e) => {
      if (deps.isQuitting()) return;
      // Alt+F4 on the mini hides it; the window is kept for the next show.
      e.preventDefault();
      this.hide();
    });
    win.on('closed', () => {
      remove();
      if (this.win === win) this.win = null;
      this.wanted = false;
      this.setShown(false);
    });

    try {
      await win.loadURL(await deps.url());
    } catch (err) {
      remove();
      win.destroy();
      throw err;
    }
    this.win = win;
    return win;
  }

  private setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.deps.onShown(shown);
  }

  private schedulePos(): void {
    if (this.frozen) return;
    if (this.saveTimer !== null) this.deps.clearTimeout(this.saveTimer);
    this.saveTimer = this.deps.setTimeout(() => this.savePos(), SAVE_DEBOUNCE_MS);
  }

  private savePos(): void {
    if (this.saveTimer !== null) this.deps.clearTimeout(this.saveTimer);
    if (this.saveTimer === null || this.frozen) return;
    this.saveTimer = null;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    this.deps.settings.set({ miniPos: { x: b.x, y: b.y } });
  }
}
