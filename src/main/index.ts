// App bootstrap (Task 10, Task 13). Order: userData override → media scheme → single instance →
// ready → database (migrate, seed; the corrupt dialog, spec §3.3) → daily backup → timer and orphan
// recovery → pending recaps → media protocol → IPC → power and the date watch → main window → tray →
// hotkey and login item. Closing the window hides to the tray (appplan §4.4); only Quit ends the app, saving first.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { todayKey } from '../core/stats/totals';
import { watchDateChange } from './date-watch';
import { dailyBackup, fileStamp, latestBackupBefore, localDateKey } from './db/backup';
import { corruptState, markCorruptRestoreAttempt, resolveCorrupt } from './db/corrupt';
import { NewerSchemaError, isReadableDatabase, openDatabase, type Db } from './db/db';
import { settingsRepo } from './db/repos/settings';
import { GlobalHotkey, guardHotkeySetting } from './hotkey';
import { createRendererFlush } from './flush';
import { createBroadcaster, registerIpc, type Dialogs } from './ipc';
import { MiniWindow } from './mini';
import { createNotifier } from './notify';
import { applyUserDataOverride } from './paths';
import { installMediaProtocol, registerMediaScheme } from './protocol';
import { CSP, DEV_CSP, hardenWebContents, installPermissionHandlers, shouldApplyCsp } from './security';
import { startRendererServer } from './server';
import { createCalendarService } from './services/calendar';
import { dataService } from './services/data';
import { safeTokenStore } from './services/spotify';
import { createWeatherService } from './services/weather';
import { SpotifyApi } from './spotify/api';
import { SpotifyAuth } from './spotify/auth';
import { listenForCallback } from './spotify/listener';
import { TimerController } from './timer/controller';
import { systemIdleSeconds, wirePower } from './timer/power';
import { createTray, type AppTray } from './tray';
import {
  applyLoginItem,
  createMainWindow,
  guarded,
  installQuit,
  onceUntilFailure,
  resolveCorruptDb,
  runShutdown,
  senderIsFrom,
  type MainWindow,
} from './windows';
import { CHANNELS } from '../shared/ipc';

const userData = applyUserDataOverride(app, process.env);
registerMediaScheme();

// Dev server only in an unpackaged build: a packaged app ignores the variable and its weaker CSP.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
let rendererServer: { url: string; close(): Promise<void> } | null = null;
let mainWindow: BrowserWindow | null = null;
let main: MainWindow | null = null;
let tray: AppTray | null = null;
let mini: MiniWindow | null = null;

/** Every live renderer window gets main's pushes: the main window and the mini window. */
export const broadcaster = createBroadcaster<Electron.WebContents>();

/**
 * Bundled files: `assets/` and sql.js's wasm sit in the project in development; packaged, assets
 * are an extraResource and the wasm is unpacked from the asar (electron-builder.yml).
 */
function resourcePaths(): { assets: string; wasm: string } {
  if (app.isPackaged) {
    return {
      assets: join(process.resourcesPath, 'assets'),
      wasm: join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'sql.js',
        'dist',
        'sql-wasm.wasm',
      ),
    };
  }
  const root = app.getAppPath();
  return {
    assets: join(root, 'assets'),
    wasm: join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  };
}

function rendererOrigin(): string | null {
  const url = devUrl ?? rendererServer?.url;
  return url ? new URL(url).origin : null;
}

/** A page of the renderer build (`''` the main view, `'mini.html'` the mini timer). */
async function rendererUrl(page: string): Promise<string> {
  if (devUrl) return new URL(page, devUrl).href;
  rendererServer ??= await startRendererServer(join(__dirname, '../renderer'));
  return new URL(page, rendererServer.url).href;
}

/** IPC only from the app's own pages (main and mini windows). */
const isTrustedSender = (event: IpcMainInvokeEvent): boolean => senderIsFrom(event, rendererOrigin());

const dialogs: Dialogs = {
  async openFiles(filters, multi = true) {
    const opts: Electron.OpenDialogOptions = {
      filters,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    };
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths;
  },
  async saveFile(defaultName, filters) {
    const opts: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('documents'), defaultName),
      filters,
    };
    const res = mainWindow
      ? await dialog.showSaveDialog(mainWindow, opts)
      : await dialog.showSaveDialog(opts);
    return res.canceled || !res.filePath ? null : res.filePath;
  },
  async confirm(message, detail) {
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Continue', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    };
    const res = mainWindow
      ? await dialog.showMessageBox(mainWindow, opts)
      : await dialog.showMessageBox(opts);
    return res.response === 0;
  },
};

/** The tray icon at 16 px with its 32 px variant for high-DPI (spec §7), read without blocking. */
async function trayImage(assets: string): Promise<Electron.NativeImage> {
  const [small, large] = await Promise.all([
    readFile(join(assets, 'icons', 'tray-16.png')),
    readFile(join(assets, 'icons', 'tray-32.png')),
  ]);
  const image = nativeImage.createFromBuffer(small, { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: large });
  return image;
}

/** Opens the database; a newer schema is explained calmly and the app quits (nothing written). */
async function openDb(paths: { assets: string; wasm: string }): Promise<Db | null> {
  try {
    return await openDatabase({
      dir: userData,
      now: Date.now,
      wasmPath: paths.wasm,
      builtinPath: join(paths.assets, 'builtin.json'),
    });
  } catch (err) {
    if (!(err instanceof NewerSchemaError)) throw err;
    dialog.showErrorBox(
      'StudyAt needs updating',
      'Your study data was saved by a newer version of StudyAt, so this version can’t open it. Nothing has been changed. Please install the latest StudyAt and open it again.',
    );
    app.quit();
    return null;
  }
}

/**
 * Spec §3.3: the damaged file was set aside; before any window shows, Sam restores the latest
 * backup (the app relaunches onto it) or starts fresh. True to carry on with the fresh database.
 * R32: the fresh file stays marked corrupt (no daily backup, this dialog again) until Start fresh.
 */
async function recoverCorruptDb(db: Db, wasmPath: string): Promise<boolean> {
  const corruptAt = db.corruptAt ?? Date.now();
  // The dialog is the confirmation, so the restore path's own confirm box is skipped.
  const data = dataService({
    db,
    dir: userData,
    now: Date.now,
    confirm: () => Promise.resolve(true),
    beforeRestore: () => db.close(),
    app,
  });
  try {
    const outcome = await resolveCorruptDb({
      showMessageBox: (opts) => dialog.showMessageBox(opts),
      keptAs: `studyat.corrupt-${fileStamp(corruptAt)}.sqlite`,
      // A backup that would itself open corrupt is skipped for the next older one.
      latestBackup: () =>
        latestBackupBefore(userData, corruptAt, (path) => isReadableDatabase(path, wasmPath)),
      restore: (name) => data.restoreBackup(name),
      restoreFailed: corruptState(db.raw).restoreFailed,
      markRestoreAttempt: () => markCorruptRestoreAttempt(db),
      // Cleared in memory at once; if this write fails the next flush carries it.
      resolveFresh: () =>
        resolveCorrupt(db).catch((err: unknown) =>
          console.error('StudyAt: could not save the Start fresh choice', err),
        ),
    });
    return outcome === 'fresh';
  } catch (err) {
    console.error('StudyAt: restoring after a corrupt database failed', err);
    dialog.showErrorBox(
      'StudyAt couldn’t restore the backup',
      `Nothing was deleted: the damaged file and every backup are still in your data folder. Open StudyAt again to retry.\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
    return false;
  }
}

async function boot(): Promise<void> {
  // Windows ties notifications to this id; unpackaged, the Electron binary stands in for the app.
  if (process.platform === 'win32')
    app.setAppUserModelId(app.isPackaged ? 'io.studyat.app' : process.execPath);

  const csp = devUrl ? DEV_CSP : CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldApplyCsp(details.url, rendererOrigin())) {
      callback({});
      return;
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  // Only notifications and fullscreen, and only for the app's own pages (study-dev rule 5).
  installPermissionHandlers(session.defaultSession, rendererOrigin);

  const paths = resourcePaths();
  const icon = join(paths.assets, 'icons', 'icon.png');
  // openDatabase runs the migrations (with their backup) and the first-run seed.
  const db = await openDb(paths);
  if (!db) return;
  if (db.recovered === 'corrupt' && !(await recoverCorruptDb(db, paths.wasm))) return;
  // After a corrupt launch the file is a fresh database: it must not become today's daily (R16).
  const launchedAt = Date.now();
  const launchBackupDay = await dailyBackup(userData, launchedAt, { skip: db.recovered === 'corrupt' }).then(
    () => localDateKey(launchedAt),
    (err: unknown) => {
      console.error('StudyAt: daily backup failed', err);
      return null;
    },
  );

  const settingsStore = settingsRepo(db);
  const settings = settingsStore.get();
  const auth = new SpotifyAuth({
    fetch,
    store: safeTokenStore(db, safeStorage),
    now: Date.now,
    openExternal: (url) => void shell.openExternal(url),
    listen: listenForCallback,
  });
  auth.setClientId(settings.spotifyClientId);
  const spotifyApi = new SpotifyApi(auth, fetch, Date.now);

  const notifier = createNotifier({
    create: (opts) => new Notification(opts),
    isSupported: () => Notification.isSupported(),
    icon,
    settings: () => settingsStore.get(),
    isMainFocused: () => Boolean(main?.isVisible() && mainWindow?.isFocused()),
    onClick: () => main?.reveal(),
  });

  const timer = new TimerController({
    db,
    now: Date.now,
    setInterval,
    clearInterval,
    uuid: randomUUID,
    idleSeconds: systemIdleSeconds(powerMonitor),
    emit: {
      state: (s) => {
        broadcaster.send(CHANNELS.events.timerState, s);
        main?.setTimerState(s);
        tray?.refresh(s);
        if (main) mini?.syncWithMain(main.isVisible(), s.status === 'running');
      },
      away: (p) => {
        broadcaster.send(CHANNELS.events.timerAway, p);
        // Review Focus 1: the prompt lives in the main window, so a hidden one comes back.
        main?.onAwayPrompt(p);
      },
      segmentEnd: (e, segmentMs) => {
        broadcaster.send(CHANNELS.events.timerSegmentEnd, e);
        notifier.notifySegmentEnd(e, segmentMs);
      },
    },
  });
  timer.recoverOrphans();

  // Ctrl+Alt+P from anywhere: one toggle per press (Review Focus 5), whatever paused the timer.
  const hotkey = new GlobalHotkey(
    globalShortcut,
    guarded('the hotkey could not toggle the timer', () => timer.toggle()),
    Date.now,
  );

  // Quit: bounds and positions, then the running row closed and flushed (rule 9), then the server,
  // exactly once; the app quits whatever fails on the way, within QUIT_LIMIT_MS. A failed step
  // never skips timer.quit(): quitting while away discards the away time (Sam's A1).
  // A failed attempt is retried by the next quit or restore rather than remembered.
  const quitTimers = {
    setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clearTimeout: (h: unknown): void => clearTimeout(h as NodeJS.Timeout),
  };
  const stopTimerAndDb = onceUntilFailure(async () => {
    await timer.quit();
    await db.close();
  });
  // Every window first saves what it still holds (note text), within FLUSH_LIMIT_MS of QUIT_LIMIT_MS.
  const renderers = createRendererFlush({ targets: () => broadcaster.live(), ...quitTimers });
  // Set once the date watch starts (below); stopped first on quit, so no backup or recap check
  // starts against a database that is closing.
  let stopDateWatch: (() => void) | null = null;
  const quitting = installQuit(
    app,
    () =>
      runShutdown(
        [
          () => stopDateWatch?.(),
          () => main?.flush(),
          () => mini?.flush(),
          () => hotkey.dispose(),
        ],
        async () => {
          await renderers.flush().catch((err: unknown) => console.error('StudyAt: window flush failed', err));
          await stopTimerAndDb();
        },
      ),
    async () => {
      tray?.destroy();
      await rendererServer?.close();
    },
  );

  const services = registerIpc({
    // settings:set with a new globalHotkey registers it before anything is saved (spec §7).
    ipc: guardHotkeySetting<IpcMainInvokeEvent>(ipcMain, CHANNELS.settings.set, hotkey, isTrustedSender),
    db,
    timer,
    spotify: { api: spotifyApi, auth },
    // Widgets addendum §2, §3: no timers here; the renderer polls while a widget is open and main
    // serves its cache until the 30 min (weather) or 15 min (calendar) freshness runs out.
    weather: createWeatherService({ fetch, now: Date.now }),
    calendar: createCalendarService({ fetch, now: Date.now }),
    safeStorage,
    dialogs,
    win: () => mainWindow,
    app,
    shell,
    fetch,
    paths: { userData, assets: paths.assets },
    now: Date.now,
    beforeRestore: stopTimerAndDb,
    isTrustedSender,
    onSettingsChanged: (_next, patch) => {
      if (patch.launchAtStartup !== undefined) applyLoginItem(app, patch.launchAtStartup);
    },
    // A change made anywhere (Settings, a widget, another window) reaches every window.
    pushSettings: (s) => broadcaster.send(CHANNELS.events.settingsChanged, s),
    showMini: (show) => {
      if (show) {
        void mini?.show();
        return;
      }
      // R24: "open StudyAt" in the mini brings the main window forward.
      mini?.hide();
      main?.reveal();
    },
    onFlushed: (sender) => renderers.ack(sender),
  });
  // Spec §3.5: every finished week is recapped on launch; the renderer asks for the pending one.
  services.recaps.computePending(Date.now());

  installMediaProtocol(services.resolveMedia, () => {
    const origin = rendererOrigin();
    return origin ? [origin] : [];
  });
  // suspend/lock pause the timer; resume/unlock route to onResume/onUnlock (spec §3.4 rules 3–4).
  wirePower(powerMonitor, timer);
  // The app lives in the tray for days: the daily backup and a finished week's recap follow the
  // date, not the launch (study-dev rule 2, spec §3.5).
  stopDateWatch = watchDateChange({
    now: Date.now,
    setInterval,
    clearInterval,
    power: powerMonitor,
    lastBackupDay: launchBackupDay,
    studyDay: (now) => todayKey(services.stats.contextAt(now)),
    // While the corrupt dialog is unresolved the file is the fresh one, never a daily (R16, R32).
    backup: (now) => dailyBackup(userData, now, { skip: corruptState(db.raw).pendingAt !== null }),
    recaps: (now) => void services.recaps.computePending(now),
    log: (msg, err) => console.error(msg, err),
  });

  const workAreas = (): Electron.Rectangle[] => screen.getAllDisplays().map((d) => d.workArea);
  const timeouts = quitTimers;

  mini = new MiniWindow({
    create: (opts) => new BrowserWindow(opts),
    preload: join(__dirname, '../preload/index.js'),
    url: () => rendererUrl('mini.html'),
    harden: hardenWebContents,
    addTarget: (wc) => broadcaster.add(wc),
    settings: settingsStore,
    screen: { workAreas, primaryWorkArea: () => screen.getPrimaryDisplay().workArea },
    isQuitting: quitting.isQuitting,
    onShown: (shown) => {
      broadcaster.send(CHANNELS.events.appMini, shown);
      tray?.refresh();
    },
    ...timeouts,
  });

  main = createMainWindow({
    create: (opts) => new BrowserWindow(opts),
    preload: join(__dirname, '../preload/index.js'),
    icon,
    settings: settingsStore,
    workAreas,
    isQuitting: quitting.isQuitting,
    trayNotice: () => notifier.notifyTrayNotice(),
    onVisibility: (visible) => {
      broadcaster.send(CHANNELS.events.appVisibility, visible);
      tray?.refresh();
      mini?.syncWithMain(visible, timer.getState().status === 'running');
    },
    ...timeouts,
  });
  const win = main.win;
  mainWindow = win;
  hardenWebContents(win.webContents);
  broadcaster.add(win.webContents);
  win.on('enter-full-screen', () => broadcaster.send(CHANNELS.events.appFullscreen, true));
  win.on('leave-full-screen', () => broadcaster.send(CHANNELS.events.appFullscreen, false));
  // Windows sign-out or shutdown: quit properly (saving first) rather than hiding to the tray.
  win.on('session-end', () => app.quit());
  win.on('closed', () => {
    mainWindow = null;
  });

  try {
    const image = await trayImage(paths.assets).catch((err: unknown) => {
      console.error('StudyAt: tray icons missing, using the app icon', err);
      return nativeImage.createFromPath(icon);
    });
    tray = createTray({
      create: () => new Tray(image),
      buildMenu: (template) => Menu.buildFromTemplate(template),
      getState: () => timer.getState(),
      isMainVisible: () => main?.isVisible() ?? false,
      isMiniShown: () => mini?.isShown() ?? false,
      showMain: () => main?.reveal(),
      toggleMain: () => main?.toggle(),
      toggleTimer: guarded('the tray could not toggle the timer', () => timer.toggle()),
      toggleMini: guarded('the tray could not toggle the mini timer', () => mini?.toggle()),
      quit: () => app.quit(),
    });
  } catch (err) {
    console.error('StudyAt: could not create the tray icon', err);
  }

  const registered = hotkey.register(settings.globalHotkey);
  if (!registered.ok) console.warn(`StudyAt: global hotkey not registered. ${registered.error}`);
  applyLoginItem(app, settings.launchAtStartup);

  await win.loadURL(await rendererUrl(''));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Spec §3.7: a second launch brings the running app forward.
  app.on('second-instance', () => main?.reveal());

  void app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => {
      console.error('StudyAt: could not start', err);
      dialog.showErrorBox('StudyAt could not start', err instanceof Error ? err.message : String(err));
      app.quit();
    });

  // Closing the window hides it to the tray (appplan §4.4); only Quit ends the app.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
