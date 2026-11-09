// Shared e2e fixtures (spec §9; Task 19). Every test launches the BUILT app (`npm run build`, so
// `out/`) with a fresh throwaway STUDYAT_USER_DATA, never %APPDATA%\StudyAt, and every Electron it
// starts is quit (or killed) and its data folder deleted when the test ends. Seeded databases are
// built here with the app's own storage code (openDatabase, the migrations, sessionsRepo), so a
// fixture is always the shape the app itself writes.
import { execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import initSqlJs from 'sql.js';
import { dayKeyOf } from '../src/core/time';
import { openDatabase } from '../src/main/db/db';
import { MIGRATIONS, migrate } from '../src/main/db/migrations';
import { sessionsRepo } from '../src/main/db/repos/sessions';
import type { StudyAtApi } from '../src/shared/ipc';
import type { SettingsPatch } from '../src/shared/types';

export { expect } from '@playwright/test';
export type { StudyAtApi };

export const ROOT = resolve(__dirname, '..');
export const WASM = join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
export const BUILTIN = join(ROOT, 'assets', 'builtin.json');
export const DB_NAME = 'studyat.sqlite';
/** The size every screenshot is taken at (task-19-extra). */
export const VIEW = { width: 1280, height: 800 };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Launched {
  app: ElectronApplication;
  win: Page;
  logs: string[];
}

export interface AppFixtures {
  /** A fresh, empty data folder for this test; deleted afterwards. */
  dataDir: string;
  /** Launches the built app on `dir` (default `dataDir`) and waits for the shell. */
  launch: (dir?: string) => Promise<Launched>;
  /**
   * Launches without waiting for a window; `early` runs in the test as soon as main answers,
   * before the database opens on most runs (used to stub dialogs main shows before any window).
   */
  launchBare: (early: (app: ElectronApplication) => Promise<void>, dir?: string) => Promise<ElectronApplication>;
}

function assertBuilt(): void {
  if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
    throw new Error('No build in out/: run `npm run build` before the e2e tests.');
  }
}

function appEnv(dir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // The built renderer, never a dev server.
  delete env.ELECTRON_RENDERER_URL;
  env.STUDYAT_USER_DATA = dir;
  env.NODE_ENV = 'production';
  return env;
}

async function startApp(dir: string, logs: string[]): Promise<ElectronApplication> {
  assertBuilt();
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: appEnv(dir), timeout: 60_000 });
  processes.set(app, app.process());
  const tag = `#${logs.length}`;
  app.process().stdout?.on('data', (d: Buffer) => logs.push(`[main ${tag}] ${d.toString().trim()}`));
  app.process().stderr?.on('data', (d: Buffer) => logs.push(`[main ${tag} err] ${d.toString().trim()}`));
  return app;
}

async function launchApp(dir: string, logs: string[]): Promise<Launched> {
  const app = await startApp(dir, logs);
  const tag = `#${logs.length}`;
  const win = await app.firstWindow({ timeout: 60_000 });
  win.on('console', (m) => logs.push(`[page ${tag} ${m.type()}] ${m.text().slice(0, 300)}`));
  win.on('pageerror', (e) => logs.push(`[page ${tag} error] ${e.message}`));
  await win.waitForLoadState('load');
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.webContents.getURL().includes('mini'));
    w?.setContentSize(size.width, size.height);
    w?.center();
  }, VIEW);
  await win.locator('[data-testid="shell"]').waitFor({ timeout: 30_000 });
  return { app, win, logs };
}

/**
 * Each app's process, captured at launch: Playwright's `app.process()` throws once the app has
 * closed, and the teardown must still be able to ask.
 */
const processes = new WeakMap<ElectronApplication, ChildProcess>();

function proc(app: ElectronApplication): ChildProcess {
  const p = processes.get(app);
  if (!p) throw new Error('not an app started by these fixtures');
  return p;
}

function isRunning(app: ElectronApplication): boolean {
  const p = proc(app);
  return p.exitCode === null && p.signalCode === null;
}

/** `app.quit()`, which saves first (the before-quit path); resolves with the exit code. */
export async function quitApp(app: ElectronApplication): Promise<number | null | 'timeout'> {
  if (!isRunning(app)) return proc(app).exitCode;
  const exited = new Promise<number | null>((r) => proc(app).once('exit', (code) => r(code)));
  await app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
  const code = await Promise.race([exited, sleep(20_000).then(() => 'timeout' as const)]);
  if (code === 'timeout') killApp(app);
  return code;
}

/** Ends the process tree at once, as a crash or Task Manager would: no quit handlers run. */
export function killApp(app: ElectronApplication): void {
  const pid = proc(app).pid;
  if (pid === undefined || !isRunning(app)) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc(app).kill('SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

export async function waitForExit(app: ElectronApplication, ms = 15_000): Promise<void> {
  if (!isRunning(app)) return;
  await Promise.race([new Promise((r) => proc(app).once('exit', r)), sleep(ms)]);
}

export const test = base.extend<AppFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps
  dataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'studyat-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  },
  launch: async ({ dataDir }, use, testInfo) => {
    const started: ElectronApplication[] = [];
    const logs: string[] = [];
    await use(async (dir = dataDir) => {
      const launched = await launchApp(dir, logs);
      started.push(launched.app);
      return launched;
    });
    await stopAll(started);
    if (testInfo.status !== testInfo.expectedStatus && logs.length > 0) {
      await testInfo.attach('app-logs', { body: logs.join('\n'), contentType: 'text/plain' });
    }
  },
  launchBare: async ({ dataDir }, use) => {
    const started: ElectronApplication[] = [];
    await use(async (early, dir = dataDir) => {
      const app = await startApp(dir, []);
      started.push(app);
      await early(app);
      return app;
    });
    await stopAll(started);
  },
});

/** Quits each app still running (killing it if the quit hangs) and waits for it to exit. */
async function stopAll(apps: ElectronApplication[]): Promise<void> {
  for (const app of apps) {
    if (isRunning(app)) await quitApp(app);
    killApp(app);
    await waitForExit(app);
  }
}

/**
 * The accounting settings every test starts from: idleMinutes 60, because Playwright input is not
 * Windows input, and with the default 10 min a PC left idle would make the timer treat the run as
 * away time (task-19-extra, real-run finding F1). `onboarded` hides the one-time welcome card.
 */
export async function prepare(win: Page, extra: SettingsPatch = {}): Promise<void> {
  await win.evaluate((patch) => window.studyat.settings.set(patch), {
    idleMinutes: 60,
    onboarded: true,
    ...extra,
  });
  const settings = await win.evaluate(() => window.studyat.settings.get());
  if (settings.idleMinutes !== 60) throw new Error(`idleMinutes is ${settings.idleMinutes}, not 60`);
}

/** Saves a screenshot when STUDYAT_SHOTS_DIR is set (the run that produces the final shots). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.STUDYAT_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name) });
}

/** Runs one read-only query against a data folder's database file (the app may be closed). */
export async function queryDb(dir: string, sql: string): Promise<Record<string, unknown>[]> {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const db = new SQL.Database(readFileSync(join(dir, DB_NAME)));
  try {
    const res = db.exec(sql)[0];
    if (!res) return [];
    return res.values.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]])));
  } finally {
    db.close();
  }
}

/** 10:00 local on the day `daysAgo` before `now`. */
function morning(now: number, daysAgo: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

/**
 * A database with eight weeks of finished sessions across all six subjects (some days skipped,
 * none today) and no stored recaps, so last week is a finished week whose recap has never been
 * shown (spec §9 criteria 10, 16). Onboarded, idleMinutes 60. Returns the number of sessions.
 */
export async function seedHistory(dir: string, now = Date.now()): Promise<number> {
  const db = await openDatabase({ dir, now: () => now, wasmPath: WASM, builtinPath: BUILTIN });
  const repo = sessionsRepo(db);
  const subjects = db.raw
    .exec('SELECT id FROM subjects ORDER BY sort, id')[0]
    ?.values.map((r) => Number(r[0])) ?? [];
  let count = 0;
  for (let daysAgo = 1; daysAgo <= 56; daysAgo++) {
    if (daysAgo % 5 === 3) continue;
    const perDay = 1 + (daysAgo % 3);
    for (let k = 0; k < perDay; k++) {
      const startedAt = morning(now, daysAgo) + k * 90 * 60_000;
      const focusMs = (25 + ((daysAgo * 7 + k * 11) % 30)) * 60_000;
      const row = repo.insertRunning({
        pomodoroId: randomUUID(),
        subjectId: subjects[(daysAgo + k) % subjects.length] ?? null,
        startedAt,
        dayKey: dayKeyOf(startedAt, 4),
      });
      repo.close(row.id, startedAt + focusMs, focusMs, 0);
      count++;
    }
  }
  db.raw.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarded', 'true')");
  db.raw.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('idleMinutes', '60')");
  await db.close();
  return count;
}

/**
 * A schema-v1 database file (only the first migration, as the app shipped before the Notes
 * widget) with one finished session, so the v2 migration can be watched on launch.
 */
export async function buildV1Database(dir: string, now = Date.now()): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const raw = new SQL.Database();
  const v1 = MIGRATIONS.filter((m) => m.version === 1);
  await migrate(raw, null, now, v1);
  const startedAt = morning(now, 2);
  raw.run(
    `INSERT INTO sessions (pomodoro_id, subject_id, started_at, ended_at, checkpoint_at, focus_ms,
       discarded_ms, day_key, status) VALUES (?, NULL, ?, ?, ?, ?, 0, ?, 'done')`,
    [randomUUID(), startedAt, startedAt + 30 * 60_000, startedAt + 30 * 60_000, 30 * 60_000, dayKeyOf(startedAt, 4)],
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, DB_NAME), raw.export());
  raw.close();
}
