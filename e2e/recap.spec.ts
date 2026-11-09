// Spec §9 criterion 16: with seeded data, the weekly recap pop-up for the last finished week shows
// once, and never again after it has been seen.
import { addDays, dayKeyOf, weekStartOf } from '../src/core/time';
import { expect, queryDb, quitApp, seedHistory, shot, sleep, test } from './fixtures';

test('the weekly recap pops up once for last week', async ({ launch, dataDir }) => {
  await seedHistory(dataDir);
  const lastWeek = addDays(weekStartOf(dayKeyOf(Date.now(), 4)), -7);

  const first = await launch();
  const popup = first.win.locator('[role="dialog"][aria-modal="true"]');
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('heading').first()).toBeVisible();
  await sleep(1_000);
  await shot(first.win, 'recap-popup.png');
  // Provenance: main computed and stored last week's recap, and the pop-up marked it shown.
  await expect
    .poll(async () => (await first.win.evaluate(() => window.studyat.recaps.list())).find((r) => r.weekStart === lastWeek)?.weekStart)
    .toBe(lastWeek);
  await first.win.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect.poll(() => first.win.evaluate(() => window.studyat.recaps.pending())).toBeNull();
  await quitApp(first.app);
  const stored = await queryDb(dataDir, `SELECT shown_at FROM recaps WHERE week_start = '${lastWeek}'`);
  expect(stored[0]?.shown_at).not.toBeNull();

  const second = await launch();
  await sleep(3_000);
  await expect(second.win.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
});
