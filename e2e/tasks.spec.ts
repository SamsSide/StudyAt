// Spec §9 criterion 13: tasks added, ticked, reordered (Alt+Up, the keyboard reorder) and cleared
// persist across a relaunch.
import { expect, prepare, quitApp, shot, sleep, test } from './fixtures';

const A = 'Read chapter 4 of the biology notes';
const B = 'Past paper Q3';
const C = 'Email the tutor';

test('tasks add, tick, reorder and clear done, and persist', async ({ launch }) => {
  const first = await launch();
  await prepare(first.win);
  const win = first.win;
  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Tasks/ }).click();
  const input = win.getByRole('textbox', { name: 'Add a task' });
  for (const text of [A, B, C]) {
    await input.fill(text);
    await input.press('Enter');
    await expect(win.getByText(text, { exact: true })).toBeVisible();
  }

  await win.getByRole('checkbox', { name: `Mark "${B}" as done` }).click();
  // A ticked task moves to the collapsed "Done" section.
  await win.getByRole('button', { name: 'Done (1)' }).click();
  await expect(win.getByRole('checkbox', { name: `Mark "${B}" as not done` })).toBeChecked();
  expect((await win.evaluate(() => window.studyat.legacyTasks.list())).find((t) => t.text === B)?.done).toBe(true);
  await sleep(600);
  await shot(win, 'tasks.png');

  await win.getByRole('checkbox', { name: `Mark "${C}" as done` }).focus();
  await win.keyboard.press('Alt+ArrowUp');
  const openTexts = async (): Promise<string[]> =>
    (await win.evaluate(() => window.studyat.legacyTasks.list())).filter((t) => !t.done).map((t) => t.text);
  await expect.poll(openTexts).toEqual([C, A]);

  await win.getByRole('button', { name: 'Clear done' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.legacyTasks.list())).map((t) => t.text)).toEqual([C, A]);
  await quitApp(first.app);

  const second = await launch();
  const tasks = await second.win.evaluate(() => window.studyat.legacyTasks.list());
  expect(tasks.map((t) => [t.text, t.done])).toEqual([
    [C, false],
    [A, false],
  ]);
  // The widget stayed open, and shows them in that order.
  const items = second.win.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(C);
  await expect(items.nth(1)).toContainText(A);
});
