// Spec §9 criterion 10: with seeded data, the stats overlay renders its tiles, heatmap, week,
// trend, subject and sessions sections.
import { expect, seedHistory, shot, sleep, test } from './fixtures';

test('the stats overlay renders every section from seeded data', async ({ launch, dataDir }) => {
  const seeded = await seedHistory(dataDir);
  const { win } = await launch();
  // The seeded history leaves last week's recap pending; close it first.
  const recap = win.locator('[role="dialog"][aria-modal="true"]');
  await recap.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (await recap.isVisible()) {
    await win.keyboard.press('Escape');
    await expect(recap).toBeHidden();
  }

  // Provenance: the overlay reads main's numbers for the seeded rows.
  const sessions = await win.evaluate(() => window.studyat.stats.sessions());
  expect(sessions).toHaveLength(seeded);
  const overview = await win.evaluate(() => window.studyat.stats.overview());
  expect(overview.allTimeMs).toBeGreaterThan(0);

  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Stats/ }).click();
  await expect(win.getByRole('region', { name: 'Totals' }).or(win.getByLabel('Totals'))).toBeVisible();
  for (const title of ['Study calendar', 'This week', 'Last 12 weeks', 'By subject', 'Sessions', 'Weekly recaps']) {
    await expect(win.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await expect(win.getByRole('group', { name: /^Study calendar,/ })).toBeVisible();
  await sleep(1_500);
  await shot(win, 'stats-seeded.png');
});
