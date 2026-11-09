// Spec §9 criterion 7: a focus segment with a subject, run for 70 s with focusMinutes 2, records a
// sessions row with the right subject and day key, and today's overview is at least a minute.
import { dayKeyOf } from '../src/core/time';
import { expect, prepare, queryDb, shot, sleep, test } from './fixtures';

const SUBJECT = 'COMP2261 Artificial Intelligence';

test('a 70 s focus run records a session with its subject and day key', async ({ launch, dataDir }) => {
  const { win } = await launch();
  await prepare(win, { focusMinutes: 2 });

  await win.getByRole('combobox', { name: 'Subject' }).click();
  await win.getByRole('option', { name: SUBJECT }).click();
  const subject = (await win.evaluate(() => window.studyat.subjects.list())).find((s) => s.name === SUBJECT);
  expect(subject).toBeDefined();
  expect((await win.evaluate(() => window.studyat.timer.get())).subjectId).toBe(subject?.id);

  const startedAt = Date.now();
  await win.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  await sleep(3_000);
  await shot(win, 'timer-running.png');
  await sleep(67_000);

  const sessions = await win.evaluate(() => window.studyat.stats.sessions());
  expect(sessions).toHaveLength(1);
  const row = sessions[0];
  expect(row?.subjectId).toBe(subject?.id);
  expect(row?.dayKey).toBe(dayKeyOf(startedAt, 4));
  expect(row?.focusMs).toBeGreaterThanOrEqual(60_000);
  const overview = await win.evaluate(() => window.studyat.stats.overview());
  expect(overview.todayMs).toBeGreaterThanOrEqual(60_000);

  // Provenance: the row is on disk, checkpointed, not just in memory.
  const disk = await queryDb(dataDir, 'SELECT subject_id, day_key, focus_ms, status FROM sessions');
  expect(disk).toHaveLength(1);
  expect(disk[0]?.subject_id).toBe(subject?.id);
  expect(Number(disk[0]?.focus_ms)).toBeGreaterThanOrEqual(45_000);
});
