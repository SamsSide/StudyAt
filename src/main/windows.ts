// The main window and the app-level pieces around it (spec §3.3, §3.7): remembered bounds, close
// hides to the tray (appplan §4.4) with a one-time notice, the title tracks the timer, visibility is
// pushed to the renderer (R24), the quit sequence, launch at start-up, and the corrupt-database
// dialog. Electron is injected so all of it runs under a unit test.
import type { BrowserWindow, BrowserWindowConstructorOptions, MessageBoxOptions, Rectangle } from 'electron';
import { formatClock } from '../shared/clock';
import type { BackupInfo, Mode, Settings, TimerState } from '../shared/types';
import type { MainSettingsPatch } from './db/repos/settings';
import { localStamp } from './services/data';

export const MAIN_SIZE = { width: 1280, height: 800, minWidth: 960, minHeight: 600 } as const;
/** Bounds are written this long after the last move or resize. */
export const SAVE_DEBOUNCE_MS = 500;

const MODE_LABEL: Record<Mode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

/** `"12:34 · Focus"` (paused: `"12:34 · Focus · Paused"`), or null while idle. */
function timerLine(s: TimerState): string | null {
  if (s.status === 'idle') return null;
  const line = `${formatClock(s.remainingMs)} · ${MODE_LABEL[s.mode]}`;
  return s.status === 'paused' ? `${line} · Paused` : line;
}

/** Spec §3.7: `StudyAt` idle, `12:34 · Focus — StudyAt` while running. */
export function windowTitle(s: TimerState): string {
  const line = timerLine(s);
  return line ? `${line} — StudyAt` : 'StudyAt';
}

/** Spec §3.7: the tray tooltip, `"12:34 · Focus"`, or `"StudyAt"` idle. */
export function trayTooltip(s: TimerState): string {
  return timerLine(s) ?? 'StudyAt';
}

const overlap = (a: Rectangle, b: Rectangle): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Saved main-window bounds, if a usable part of them (its title bar region, at least 100×40 px)
 * is on a display that still exists; otherwise null and the window opens at the default size.
 */
export function restorableBounds(saved: Rectangle | null, workAreas: Rectangle[]): Rectangle | null {
  if (!saved) return null;
  const titleBar = { x: saved.x, y: saved.y, width: saved.width, height: 40 };
  const fits = workAreas.some((a) => overlap(titleBar, a) >= 100 * 40);
  if (!fits) return null;
  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(saved.width, MAIN_SIZE.minWidth),
    height: Math.max(saved.height, MAIN_SIZE.minHeight),
  };
}

export interface SettingsStore {
  get(): Settings;
  set(patch: MainSettingsPatch): Settings;
}

export interface MainWindowDeps {
  create(opts: BrowserWindowConstructorOptions): BrowserWindow;
  preload: string;
  icon: string;
  settings: SettingsStore;
  /** Work areas of every display, for restoring bounds. */
  workAreas(): Rectangle[];
  /** True once quitting has begun: close then closes instead of hiding. */
  isQuitting(): boolean;
  /** The one-time "still running in the tray" notification. */
  trayNotice(): void;
  /** Shown/restored → true, hidden/minimised → false; repeats are dropped (R24 `app:visibility`). */
  onVisibility(visible: boolean): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MainWindow {
  win: BrowserWindow;
  /** On screen: shown and not minimised. */
  isVisible(): boolean;
  /** Shows, restores and focuses the window. */
  reveal(): void;
  /** Tray "Show/Hide StudyAt". */
  toggle(): void;
  /** Title from the timer (spec §3.7); set only when the text changes. */
  setTimerState(s: TimerState): void;
  /** Away prompt (Review Focus 1): the prompt lives in this window, so a hidden window comes back. */
  onAwayPrompt(prompt: unknown): void;
  /** Writes pending bounds now; nothing is written afterwards (the database is about to close). */
  flush(): void;
}

export function createMainWindow(deps: MainWindowDeps): MainWindow {
  const { settings } = deps;
  const bounds = restorableBounds(settings.get().windowBounds, deps.workAreas());
  const win = deps.create({
    ...(bounds ?? { width: MAIN_SIZE.width, height: MAIN_SIZE.height }),
    minWidth: MAIN_SIZE.minWidth,
    minHeight: MAIN_SIZE.minHeight,
    title: 'StudyAt',
    icon: deps.icon,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: deps.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Chimes and the countdown keep running while the window is hidden (spec §3.9).
      backgroundThrottling: false,
    },
  });

  let saveTimer: unknown = null;
  let frozen = false;
  let title = 'StudyAt';
  let visible = false;

  const saveBounds = (): void => {
    if (saveTimer !== null) deps.clearTimeout(saveTimer);
    saveTimer = null;
    if (frozen || win.isDestroyed()) return;
    // Normal bounds, so a maximised or minimised window remembers where it came from.
    const b = win.getNormalBounds();
    settings.set({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
  };
  const scheduleSave = (): void => {
    if (frozen) return;
    if (saveTimer !== null) deps.clearTimeout(saveTimer);
    saveTimer = deps.setTimeout(saveBounds, SAVE_DEBOUNCE_MS);
  };
  const isVisible = (): boolean => !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  const pushVisibility = (): void => {
    const now = isVisible();
    if (now === visible) return;
    visible = now;
    deps.onVisibility(now);
  };
  const reveal = (): void => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  // The page's <title> would replace the timer title on every load.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('show', pushVisibility);
  win.on('hide', pushVisibility);
  win.on('minimize', pushVisibility);
  win.on('restore', pushVisibility);
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (deps.isQuitting()) return;
    // Appplan §4.4: closing hides to the tray; the timer keeps running in main.
    e.preventDefault();
    saveBounds();
    win.hide();
    if (!settings.get().trayNoticeShown) {
      settings.set({ trayNoticeShown: true });
      deps.trayNotice();
    }
  });

  return {
    win,
    isVisible,
    reveal,
    toggle() {
      if (isVisible()) win.hide();
      else reveal();
    },
    setTimerState(s) {
      const next = windowTitle(s);
      if (next === title || win.isDestroyed()) return;
      title = next;
      win.setTitle(next);
    },
    onAwayPrompt(prompt) {
      if (prompt !== null && !isVisible()) reveal();
    },
    flush() {
      saveBounds();
      frozen = true;
    },
  };
}

/**
 * Runs `fn` once and shares its promise with every caller (quit and restore both stop the timer
 * and close the database). A failure is not remembered: the next call tries again, so a flush that
 * failed once is retried rather than the in-memory data being given up.
 */
export function onceUntilFailure(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => {
    running ??= fn().catch((err: unknown) => {
      running = null;
      throw err;
    });
    return running;
  };
}

export interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): void;
  quit(): void;
}

/**
 * Quitting saves first, exactly once (spec §3.4 rule 9): the first `before-quit` is held while
 * `shutdown` runs (bounds, timer, database), then `afterShutdown` (the renderer server), and only
 * then does the app quit, whether either of them failed or not.
 */
export function installQuit(
  app: QuitApp,
  shutdown: () => Promise<void>,
  afterShutdown: () => Promise<void> = () => Promise.resolve(),
): { isQuitting(): boolean } {
  let quitting = false;
  let ready = false;
  app.on('before-quit', (event) => {
    if (ready) return;
    event.preventDefault();
    if (quitting) return; // a second Quit while saving waits for the first
    quitting = true;
    void (async () => {
      try {
        await shutdown();
      } catch (err) {
        console.error('StudyAt: could not save on quit', err);
      }
      try {
        await afterShutdown();
      } catch (err) {
        console.error('StudyAt: could not stop the renderer server', err);
      }
      ready = true;
      app.quit();
    })();
  });
  return { isQuitting: () => quitting };
}

/**
 * Spec §3.11 `launchAtStartup`, on start-up and on change. Only a packaged app registers itself: in
 * development the entry would point at the bare Electron binary. True when applied.
 */
export function applyLoginItem(
  app: { isPackaged: boolean; setLoginItemSettings(s: { openAtLogin: boolean }): void },
  enabled: boolean,
): boolean {
  if (!app.isPackaged) return false;
  app.setLoginItemSettings({ openAtLogin: enabled });
  return true;
}

/**
 * IPC comes only from the app's own pages (the main and mini windows): the sending frame's origin
 * must be the renderer origin (dev server or local renderer server). Anything else, an embed or a
 * page that navigated away, is refused.
 */
export function senderIsFrom(event: { senderFrame?: { url: string } | null }, origin: string | null): boolean {
  const url = event.senderFrame?.url;
  if (!url || !origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

export const RESTORE_LATEST = 'Restore latest backup';
export const START_FRESH = 'Start fresh';

export interface CorruptDeps {
  showMessageBox(opts: MessageBoxOptions): Promise<{ response: number }>;
  /** The name the damaged file was kept under, e.g. `studyat.corrupt-2026-11-08_120000.sqlite`. */
  keptAs: string;
  /** `latestBackupBefore(userData, db.corruptAt)`. */
  latestBackup(): Promise<BackupInfo | null>;
  /** The data service's restore (stops, copies atomically, relaunches); never deletes. */
  restore(name: string): Promise<boolean>;
}

/**
 * Spec §3.3: the database could not be opened and was set aside. Sam chooses "Restore latest
 * backup" (the default; Esc and closing the box choose it too) or "Start fresh". With no backup to
 * restore, the box says so and StudyAt starts fresh. Nothing is ever deleted.
 */
export async function resolveCorruptDb(deps: CorruptDeps): Promise<'restored' | 'fresh'> {
  const backup = await deps.latestBackup();
  const kept = `The data file looks damaged, so StudyAt set it aside. It is kept, untouched, as ${deps.keptAs} in your data folder.`;
  const base: MessageBoxOptions = {
    type: 'warning',
    title: 'StudyAt',
    message: 'StudyAt couldn’t open your study data',
    noLink: true,
    defaultId: 0,
    cancelId: 0,
  };
  if (!backup) {
    await deps.showMessageBox({
      ...base,
      detail: `${kept}\n\nNo backup was found, so StudyAt will start fresh.`,
      buttons: [START_FRESH],
    });
    return 'fresh';
  }
  const { response } = await deps.showMessageBox({
    ...base,
    detail: `${kept}\n\nRestore the latest backup, from ${localStamp(backup.createdAt)}, or start fresh with empty data.`,
    buttons: [RESTORE_LATEST, START_FRESH],
  });
  if (response !== 0) return 'fresh';
  return (await deps.restore(backup.name)) ? 'restored' : 'fresh';
}
