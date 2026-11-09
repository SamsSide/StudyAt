// Spec §9 criterion 12: a soundboard channel's level persists across a relaunch.
import { expect, prepare, quitApp, shot, sleep, test } from './fixtures';

test('a channel level is restored after a relaunch', async ({ launch }) => {
  const first = await launch();
  await prepare(first.win);
  const dock = first.win.locator('nav[aria-label="Dock"]');
  await dock.getByRole('button', { name: /^Sounds/ }).click();
  const rain = first.win.getByRole('slider', { name: 'Rain volume' });
  await rain.focus();
  for (let i = 0; i < 12; i++) await first.win.keyboard.press('ArrowRight');
  const level = Number(await rain.inputValue());
  expect(level).toBeGreaterThan(0);
  // Provenance: main stored the level (by sound id) in settings.
  const rainId = (await first.win.evaluate(() => window.studyat.sounds.list())).find((s) => s.name === 'Rain')?.id;
  await expect
    .poll(async () => (await first.win.evaluate(() => window.studyat.settings.get())).soundLevels[String(rainId)])
    .toBeCloseTo(level, 2);
  await sleep(600);
  await shot(first.win, 'sounds-panel.png');
  await quitApp(first.app);

  const second = await launch();
  await second.win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Sounds/ }).click();
  await expect(second.win.getByRole('slider', { name: 'Rain volume' })).toHaveValue(String(level));
});
