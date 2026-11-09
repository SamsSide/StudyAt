// Task 19 extra: quitting (the tray's "Quit StudyAt" calls app.quit()) while focus runs saves the
// running row as done with its focus time (Sam's A1 path, with no away period).
import { expect, prepare, queryDb, quitApp, sleep, test } from './fixtures';

test('quitting while focus runs saves the running row', async ({ launch, dataDir }) => {
  const { app, win } = await launch();
  await prepare(win);
  await win.evaluate(() => window.studyat.timer.start());
  await sleep(65_000);
  expect((await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');

  const quitAt = Date.now();
  const code = await quitApp(app);
  expect(code).not.toBe('timeout');

  const rows = await queryDb(dataDir, 'SELECT status, ended_at, focus_ms, discarded_ms FROM sessions');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('done');
  expect(Number(rows[0]?.focus_ms)).toBeGreaterThanOrEqual(60_000);
  expect(Number(rows[0]?.discarded_ms)).toBe(0);
  // Closed at the quit, not at an earlier checkpoint.
  expect(Number(rows[0]?.ended_at)).toBeGreaterThanOrEqual(quitAt - 1_000);
});
