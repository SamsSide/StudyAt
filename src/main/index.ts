// App bootstrap (Task 10; Task 13 adds the tray, mini window, hotkey and windows.ts). Order:
// userData override → media scheme → single instance → ready → database (migrate, seed) → daily
// backup → timer and orphan recovery → pending recaps → media protocol → IPC → power → window.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, session, shell } from 'electron';
import { dailyBackup } from './db/backup';
import { NewerSchemaError, openDatabase, type Db } from './db/db';
import { settingsRepo } from './db/repos/settings';
import { createBroadcaster, registerIpc, type Dialogs } from './ipc';
import { applyUserDataOverride } from './paths';
import { installMediaProtocol, registerMediaScheme } from './protocol';
import { CSP, DEV_CSP, hardenWebContents, shouldApplyCsp } from './security';
import { startRendererServer } from './server';
import { safeTokenStore } from './services/spotify';
import { SpotifyApi } from './spotify/api';
import { SpotifyAuth } from './spotify/auth';
import { listenForCallback } from './spotify/listener';
import { TimerController } from './timer/controller';
import { systemIdleSeconds, wirePower } from './timer/power';
import { CHANNELS } from '../shared/ipc';

const userData = applyUserDataOverride(app, process.env);
registerMediaScheme();

// Dev server only in an unpackaged build: a packaged app ignores the variable and its weaker CSP.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
let rendererServer: { url: string; close(): Promise<void> } | null = null;
let mainWindow: BrowserWindow | null = null;

/** Every live renderer window gets main's pushes; Task 13 adds the mini window here. */
export const broadcaster = createBroadcaster();

/**
 * Bundled files: `assets/` and sql.js's wasm sit in the project in development; packaged, assets
 * are an extraResource and the wasm is unpacked from the asar (electron-builder.yml).
 */
function resourcePaths(): { assets: string; wasm: string } {
  if (app.isPackaged) {
    return {
      assets: join(process.resourcesPath, 'assets'),
      wasm: join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    };
  }
  const root = app.getAppPath();
  return { assets: join(root, 'assets'), wasm: join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') };
}

function rendererOrigin(): string | null {
  const url = devUrl ?? rendererServer?.url;
  return url ? new URL(url).origin : null;
}

const dialogs: Dialogs = {
  async openFiles(filters, multi = true) {
    const opts: Electron.OpenDialogOptions = { filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] };
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths;
  },
  async saveFile(defaultName, filters) {
    const opts: Electron.SaveDialogOptions = { defaultPath: join(app.getPath('documents'), defaultName), filters };
    const res = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts);
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
    const res = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts);
    return res.response === 0;
  },
};

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'StudyAt',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  hardenWebContents(win.webContents);
  broadcaster.add(win.webContents);
  win.on('enter-full-screen', () => broadcaster.send(CHANNELS.events.appFullscreen, true));
  win.on('leave-full-screen', () => broadcaster.send(CHANNELS.events.appFullscreen, false));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });

  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    rendererServer ??= await startRendererServer(join(__dirname, '../renderer'));
    await win.loadURL(rendererServer.url);
  }
}

/** Opens the database; a newer schema is explained calmly and the app quits (nothing written). */
async function openDb(paths: { assets: string; wasm: string }): Promise<Db | null> {
  try {
    return await openDatabase({ dir: userData, now: Date.now, wasmPath: paths.wasm, builtinPath: join(paths.assets, 'builtin.json') });
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

async function boot(): Promise<void> {
  const csp = devUrl ? DEV_CSP : CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldApplyCsp(details.url, rendererOrigin())) {
      callback({});
      return;
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  const paths = resourcePaths();
  // openDatabase runs the migrations (with their backup) and the first-run seed.
  const db = await openDb(paths);
  if (!db) return;
  // After a corrupt launch the file is a fresh database: it must not become today's daily (R16).
  await dailyBackup(userData, Date.now(), { skip: db.recovered === 'corrupt' }).catch((err: unknown) =>
    console.error('StudyAt: daily backup failed', err),
  );

  const settings = settingsRepo(db).get();
  const auth = new SpotifyAuth({
    fetch,
    store: safeTokenStore(db, safeStorage),
    now: Date.now,
    openExternal: (url) => void shell.openExternal(url),
    listen: listenForCallback,
  });
  auth.setClientId(settings.spotifyClientId);
  const spotifyApi = new SpotifyApi(auth, fetch, Date.now);

  const timer = new TimerController({
    db,
    now: Date.now,
    setInterval,
    clearInterval,
    uuid: randomUUID,
    idleSeconds: systemIdleSeconds(powerMonitor),
    emit: {
      state: (s) => broadcaster.send(CHANNELS.events.timerState, s),
      away: (p) => broadcaster.send(CHANNELS.events.timerAway, p),
      segmentEnd: (e) => broadcaster.send(CHANNELS.events.timerSegmentEnd, e),
    },
  });
  timer.recoverOrphans();

  // Quit: close the running row and flush (rule 9) before Electron exits, exactly once.
  let shutdown: Promise<void> | null = null;
  const stopTimerAndDb = (): Promise<void> => {
    shutdown ??= (async () => {
      await timer.quit();
      await db.close();
    })();
    return shutdown;
  };
  let readyToQuit = false;
  app.on('before-quit', (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    void stopTimerAndDb()
      .catch((err: unknown) => console.error('StudyAt: could not save on quit', err))
      .finally(async () => {
        readyToQuit = true;
        await rendererServer?.close();
        app.quit();
      });
  });

  const services = registerIpc({
    ipc: ipcMain,
    db,
    timer,
    spotify: { api: spotifyApi, auth },
    dialogs,
    win: () => mainWindow,
    app,
    shell,
    paths: { userData, assets: paths.assets },
    now: Date.now,
    beforeRestore: stopTimerAndDb,
  });
  // Spec §3.5: every finished week is recapped on launch; the renderer asks for the pending one.
  services.recaps.computePending(Date.now());

  installMediaProtocol(services.resolveMedia, () => {
    const origin = rendererOrigin();
    return origin ? [origin] : [];
  });
  // suspend/lock pause the timer; resume/unlock route to onResume/onUnlock (spec §3.4 rules 3–4).
  wirePower(powerMonitor, timer);

  await createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => {
      console.error('StudyAt: could not start', err);
      dialog.showErrorBox('StudyAt could not start', err instanceof Error ? err.message : String(err));
      app.quit();
    });

  // Until Task 13's tray, closing the window quits (before-quit saves first).
  app.on('window-all-closed', () => app.quit());
}
