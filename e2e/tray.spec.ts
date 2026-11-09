// Spec §9 criterion 9: closing the window hides it to the tray, the timer keeps running, and the
// mini timer appears (miniWhenHidden, on by default).
import { expect, prepare, shot, sleep, test } from './fixtures';

test('closing the window keeps the timer running and shows the mini timer', async ({ launch }) => {
  const { app, win } = await launch();
  await prepare(win);
  await win.evaluate(() => window.studyat.timer.start());
  await sleep(1_500);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((b) => !b.webContents.getURL().includes('mini'))
      ?.close();
  });
  await expect.poll(() => app.windows().some((p) => p.url().includes('mini')), { timeout: 20_000 }).toBe(true);
  const mini = app.windows().find((p) => p.url().includes('mini'));
  if (!mini) throw new Error('no mini window');

  // The process lives on with the main window hidden, not destroyed.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((b) => ({
          mini: b.webContents.getURL().includes('mini'),
          visible: b.isVisible(),
        })),
      ),
    )
    .toEqual(
      expect.arrayContaining([
        { mini: false, visible: false },
        { mini: true, visible: true },
      ]),
    );
  const remaining1 = (await win.evaluate(() => window.studyat.timer.get())).remainingMs;
  await sleep(2_500);
  const state = await win.evaluate(() => window.studyat.timer.get());
  expect(state.status).toBe('running');
  expect(state.remainingMs).toBeLessThan(remaining1);

  await mini.waitForLoadState('load');
  await expect(mini.getByLabel('Time remaining')).toBeVisible();
  await sleep(500);
  await shot(mini, 'mini-window.png');
});
