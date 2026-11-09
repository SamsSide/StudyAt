// Spec §9 criterion 8: kill the app mid-focus, relaunch, and the row is closed at its last
// checkpoint (study-dev rule 2). The run lasts 80 s, not the brief's 20 s: orphan recovery removes a
// recovered row under a minute (MIN_SESSION_MS, sessionsRepo.deleteIfShort), so a 20 s run would
// leave no row to check. Ruling logged in the Task 19 report.
import { expect, killApp, prepare, queryDb, sleep, test, waitForExit } from './fixtures';

test('a killed focus run is closed at its last checkpoint on relaunch', async ({ launch, dataDir }) => {
  const first = await launch();
  await prepare(first.win);
  await first.win.evaluate(() => window.studyat.timer.start());
  await sleep(80_000);

  // Before the kill: one running row on disk, checkpointed past a minute.
  const before = await queryDb(dataDir, 'SELECT id, status, checkpoint_at, focus_ms FROM sessions');
  expect(before).toHaveLength(1);
  expect(before[0]?.status).toBe('running');
  expect(Number(before[0]?.focus_ms)).toBeGreaterThanOrEqual(60_000);

  killApp(first.app);
  await waitForExit(first.app);
  const killedAt = Date.now();

  const second = await launch();
  const sessions = await second.win.evaluate(() => window.studyat.stats.sessions());
  expect(sessions).toHaveLength(1);
  const row = sessions[0];
  expect(row?.status).toBe('done');
  expect(row?.endedAt).toBe(row?.checkpointAt);
  expect(row?.checkpointAt).toBeLessThanOrEqual(killedAt);
  expect(row?.focusMs).toBeGreaterThanOrEqual(60_000);
  // The timer did not carry on from the killed run.
  expect((await second.win.evaluate(() => window.studyat.timer.get())).status).toBe('idle');
});
