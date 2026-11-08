// App bootstrap (grown by Tasks 10 and 13). The userData override runs first (spec §3.3).
import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { applyUserDataOverride } from './paths';
import { CSP, DEV_CSP, hardenWebContents } from './security';
import { startRendererServer } from './server';

applyUserDataOverride(app, process.env);

const devUrl = process.env.ELECTRON_RENDERER_URL;
let rendererServer: { url: string; close(): Promise<void> } | null = null;
let mainWindow: BrowserWindow | null = null;

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    const csp = devUrl ? DEV_CSP : CSP;
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      });
    });
    await createWindow();
  });

  app.on('window-all-closed', () => {
    void rendererServer?.close();
    app.quit();
  });
}
