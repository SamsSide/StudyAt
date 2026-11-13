// v1 spec §9 criterion 13 (kept by simple-tasks design §9): tasks added, ticked, reordered
// (Alt+Up, the keyboard reorder) and cleared persist across a relaunch.
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
  // A session under a minute of focus is dropped (controller.ts), so run past one.
  await sleep(62_000);
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

// Simple-tasks design §9 criteria 4-6, as screenshots for Sam: the widget with coloured and done
// stickies, ▶ on hover over short and long wrapping text, the picker, and the break notice.
test('screenshots: stickies, ▶ on hover, the timer picker and the next-focus notice', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const long = 'Write up the titration practical: method, raw results table, the percentage error, and a paragraph on sources of error';
  await win.evaluate(async (longText) => {
    const api = window.studyat.tasks;
    await api.create({ text: 'Lab 7', colour: 'yellow' });
    await api.create({ text: 'Past paper Q3', colour: 'blue' });
    await api.create({ text: longText, colour: 'pink' });
    const all = await api.create({ text: 'Email the tutor', colour: 'green' });
    const tutor = all.find((t) => t.text === 'Email the tutor')!;
    await api.update(tutor.id, { done: true });
  }, long);
  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Tasks/ }).click();
  const items = win.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await win.getByRole('button', { name: 'Done (1)' }).click();
  await win.mouse.move(5, 5);
  await sleep(400);
  await shot(win, 'tasks-widget.png');

  const longNote = items.filter({ hasText: 'Write up the titration' });
  const play = longNote.getByRole('button', { name: /^Start focus on/ });
  const box = async () => (await longNote.boundingBox())!;
  const opacity = () => play.evaluate((el) => getComputedStyle(el).opacity);
  await win.mouse.move(5, 5);
  await sleep(400);
  expect(await opacity()).toBe('0');
  const before = await box();
  await shot(win, 'tasks-no-hover.png');
  await longNote.hover();
  await sleep(400);
  expect(await opacity()).toBe('1');
  const after = await box();
  test.info().annotations.push({ type: 'hover reflow', description: `before ${JSON.stringify(before)} after ${JSON.stringify(after)}` });
  // The ▶ keeps its slot, so the note must not reflow when it appears.
  expect(after.height).toBe(before.height);
  await shot(win, 'tasks-play-hover.png');

  // Keyboard focus reveals ▶ too: Tab from the note's first control until it lands on ▶.
  await win.mouse.move(5, 5);
  await longNote.getByRole('checkbox').first().focus();
  for (let i = 0; i < 6 && !(await play.evaluate((el) => el === document.activeElement)); i++) await win.keyboard.press('Tab');
  await expect(play).toBeFocused();
  await sleep(400);
  expect(await opacity()).toBe('1');
  expect((await box()).height).toBe(before.height);
  await shot(win, 'tasks-play-focus.png');

  await win.mouse.move(5, 5);
  await win.getByRole('combobox', { name: 'Task' }).click();
  const options = win.getByRole('option');
  await expect(options.filter({ hasText: 'Lab 7' })).toBeVisible();
  await expect(options.filter({ hasText: 'Email the tutor' })).toHaveCount(0);
  await shot(win, 'timer-picker.png');
  await win.keyboard.press('Escape');

  await win.evaluate(() => window.studyat.timer.start());
  await win.evaluate(() => window.studyat.timer.skip());
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).mode).not.toBe('focus');
  // Skip leaves the break idle; run it, so ▶ lands during a running break.
  await win.evaluate(() => window.studyat.timer.start());
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  await items.filter({ hasText: 'Lab 7' }).hover();
  await items.filter({ hasText: 'Lab 7' }).getByRole('button', { name: 'Start focus on "Lab 7"' }).click();
  await expect(win.getByText('Task set for your next focus.')).toBeVisible();
  await shot(win, 'tasks-next-focus.png');
});
