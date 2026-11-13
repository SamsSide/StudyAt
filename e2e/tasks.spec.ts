// v1 spec §9 criterion 13 (kept by simple-tasks design §9): tasks added, ticked, reordered (Alt+Up, the keyboard reorder) and cleared
// persist across a relaunch.
import { expect, prepare, queryDb, quitApp, shot, sleep, test } from './fixtures';

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
  expect((await win.evaluate(() => window.studyat.tasks.list())).find((t) => t.text === B)?.done).toBe(true);
  await sleep(600);
  await shot(win, 'tasks.png');

  await win.getByRole('checkbox', { name: `Mark "${C}" as done` }).focus();
  await win.keyboard.press('Alt+ArrowUp');
  const openTexts = async (): Promise<string[]> =>
    (await win.evaluate(() => window.studyat.tasks.list())).filter((t) => !t.done).map((t) => t.text);
  await expect.poll(openTexts).toEqual([C, A]);

  await win.getByRole('button', { name: 'Clear done' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.tasks.list())).map((t) => t.text)).toEqual([C, A]);
  await quitApp(first.app);

  const second = await launch();
  const tasks = await second.win.evaluate(() => window.studyat.tasks.list());
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

// Simple-tasks design (docs/planning/specs/2026-11-13-simple-tasks-design.md §9 criterion 5):
// v1.2 keeps one thing from the planner at Sam's request: ▶ on a sticky starts focus on it. The
// task travels to the session row; the timer's subject is whatever was picked, never the task's.
test('▶ on a sticky starts focus on it; the session row has the task and the subject is unchanged', async ({ launch, dataDir }) => {
  const { app, win } = await launch();
  await prepare(win);
  const subject = (await win.evaluate(() => window.studyat.subjects.list()))[0]!;
  await win.getByRole('combobox', { name: 'Subject' }).click();
  await win.getByRole('option', { name: subject.name }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).subjectId).toBe(subject.id);

  const tasks = await win.evaluate(async () => {
    await window.studyat.tasks.create({ text: 'Lab 7', colour: 'yellow' });
    return window.studyat.tasks.create({ text: 'Lab 6', colour: 'blue' });
  });
  const lab7 = tasks.find((t) => t.text === 'Lab 7')!;
    await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Tasks/ }).click();
  const items = win.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  const note = items.filter({ hasText: 'Lab 7' });
  await expect(note).toBeVisible();
  await note.hover();
  await note.getByRole('button', { name: 'Start focus on "Lab 7"' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  const started = await win.evaluate(() => window.studyat.timer.get());
  expect({ mode: started.mode, subjectId: started.subjectId, taskId: started.taskId, taskText: started.taskText }).toEqual({
    mode: 'focus',
    subjectId: subject.id,
    taskId: lab7.id,
    taskText: 'Lab 7',
  });
  await win.evaluate(() => window.studyat.timer.pause());
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('paused');

  // A done sticky has no ▶.
  await win.getByRole('checkbox', { name: 'Mark "Lab 6" as done' }).click();
  await win.getByRole('button', { name: 'Done (1)' }).click();
  await expect(win.getByRole('checkbox', { name: 'Mark "Lab 6" as not done' })).toBeChecked();
  await win.getByRole('checkbox', { name: 'Mark "Lab 6" as not done' }).focus();
  await expect(win.getByRole('button', { name: `Start focus on "Lab 6"` })).toHaveCount(0);

  // Provenance: the session row on disk is the one this ▶ opened.
  expect(await quitApp(app)).toBe(0);
  const rows = await queryDb(dataDir, 'SELECT task_id, task_text, subject_id FROM sessions');
  expect(rows).toHaveLength(1);
  for (const r of rows) expect(r).toEqual({ task_id: lab7.id, task_text: 'Lab 7', subject_id: subject.id });
});
