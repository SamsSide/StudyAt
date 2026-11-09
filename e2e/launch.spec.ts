// Spec §9 criterion 6: the app launches on Windows with a throwaway STUDYAT_USER_DATA and shows the
// first space, the timer and the six subjects.
import { expect, queryDb, shot, test } from './fixtures';

test('first launch shows the first space, the timer and six subjects', async ({ launch, dataDir }) => {
  const { app, win } = await launch();

  // Provenance: the app really is on the throwaway folder, and wrote its database there.
  expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(dataDir);

  const spaces = await win.evaluate(() => window.studyat.spaces.list());
  const settings = await win.evaluate(() => window.studyat.settings.get());
  const first = spaces[0];
  expect(first?.name).toBe('Rain on the window');
  expect(settings.activeSpaceId ?? first?.id).toBe(first?.id);
  // The first space is a YouTube embed of its video.
  const iframe = win.locator('[data-testid="space-youtube"] iframe');
  await expect(iframe).toHaveAttribute('src', new RegExp(first?.source ?? 'none'));

  await expect(win.getByRole('timer')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(win.getByRole('dialog', { name: 'Welcome' }).or(win.getByLabel('Welcome'))).toBeVisible();
  await shot(win, 'main-view-first-launch.png');

  const subjects = await win.evaluate(() => window.studyat.subjects.list());
  expect(subjects.filter((s) => !s.archived)).toHaveLength(6);
  await win.getByRole('button', { name: 'Got it' }).click();
  await win.getByRole('combobox', { name: 'Subject' }).click();
  const options = win.getByRole('option');
  // Six subjects, plus any "no subject" entry the picker offers.
  for (const s of subjects) await expect(options.filter({ hasText: s.name })).toHaveCount(1);
  await shot(win, 'subject-picker.png');
  await win.keyboard.press('Escape');

  const rows = await queryDb(dataDir, 'SELECT COUNT(*) AS n FROM subjects WHERE archived = 0');
  expect(rows[0]?.n).toBe(6);
});
