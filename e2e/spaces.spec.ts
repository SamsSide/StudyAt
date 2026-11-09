// Spec §9 criterion 11: adding a local image and a YouTube URL creates spaces and switches the
// background. The native file picker is stubbed in main to return a fixture JPG (a copy of a
// bundled image, with a space in its name).
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, expect, prepare, shot, sleep, test } from './fixtures';

const VIDEO_ID = 'jfKfPfyJRdk';

test('a local image and a YouTube link become spaces and the background follows', async ({ launch, dataDir }) => {
  const jpg = join(dataDir, 'My desk photo.jpg');
  copyFileSync(join(ROOT, 'assets', 'images', 'lake-shore.jpg'), jpg);
  const { app, win } = await launch();
  await prepare(win);
  await app.evaluate(({ dialog }, file) => {
    const pick = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [file] });
    dialog.showOpenDialog = pick as typeof dialog.showOpenDialog;
  }, jpg);

  const before = await win.evaluate(() => window.studyat.spaces.list());
  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Spaces/ }).click();
  await win.getByRole('button', { name: 'Add files…' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.spaces.list())).length).toBe(before.length + 1);
  const image = (await win.evaluate(() => window.studyat.spaces.list())).find((s) => !before.some((b) => b.id === s.id));
  expect(image?.kind).toBe('image');
  expect(image?.source).toBe(jpg);

  await win.getByRole('button', { name: `Use ${image?.name}`, exact: true }).click();
  const img = win.locator('[data-testid="space-image"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect((await win.evaluate(() => window.studyat.settings.get())).activeSpaceId).toBe(image?.id);
  await sleep(800);
  await shot(win, 'spaces-panel-own-image.png');

  await win.getByRole('textbox', { name: 'YouTube link' }).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  await win.getByRole('button', { name: 'Add YouTube' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.spaces.list())).length).toBe(before.length + 2);
  const yt = (await win.evaluate(() => window.studyat.spaces.list())).find((s) => s.kind === 'youtube' && s.source === VIDEO_ID);
  expect(yt).toBeDefined();
  if ((await win.evaluate(() => window.studyat.settings.get())).activeSpaceId !== yt?.id) {
    await win.getByRole('button', { name: `Use ${yt?.name}`, exact: true }).click();
  }
  await expect(win.locator('[data-testid="space-youtube"] iframe')).toHaveAttribute('src', new RegExp(VIDEO_ID));
  await expect(win.locator('[data-testid="space-image"]')).toHaveCount(0);
});
