// Task 19 extra (spec §3.3): a damaged studyat.sqlite is set aside as studyat.corrupt-*.sqlite, the
// corrupt dialog shows before any window, and "Start fresh" opens an empty, working database.
// The dialog is native, so dialog.showMessageBox is stubbed in main as soon as Playwright connects
// (main reads `dialog.showMessageBox` at call time). If the database opened before the stub landed,
// the real dialog is up: then the test asserts the set-aside file and that no window has opened
// (the dialog holds the launch), and records which path ran in its annotations.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_NAME, expect, queryDb, sleep, test } from './fixtures';

interface Shown {
  message: string;
  detail: string;
  buttons: string[];
}

test('a corrupt database is set aside and the app starts fresh after the dialog', async ({ launchBare, dataDir }, testInfo) => {
  writeFileSync(join(dataDir, DB_NAME), Buffer.from('this is not a SQLite database, just garbage '.repeat(200)));

  const app = await launchBare(async (a) => {
    await a.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __shown: unknown[] };
      g.__shown = [];
      const stub = async (...args: unknown[]): Promise<Electron.MessageBoxReturnValue> => {
        const opts = (args.length > 1 ? args[1] : args[0]) as Electron.MessageBoxOptions;
        g.__shown.push({ message: opts.message, detail: opts.detail ?? '', buttons: opts.buttons ?? [] });
        // "Start fresh" (with no backup it is the only button).
        const fresh = (opts.buttons ?? []).findIndex((b) => /fresh/i.test(b));
        return { response: Math.max(0, fresh), checkboxChecked: false };
      };
      dialog.showMessageBox = stub as typeof dialog.showMessageBox;
    });
  });

  // The damaged file is copied aside, never deleted.
  await expect.poll(() => readdirSync(dataDir).filter((f) => /^studyat\.corrupt-.*\.sqlite$/.test(f)).length).toBe(1);

  const windows = await Promise.race([
    app.firstWindow().then(() => 'window' as const),
    sleep(15_000).then(() => 'none' as const),
  ]);
  const shown = await app.evaluate(() => (globalThis as unknown as { __shown?: Shown[] }).__shown ?? []);

  if (shown.length === 0) {
    // The real dialog won the race: it is up, and holds the launch.
    testInfo.annotations.push({ type: 'corrupt', description: 'real dialog shown before the stub; asserted file + no window' });
    expect(windows).toBe('none');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    return;
  }

  testInfo.annotations.push({ type: 'corrupt', description: 'dialog stubbed; answered Start fresh' });
  expect(shown[0]?.message).toBe('StudyAt couldn’t open your study data');
  expect(shown[0]?.detail).toMatch(/studyat\.corrupt-.*\.sqlite/);
  expect(windows).toBe('window');
  const win = await app.firstWindow();
  await win.locator('[data-testid="shell"]').waitFor({ timeout: 30_000 });
  // A fresh database: seeded subjects, no sessions, and the corrupt mark cleared by Start fresh.
  expect(await win.evaluate(() => window.studyat.stats.sessions())).toHaveLength(0);
  expect(await win.evaluate(() => window.studyat.subjects.list())).toHaveLength(6);
  expect(existsSync(join(dataDir, DB_NAME))).toBe(true);
  await expect.poll(async () => (await queryDb(dataDir, "SELECT key FROM meta WHERE key LIKE 'corrupt%'")).length).toBe(0);
});
