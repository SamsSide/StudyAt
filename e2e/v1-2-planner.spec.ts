// v1.2 end to end, part B (spec §9 criteria 8–17, 19; Task 35): the planner and the timer. The v4
// migration, the board (inset, quick add, real-pointer and keyboard drags, the placement picker,
// Month and Day, delete), ▶ with an intention and its outcome, spaced revision with the exam cap,
// repeat, roll forward and reminders, plus the dispatcher's checks on the pop-up fixes. Every test
// launches the BUILT app on a throwaway STUDYAT_USER_DATA (the fixtures); screenshots go to
// STUDYAT_SHOTS_DIR when it is set. Bridge seeds the renderer has no event for are followed by a
// renderer reload, so the stores read them back from main. Rulings since planning (Sam: "look like
// Tweek"): the board's rows are compact (subject dot and estimate only, tags in the widget), an
// "Inbox" list comes first, the lists sit in one row below the week, the board scrolls as one page.
import type { Locator, Page } from '@playwright/test';
import initSqlJs from 'sql.js';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, dayKeyOf, weekStartOf } from '../src/core/time';
import { MIGRATIONS, migrate } from '../src/main/db/migrations';
import { formatDayLabel } from '../src/renderer/stats/format';
import { SEED_SUBJECTS } from '../src/shared/subjects';
import { DB_NAME, expect, prepare, queryDb, quitApp, shot, sleep, test, WASM } from './fixtures';

/** Task 1's spike video: it has a 2160p stream (task-1-report.md). */
const VIDEO_4K = 'LXb3EKWsInQ';
const ROLLOVER = 4;
const AI = 'COMP2221 Programming Paradigms';

const dock = (win: Page, label: string) =>
  win.locator('nav[aria-label="Dock"]').getByRole('button', { name: new RegExp(`^${label}`) }).first();
const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();
const boardOf = (win: Page) => win.getByRole('dialog', { name: 'Tasks' });
/** A day's section on the board or in the widget's Week ("Thu 12 Nov"). */
const daySection = (scope: Locator, day: string) => scope.locator(`section[aria-label="${formatDayLabel(day)}"]`);
const rowOf = (scope: Locator, title: string) => scope.locator('li[data-task-id]').filter({ hasText: title }).first();

const studyDay = (ms: number): string => dayKeyOf(ms, ROLLOVER);
function localParts(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

async function calm(win: Page): Promise<void> {
  await win.mouse.move(640, 790);
  await sleep(400);
}

async function reload(win: Page): Promise<void> {
  await win.reload();
  await win.locator('[data-testid="shell"]').waitFor({ timeout: 30_000 });
  await sleep(800);
}

async function openBoard(win: Page): Promise<Locator> {
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (!(await boardOf(win).isVisible())) await win.keyboard.press('b');
  const board = boardOf(win);
  await expect(board.getByRole('group', { name: 'Board view' })).toBeVisible();
  return board;
}

async function boardView(board: Locator, view: 'Day' | 'Week' | 'Month'): Promise<void> {
  const b = board.getByRole('group', { name: 'Board view' }).getByRole('button', { name: view, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function openTasks(win: Page, tab: 'Day' | 'Week' | 'Lists'): Promise<Locator> {
  const w = widget(win, 'Tasks');
  if (!(await w.isVisible())) await dock(win, 'Tasks').click();
  await expect(w).toBeVisible();
  const t = w.getByRole('tablist', { name: 'Tasks view' }).getByRole('tab', { name: tab, exact: true });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
  return w;
}

/** A real-pointer drag through Playwright's mouse (into the test app only): grip, a nudge past the
 *  6 px activation distance, then on to the point in steps, a settle, and release. */
async function pointerDrag(win: Page, grip: Locator, to: { x: number; y: number }, mid?: string): Promise<void> {
  await grip.scrollIntoViewIfNeeded();
  const row = grip.locator('xpath=ancestor::li[1]');
  await row.hover();
  const g = await grip.boundingBox();
  if (!g) throw new Error('no grip box');
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 8, y + 8, { steps: 4 });
  await win.mouse.move(to.x, to.y, { steps: 20 });
  await sleep(400);
  if (mid) await shot(win, mid);
  await win.mouse.up();
  await sleep(400);
}

const grip = (scope: Locator, title: string) => scope.getByRole('button', { name: `Move "${title}"`, exact: true }).first();

interface Seed {
  title: string;
  day?: string;
  listId?: number;
  estimateMin?: number;
  tags?: string[];
  subjectId?: number | null;
}

/** Creates tasks in main through the bridge and returns their ids, in order. */
async function seed(win: Page, tasks: Seed[]): Promise<number[]> {
  return win.evaluate(async (list) => {
    const ids: number[] = [];
    for (const t of list) ids.push((await window.studyat.tasks.create(t)).tasks[0]!.id);
    return ids;
  }, tasks);
}

async function subjectId(win: Page, code: string): Promise<number> {
  const s = (await win.evaluate(() => window.studyat.subjects.list())).find((x) => x.name.startsWith(code));
  if (!s) throw new Error(`no subject ${code}`);
  return s.id;
}

async function listId(win: Page, name: string): Promise<number> {
  const l = (await win.evaluate(() => window.studyat.planner.lists())).lists.find((x) => x.name.startsWith(name));
  if (!l) throw new Error(`no list ${name}`);
  return l.id;
}

const taskOf = (win: Page, id: number) => win.evaluate((i) => window.studyat.planner.task(i), id);

/** Open titles of a day, in main's order. */
async function dayTitles(win: Page, day: string): Promise<string[]> {
  const r = await win.evaluate((d) => window.studyat.planner.day(d), day);
  return r.tasks.filter((t) => t.day === day && !t.done).map((t) => t.title);
}

// ---------------------------------------------------------------------------------------------
// 1. Migration v4 on a real v3 database (AC 8).

test('migration: a v3 database opens at schema 4 with a backup, an archive and one list per subject', async ({ launch, dataDir }) => {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const raw = new SQL.Database();
  const now = Date.now();
  await migrate(raw, null, now, MIGRATIONS.filter((m) => m.version <= 3));
  SEED_SUBJECTS.forEach((s, i) => raw.run('INSERT INTO subjects (name, colour, archived, sort) VALUES (?, ?, 0, ?)', [s.name, s.colour, i]));
  for (const [i, text] of ['Old sticky: buy index cards', 'Old sticky: email the lab tutor'].entries()) {
    raw.run('INSERT INTO tasks (text, colour, done, sort, created_at) VALUES (?, ?, 0, ?, ?)', [text, 'yellow', i, now]);
  }
  raw.run("INSERT INTO settings (key, value) VALUES ('onboarded', 'true')");
  raw.run("INSERT INTO settings (key, value) VALUES ('idleMinutes', '60')");
  writeFileSync(join(dataDir, DB_NAME), raw.export());
  raw.close();
  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '3' }]);

  const { app, win } = await launch();
  expect(readdirSync(join(dataDir, 'backups')).filter((f) => /^pre-migration-v3-.*\.sqlite$/.test(f))).toHaveLength(1);
  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '4' }]);
  expect(await queryDb(dataDir, 'SELECT text FROM tasks_v1_archive ORDER BY id')).toEqual([
    { text: 'Old sticky: buy index cards' },
    { text: 'Old sticky: email the lab tutor' },
  ]);
  // Ruling (Sam, since planning): an "Inbox" list comes first, then the six subject lists.
  const lists = await queryDb(dataDir, 'SELECT name, subject_id FROM task_lists ORDER BY sort');
  expect(lists.map((l) => l.name)).toEqual(['Inbox', ...SEED_SUBJECTS.map((s) => s.name)]);
  expect(lists.filter((l) => l.subject_id !== null)).toHaveLength(6);
  // Neither old task shows anywhere in the Tasks widget.
  for (const tab of ['Day', 'Week', 'Lists'] as const) {
    const w = await openTasks(win, tab);
    await expect(w).not.toContainText('Old sticky');
  }
  expect(await quitApp(app)).toBe(0);
  expect(await queryDb(dataDir, 'SELECT count(*) AS n FROM tasks')).toEqual([{ n: 0 }]);
});

// ---------------------------------------------------------------------------------------------
// 2. Board, quick add, drags, views and delete (AC 10, 14), and the widget's views.

test('board: inset 24 px, quick add, pointer drags list→day and day→day, reorder, a miss, Month and Day, delete', async ({ launch, dataDir }) => {
  const { app, win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const mon = weekStartOf(today);
  const thu = addDays(mon, 3);
  const comp2221 = await subjectId(win, 'COMP2221');
  const aiList = await listId(win, 'COMP2221');
  const [haskell, , , dayDrag, miss] = await seed(win, [
    { title: 'Haskell folds practice', listId: aiList, estimateMin: 40 },
    { title: 'Reorder first', day: mon, estimateMin: 15 },
    { title: 'Reorder second', day: mon, estimateMin: 30 },
    { title: 'Network layer summary', day: addDays(mon, 1), estimateMin: 30 },
    { title: 'Stays on Wednesday', day: addDays(mon, 2) },
    { title: 'Type classes reading', listId: aiList, estimateMin: 30 },
  ]);
  await reload(win);

  const board = await openBoard(win);
  // Measured once its opening transition has settled.
  await expect.poll(async () => Math.round((await board.boundingBox())?.x ?? 0)).toBe(24);
  await sleep(300);
  const box = await board.boundingBox();
  test.info().annotations.push({ type: 'board box', description: JSON.stringify(box) });
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y - 24)).toBeLessThanOrEqual(1);
  const inner = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(Math.abs(box!.width - (inner.w - 48))).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - (inner.h - 48))).toBeLessThanOrEqual(1);
  await boardView(board, 'Week');

  // Quick add on today: the parser's tokens leave the title.
  const todaySec = daySection(board, today);
  await todaySec.getByRole('textbox', { name: `Add to ${formatDayLabel(today)}` }).fill('Lecture 5 notes #lecture ~1h @2221');
  await todaySec.getByRole('textbox', { name: `Add to ${formatDayLabel(today)}` }).press('Enter');
  const lecture = rowOf(todaySec, 'Lecture 5 notes');
  await expect(lecture).toBeVisible();
  await expect(lecture.locator('[role="button"]').first()).toHaveText('Lecture 5 notes');
  await expect(lecture).toContainText('0m / 1h');
  await expect(lecture.locator('[data-subject-dot]')).toHaveAttribute('title', AI);
  // Ruling: the board's compact row shows the dot and the estimate only; the tag is in main and on
  // the widget's full row.
  const lectureId = Number(await lecture.getAttribute('data-task-id'));
  const made = await taskOf(win, lectureId);
  expect({ title: made?.title, tags: made?.tags, est: made?.estimateMin, sub: made?.subjectId, day: made?.day }).toEqual({
    title: 'Lecture 5 notes',
    tags: ['lecture'],
    est: 60,
    sub: comp2221,
    day: today,
  });
  await calm(win);
  await shot(win, 'v12-board-week.png');

  // List → Thursday, with the real pointer: under Thursday, in main, and the list's subject copied.
  const lists = board.locator('section[aria-label="Lists"]');
  const aiSec = lists.locator(`section[aria-label="${AI}"]`);
  await grip(aiSec, 'Haskell folds practice').scrollIntoViewIfNeeded();
  const thuHead = daySection(board, thu).locator('header');
  const thuBox = await daySection(board, thu).boundingBox();
  const listGrip = grip(aiSec, 'Haskell folds practice');
  const gripBox = await listGrip.boundingBox();
  test.info().annotations.push({ type: 'list drag', description: `thu ${JSON.stringify(thuBox)} grip ${JSON.stringify(gripBox)}` });
  if (!thuBox || !gripBox) throw new Error('no Thursday or grip box');
  await pointerDrag(win, listGrip, { x: thuBox.x + thuBox.width / 2, y: thuBox.y + 70 }, 'v12-board-drag-list-to-day.png');
  await expect(rowOf(daySection(board, thu), 'Haskell folds practice')).toBeVisible();
  await expect.poll(async () => (await taskOf(win, haskell!))?.day).toBe(thu);
  const moved = await taskOf(win, haskell!);
  expect({ listId: moved?.listId, subjectId: moved?.subjectId }).toEqual({ listId: null, subjectId: comp2221 });
  await expect(thuHead).toBeVisible();

  // Day → day: Tuesday's task onto Wednesday.
  const wed = addDays(mon, 2);
  const wedBox = await daySection(board, wed).boundingBox();
  await pointerDrag(win, grip(daySection(board, addDays(mon, 1)), 'Network layer summary'), { x: wedBox!.x + wedBox!.width / 2, y: wedBox!.y + 90 });
  await expect.poll(async () => (await taskOf(win, dayDrag!))?.day).toBe(wed);
  await expect(rowOf(daySection(board, wed), 'Network layer summary')).toBeVisible();

  // Reorder within Monday: the second above the first. Only the pair is compared, because on a
  // Monday the quick-added "Lecture 5 notes" shares the day (any weekday passes).
  const pair = (titles: string[]) => titles.map((t) => t.trim()).filter((t) => t.startsWith('Reorder '));
  const firstBox = await rowOf(daySection(board, mon), 'Reorder first').boundingBox();
  await pointerDrag(win, grip(daySection(board, mon), 'Reorder second'), { x: firstBox!.x + firstBox!.width / 2, y: firstBox!.y + 3 });
  await expect.poll(async () => pair(await dayTitles(win, mon))).toEqual(['Reorder second', 'Reorder first']);
  const domOrder = await daySection(board, mon).locator('li[data-task-id] span[role="button"]').allInnerTexts();
  expect(pair(domOrder)).toEqual(['Reorder second', 'Reorder first']);

  // Released outside every column (over the board's header): nothing moves.
  const head = await board.getByRole('group', { name: 'Board view' }).boundingBox();
  await pointerDrag(win, grip(daySection(board, wed), 'Stays on Wednesday'), { x: head!.x - 140, y: head!.y + head!.height / 2 });
  await sleep(600);
  expect((await taskOf(win, miss!))?.day).toBe(wed);
  await expect(rowOf(daySection(board, wed), 'Stays on Wednesday')).toBeVisible();

  // Month, then Day.
  await boardView(board, 'Month');
  await expect(board.locator(`[data-month-cell="${today}"]`)).toContainText('Lecture 5 notes');
  await calm(win);
  await shot(win, 'v12-board-month.png');
  await boardView(board, 'Day');
  const todaySheet = board.locator(`section[data-today="true"][aria-label="${formatDayLabel(today)}"]`);
  await expect(rowOf(todaySheet, 'Lecture 5 notes')).toBeVisible();
  await calm(win);
  await shot(win, 'v12-board-day.png');

  // Delete from the detail menu asks first.
  await boardView(board, 'Week');
  await rowOf(daySection(board, wed), 'Stays on Wednesday').locator('[role="button"]').first().click();
  const detail = win.getByRole('dialog', { name: 'Task: Stays on Wednesday' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Task menu' }).click();
  await detail.getByRole('group', { name: 'Task actions' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(detail.getByText('Delete this task?')).toBeVisible();
  await detail.getByRole('group', { name: 'Task actions' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => taskOf(win, miss!)).toBeNull();
  await expect(board.locator('li[data-task-id]').filter({ hasText: 'Stays on Wednesday' })).toHaveCount(0);
  if (await detail.isVisible()) await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await expect(board).toBeHidden();

  // The widget's three views; the tag shows on the full row.
  const w = await openTasks(win, 'Day');
  await expect(rowOf(w, 'Lecture 5 notes')).toContainText('#lecture');
  await calm(win);
  await shot(win, 'v12-widget-day.png');
  await openTasks(win, 'Week');
  await expect(rowOf(daySection(w, today), 'Lecture 5 notes')).toBeVisible();
  await calm(win);
  await shot(win, 'v12-widget-week.png');
  await openTasks(win, 'Lists');
  await w.getByRole('combobox', { name: 'List', exact: true }).selectOption(String(aiList));
  await expect(rowOf(w, 'Type classes reading')).toBeVisible();
  await calm(win);
  await shot(win, 'v12-widget-lists.png');

  // Provenance on disk.
  expect(await quitApp(app)).toBe(0);
  expect(await queryDb(dataDir, `SELECT day, list_id, subject_id FROM tasks WHERE id = ${haskell}`)).toEqual([
    { day: thu, list_id: null, subject_id: comp2221 },
  ]);
  expect(await queryDb(dataDir, `SELECT count(*) AS n FROM tasks WHERE id = ${miss}`)).toEqual([{ n: 0 }]);
});

test('widget Week: a keyboard drag moves a task a day on; the placement picker moves one to a list', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const mon = weekStartOf(today);
  const [kb, picked] = await seed(win, [
    { title: 'Keyboard drag task', day: mon },
    { title: 'Picker move task', day: mon },
  ]);
  const inbox = await listId(win, 'Inbox');
  await reload(win);
  const w = await openTasks(win, 'Week');
  const monSec = daySection(w, mon);
  await expect(rowOf(monSec, 'Keyboard drag task')).toBeVisible();

  // Space picks up, each ArrowDown goes to the next place below (a row, then the next day), Space drops.
  const g = grip(monSec, 'Keyboard drag task');
  await g.focus();
  await win.keyboard.press('Space');
  await sleep(300);
  const before = await taskOf(win, kb!);
  // Monday holds two tasks: the first ArrowDown passes the one below it, the second reaches Tuesday.
  for (let i = 0; i < 2; i++) {
    await win.keyboard.press('ArrowDown');
    await sleep(300);
  }
  await win.keyboard.press('Space');
  await sleep(500);
  const after = await taskOf(win, kb!);
  test.info().annotations.push({ type: 'keyboard drag', description: `${before?.day} -> ${after?.day}` });
  expect(after?.day).toBe(addDays(mon, 1));
  await expect(rowOf(daySection(w, after!.day!), 'Keyboard drag task')).toBeVisible();
  await expect(monSec.locator('li[data-task-id]').filter({ hasText: 'Keyboard drag task' })).toHaveCount(0);

  // The placement picker: the keyboard alternative to dragging.
  await rowOf(monSec, 'Picker move task').getByRole('button', { name: 'Picker move task', exact: true }).click();
  const detail = win.getByRole('dialog', { name: 'Task: Picker move task' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: /^Placement: / }).click();
  await detail.getByRole('group', { name: 'Move task' }).getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect.poll(async () => (await taskOf(win, picked!))?.listId).toBe(inbox);
  expect((await taskOf(win, picked!))?.day).toBeNull();
  if (await detail.isVisible()) await win.keyboard.press('Escape');
  await expect(monSec.locator('li[data-task-id]').filter({ hasText: 'Picker move task' })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// 3. ▶ on a task, the intention and the outcome (AC 15, 19).

test('▶ starts focus on the task and its subject; the intention and Partly land on every row', async ({ launch, dataDir }) => {
  const { app, win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const comp2221 = await subjectId(win, 'COMP2221');
  const [id] = await seed(win, [{ title: 'Lecture 5 notes', day: today, estimateMin: 60, tags: ['lecture'], subjectId: comp2221 }]);
  await reload(win);
  const w = await openTasks(win, 'Day');
  const row = rowOf(w, 'Lecture 5 notes');
  await row.hover();
  await row.getByRole('button', { name: 'Start focus on "Lecture 5 notes"' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  const started = await win.evaluate(() => window.studyat.timer.get());
  expect({ mode: started.mode, subjectId: started.subjectId, taskId: started.taskId }).toEqual({ mode: 'focus', subjectId: comp2221, taskId: id });

  const field = win.getByRole('textbox', { name: 'What I will do this focus' });
  await field.fill('Finish the notes for lecture 5');
  await field.press('Enter');
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).intention).toBe('Finish the notes for lecture 5');

  await sleep(65_000);
  await widget(win, 'Timer').getByRole('button', { name: 'Skip', exact: true }).click();
  const ask = win.getByRole('group', { name: 'Did you do it?' });
  await expect(ask).toBeVisible();
  await calm(win);
  await shot(win, 'v12-outcome.png');
  const pomodoro = (await win.evaluate(() => window.studyat.timer.get())).askOutcome?.pomodoroId;
  expect(pomodoro).toBeTruthy();
  await ask.getByRole('button', { name: 'Partly', exact: true }).click();
  await expect(ask).toBeHidden();

  const rows = (await win.evaluate(() => window.studyat.stats.sessions())).filter((s) => s.pomodoroId === pomodoro);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect({ outcome: r.outcome, intention: r.intention, taskId: r.taskId }).toEqual({ outcome: 'partly', intention: 'Finish the notes for lecture 5', taskId: id });

  // The Stats sessions table: the intention and the Partly mark.
  await dock(win, 'Stats').click();
  const cell = win.locator('td').filter({ hasText: 'Finish the notes for lecture 5' }).first();
  await cell.scrollIntoViewIfNeeded();
  await expect(cell).toBeVisible();
  await expect(cell.getByLabel('Partly')).toHaveText('½');
  await shot(win, 'v12-outcome-stats.png');
  await win.keyboard.press('Escape');

  expect(await quitApp(app)).toBe(0);
  const disk = await queryDb(dataDir, `SELECT outcome, intention, task_id, subject_id FROM sessions WHERE pomodoro_id = '${pomodoro}'`);
  expect(disk.length).toBe(rows.length);
  for (const r of disk) expect(r).toEqual({ outcome: 'partly', intention: 'Finish the notes for lecture 5', task_id: id, subject_id: comp2221 });
});

// ---------------------------------------------------------------------------------------------
// 4, 5. Revision with the exam cap (AC 17) and repeat (AC 11).

test('revision: ticking a lecture task offers 1 · 3 · 7 · 21; Add respects the exam ten days out', async ({ launch, dataDir }) => {
  const { app, win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const comp2221 = await subjectId(win, 'COMP2221');
  const exam = addDays(today, 10);
  await win.evaluate(
    (d) => window.studyat.deadlines.create({ title: 'COMP2221 exam', kind: 'exam', subjectId: d.s, due: `${d.day}T09:00` }),
    { s: comp2221, day: exam },
  );
  const [id] = await seed(win, [{ title: 'Lecture 5 notes', day: today, estimateMin: 60, tags: ['lecture'], subjectId: comp2221 }]);
  await reload(win);
  const w = await openTasks(win, 'Day');
  await w.getByRole('checkbox', { name: 'Mark "Lecture 5 notes" as done' }).check();
  const bar = w.getByRole('group', { name: 'Schedule revision' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Schedule revision?');
  // The chips as drawn, separators included.
  await expect(bar.locator(':scope > div').first()).toHaveText('1 · 3 · 7 · 21 days', { useInnerText: true });
  for (const n of [1, 3, 7, 21]) {
    await expect(bar.getByRole('button', { name: `${n} ${n === 1 ? 'day' : 'days'}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await calm(win);
  await shot(win, 'v12-revision-bar.png');
  await bar.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(bar).toBeHidden();

  expect(await quitApp(app)).toBe(0);
  const made = await queryDb(
    dataDir,
    `SELECT t.title, t.day, t.kind, t.subject_id, t.origin_task_id, group_concat(g.tag) AS tags FROM tasks t
       LEFT JOIN task_tags g ON g.task_id = t.id WHERE t.kind = 'revision' GROUP BY t.id ORDER BY t.day`,
  );
  expect(made).toEqual(
    [1, 3, 7, 9].map((n) => ({
      title: 'Revise: Lecture 5 notes',
      day: addDays(today, n),
      kind: 'revision',
      subject_id: comp2221,
      origin_task_id: id,
      tags: 'revision',
    })),
  );
});

test('repeat: ticking a daily task today makes an unticked copy tomorrow', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const [id] = await seed(win, [{ title: 'Anki reviews', day: today, estimateMin: 15 }]);
  await win.evaluate((i) => window.studyat.tasks.update(i, { repeat: { kind: 'daily' } }), id!);
  await reload(win);
  const w = await openTasks(win, 'Day');
  await expect(rowOf(w, 'Anki reviews').getByLabel('Repeats')).toBeVisible();
  await w.getByRole('checkbox', { name: 'Mark "Anki reviews" as done' }).check();
  const tomorrow = addDays(today, 1);
  await expect
    .poll(async () => (await win.evaluate((d) => window.studyat.planner.day(d), tomorrow)).tasks.filter((t) => t.day === tomorrow && t.title === 'Anki reviews').map((t) => ({ done: t.done, est: t.estimateMin, repeat: t.repeat?.kind })))
    .toEqual([{ done: false, est: 15, repeat: 'daily' }]);
  expect((await taskOf(win, id!))?.done).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// 6. Roll forward (AC 12) and 7. a reminder (AC 13).

test('roll forward: off leaves yesterday alone; on, a relaunch moves the open task with "from"', async ({ launch, dataDir }) => {
  const first = await launch();
  await prepare(first.win);
  expect((await first.win.evaluate(() => window.studyat.settings.get())).rollTasksForward).toBe(false);
  const today = studyDay(Date.now());
  const yesterday = addDays(today, -1);
  const [open, done] = await seed(first.win, [
    { title: 'Unfinished past paper', day: yesterday },
    { title: 'Finished flashcards', day: yesterday },
  ]);
  await first.win.evaluate((i) => window.studyat.tasks.update(i, { done: true }), done!);
  expect(await quitApp(first.app)).toBe(0);

  const second = await launch(dataDir);
  let win = second.win;
  expect((await taskOf(win, open!))?.day).toBe(yesterday);
  await dock(win, 'Settings').click();
  await win.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const sw = win.getByRole('switch', { name: 'Move unfinished tasks to today' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.settings.get())).rollTasksForward).toBe(true);
  await win.keyboard.press('Escape');
  expect(await quitApp(second.app)).toBe(0);

  const third = await launch(dataDir);
  win = third.win;
  await expect.poll(async () => (await taskOf(win, open!))?.day).toBe(today);
  expect((await taskOf(win, open!))?.rolledFrom).toBe(yesterday);
  const stayed = await taskOf(win, done!);
  expect({ day: stayed?.day, done: stayed?.done, rolledFrom: stayed?.rolledFrom }).toEqual({ day: yesterday, done: true, rolledFrom: null });
  const w = await openTasks(win, 'Day');
  await expect(rowOf(w, 'Unfinished past paper')).toContainText(`from ${formatDayLabel(yesterday)}`);
  await calm(win);
  await shot(win, 'v12-rolled.png');
});

test('reminder: two minutes ahead, reminded_day is set within 2.5 min and main logs no error', async ({ launch, dataDir }) => {
  const { app, win, logs } = await launch();
  await prepare(win, { notifications: true });
  // Records what main would show, without putting a toast on the desktop (the toast is 👤).
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { shown: string[] };
    g.shown = [];
    Notification.prototype.show = function (this: Electron.Notification) {
      g.shown.push(this.title);
    };
  });
  const at = Date.now() + 120_000;
  const day = studyDay(at);
  const [id] = await seed(win, [{ title: 'Email supervisor about project scope', day }]);
  await win.evaluate(({ i, r }) => window.studyat.tasks.update(i, { reminder: r }), { i: id!, r: localParts(at).time });
  await expect
    .poll(async () => app.evaluate(() => (globalThis as unknown as { shown: string[] }).shown), { timeout: 150_000, intervals: [5_000] })
    .toEqual(['Reminder · Email supervisor about project scope']);
  test.info().annotations.push({ type: 'reminder', description: `due ${localParts(at).time}, fired ${new Date().toTimeString().slice(0, 8)}` });
  // Errors: an error line on main's stderr, any renderer console error or uncaught page error
  // ("[page #n error]"), and any line at all mentioning an uncaught throw or an exception.
  const errors = logs.filter(
    (l) => (/\[main #\d+ err\]/.test(l) && /error/i.test(l)) || /\[page #\d+ error\]/.test(l) || /Uncaught|Exception/.test(l),
  );
  expect(errors).toEqual([]);
  expect(await quitApp(app)).toBe(0);
  expect(await queryDb(dataDir, `SELECT reminded_day FROM tasks WHERE id = ${id}`)).toEqual([{ reminded_day: day }]);
});

// ---------------------------------------------------------------------------------------------
// The dispatcher's checks on the pop-up fixes (def0121).

test('list menus: left-most and right edge open whole inside the board; Tab and Shift+Tab return to ⋯; scrolled away closes', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const board = await openBoard(win);
  await boardView(board, 'Week');
  const row = board.locator('[data-list-row]');
  await row.scrollIntoViewIfNeeded();
  const dialogBox = (await board.boundingBox())!;
  const inside = async (panel: Locator): Promise<void> => {
    const p = await panel.boundingBox();
    expect(p).not.toBeNull();
    expect(p!.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(p!.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(p!.x + p!.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 0.5);
    expect(p!.y + p!.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 0.5);
    // Not covered: the middle of the panel is the panel.
    const hit = await win.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[aria-label="List actions"]'), { x: p!.x + p!.width / 2, y: p!.y + p!.height / 2 });
    expect(hit).toBe(true);
  };

  // Left-most: Inbox.
  const inboxMenu = board.getByRole('button', { name: 'Inbox menu' });
  await inboxMenu.click();
  const panel = win.getByRole('group', { name: 'List actions' });
  await expect(panel.getByRole('button', { name: 'Rename' })).toBeFocused();
  await sleep(200);
  await inside(panel);
  await shot(win, 't35-1-list-menu-leftmost.png');
  // Shift+Tab off the first item: closed, focus on ⋯.
  await win.keyboard.press('Shift+Tab');
  await expect(panel).toHaveCount(0);
  await expect(inboxMenu).toBeFocused();
  // Tab off the last item: closed, focus on ⋯.
  await inboxMenu.press('Enter');
  await expect(panel.getByRole('button', { name: 'Rename' })).toBeFocused();
  await panel.getByRole('button', { name: 'Delete', exact: true }).focus();
  await win.keyboard.press('Tab');
  await expect(panel).toHaveCount(0);
  await expect(inboxMenu).toBeFocused();

  // Right edge: the last list, Link subject.
  const last = SEED_SUBJECTS[SEED_SUBJECTS.length - 1]!.name;
  const lastMenu = board.getByRole('button', { name: `${last} menu` });
  await lastMenu.scrollIntoViewIfNeeded();
  await sleep(300);
  await lastMenu.click();
  await panel.getByRole('button', { name: 'Link subject' }).click();
  await expect(panel.getByRole('button', { name: 'None', exact: true })).toBeVisible();
  await sleep(200);
  await inside(panel);
  await shot(win, 't35-1-list-menu-right-link-subject.png');
  await win.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Scrolled until ⋯ leaves the view: the menu closes.
  await lastMenu.click();
  await expect(panel).toBeVisible();
  const lb = (await lastMenu.boundingBox())!;
  await win.mouse.move(lb.x - 200, lb.y + 120);
  const scroller = await row.evaluate((el) => {
    // The scrolling ancestor of the row (or the row itself) and which way it scrolls.
    let n: HTMLElement | null = el as HTMLElement;
    while (n) {
      const cs = getComputedStyle(n);
      if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(cs.overflowX)) return 'x';
      if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(cs.overflowY)) return 'y';
      n = n.parentElement;
    }
    return 'none';
  });
  test.info().annotations.push({ type: 'list row scrolls', description: scroller });
  for (let i = 0; i < 12 && (await panel.count()) > 0; i++) {
    await win.mouse.wheel(scroller === 'x' ? -400 : 0, scroller === 'x' ? 0 : -300);
    await sleep(250);
  }
  await expect(panel).toHaveCount(0);
  await shot(win, 't35-2-list-menu-scrolled-away.png');
});

test('board row tools: after a title click and a mouse close, hover shows ▶ and it starts focus; Tab to a title hides the pill', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const comp2221 = await subjectId(win, 'COMP2221');
  const [id] = await seed(win, [
    { title: 'Lab 4 write-up', day: today, estimateMin: 60, subjectId: comp2221 },
    { title: 'Plan next week', day: today, estimateMin: 15 },
  ]);
  await reload(win);
  const board = await openBoard(win);
  await boardView(board, 'Week');
  const row = rowOf(daySection(board, today), 'Lab 4 write-up');
  const pillOf = (r: Locator) => r.locator('button[aria-label^="Start focus on"]').locator('xpath=..');
  const opacity = (l: Locator) => l.evaluate((n) => Number(getComputedStyle(n).opacity));

  // A click on the title opens its detail; the detail's Close, clicked with the mouse, shuts it.
  await row.locator('span[role="button"]').first().click();
  const detail = win.getByRole('dialog', { name: 'Task: Lab 4 write-up' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(detail).toBeHidden();
  await expect(board).toBeVisible();
  const afterClose = await row.evaluate((li) => ({
    titleFocus: li.getAttribute('data-title-focus'),
    focusInRow: li.contains(document.activeElement),
    focusVisible: !!document.activeElement?.matches(':focus-visible'),
  }));
  test.info().annotations.push({ type: 'after mouse close', description: JSON.stringify(afterClose) });
  expect(afterClose.titleFocus).toBeNull();

  // Hovered: the pill shows, and ▶ starts focus on the task and its subject.
  await row.hover();
  await sleep(300);
  expect(await opacity(pillOf(row))).toBe(1);
  const play = row.getByRole('button', { name: 'Start focus on "Lab 4 write-up"', exact: true });
  await expect(play).toBeVisible();
  await shot(win, 't35-6-row-hover-after-mouse-close.png');
  await play.click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  const started = await win.evaluate(() => window.studyat.timer.get());
  expect({ mode: started.mode, taskId: started.taskId, subjectId: started.subjectId }).toEqual({ mode: 'focus', taskId: id, subjectId: comp2221 });
  // Provenance: main wrote the focus session's row at its start (study-dev rule 2).
  await expect
    .poll(async () => (await win.evaluate(() => window.studyat.stats.sessions())).filter((s) => s.taskId === id).map((s) => s.subjectId))
    .toEqual([comp2221]);
  await win.evaluate(() => window.studyat.timer.reset());
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).not.toBe('running');

  // Tab to a title: its keyboard ring is whole, so the pill is hidden, hovered or not.
  await win.keyboard.press('Escape');
  await expect(board).toBeHidden();
  const board2 = await openBoard(win);
  await boardView(board2, 'Week');
  const row2 = rowOf(daySection(board2, today), 'Plan next week');
  await calm(win);
  await row2.getByRole('checkbox').focus();
  await win.keyboard.press('Tab');
  await expect(row2.locator('span[role="button"]').first()).toBeFocused();
  await expect(row2).toHaveAttribute('data-title-focus', 'true');
  await sleep(300);
  expect(await opacity(pillOf(row2))).toBe(0);
  await row2.hover();
  await sleep(300);
  expect(await opacity(pillOf(row2))).toBe(0);
  await shot(win, 't35-6-title-tab-focus.png');
});

test('board list menu: scrolling its ⋯ under the board header closes it', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  // Rows in the Inbox lengthen the list row past the body's height, so the body can scroll its ⋯
  // under the header.
  const inbox = await listId(win, 'Inbox');
  await seed(win, Array.from({ length: 28 },(_, i) => ({ title: `Inbox item ${i + 1}`, listId: inbox })));
  await reload(win);
  const board = await openBoard(win);
  await boardView(board, 'Week');
  const trigger = board.getByRole('button', { name: 'Inbox menu' });
  // The board's body is the list row's vertically scrolling ancestor; its header sits above it.
  const geo = () => trigger.evaluate((t) => {
    let b = t.closest('[data-list-row]')!.parentElement;
    while (b && !/auto|scroll/.test(getComputedStyle(b).overflowY)) b = b.parentElement;
    const head = document.querySelector('[role="group"][aria-label="Board view"]')!.parentElement!;
    const tr = t.getBoundingClientRect();
    return {
      trigger: { top: tr.top, bottom: tr.bottom },
      bodyTop: b!.getBoundingClientRect().top,
      headBottom: head.getBoundingClientRect().bottom,
      scrollTop: b!.scrollTop,
      max: b!.scrollHeight - b!.clientHeight,
    };
  });
  // ⋯ 40 px below the body's top, then its menu opened.
  await trigger.evaluate((t) => {
    let b = t.closest('[data-list-row]')!.parentElement;
    while (b && !/auto|scroll/.test(getComputedStyle(b).overflowY)) b = b.parentElement;
    b!.scrollTop += t.getBoundingClientRect().top - b!.getBoundingClientRect().top - 40;
  });
  await sleep(300);
  const before = await geo();
  test.info().annotations.push({ type: 'before', description: JSON.stringify(before) });
  expect(before.trigger.top).toBeGreaterThan(before.bodyTop);
  expect(before.max - before.scrollTop, 'the body can scroll ⋯ under the header').toBeGreaterThan(before.trigger.bottom - before.bodyTop);
  await trigger.click();
  const panel = win.getByRole('group', { name: 'List actions' });
  await expect(panel).toBeVisible();
  await shot(win, 't35-7-list-menu-open.png');

  // The wheel over the week, not the panel, scrolls the body until ⋯ is under the header.
  const bb = (await board.boundingBox())!;
  await win.mouse.move(bb.x + bb.width - 160, before.bodyTop + 20);
  for (let i = 0; i < 12 && (await panel.count()) > 0; i++) {
    await win.mouse.wheel(0, 40);
    await sleep(250);
  }
  const after = await geo();
  test.info().annotations.push({ type: 'after', description: JSON.stringify(after) });
  expect(after.scrollTop).toBeGreaterThan(before.scrollTop);
  expect(after.trigger.top).toBeLessThan(after.bodyTop);
  await expect(panel).toHaveCount(0);
  await shot(win, 't35-7-list-menu-under-header.png');
});

test('deadlines: deleted or marked done in the widget, they leave the open board, chips and exam line', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const comp2221 = await subjectId(win, 'COMP2221');
  const aiList = (await win.evaluate(() => window.studyat.planner.lists())).lists.find((l) => l.subjectId === comp2221);
  if (!aiList) throw new Error('no COMP2221 list');
  // Tomorrow by the calendar, so every due time is ahead of now whatever the hour (rollover too).
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const date = localParts(t.getTime()).date;
  const day = studyDay(new Date(`${date}T12:00`).getTime());
  const made = await win.evaluate(
    async (d) => [
      await window.studyat.deadlines.create({ title: 'COMP2221 mock exam', kind: 'exam', subjectId: d.s, due: `${d.date}T10:00` }),
      await window.studyat.deadlines.create({ title: 'COMP2221 class test', kind: 'exam', subjectId: d.s, due: `${d.date}T14:00` }),
      await window.studyat.deadlines.create({ title: 'Stays: essay plan', kind: 'coursework', subjectId: null, due: `${d.date}T16:00` }),
    ],
    { s: comp2221, date },
  );
  expect(made).toHaveLength(3);
  await reload(win);
  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Widgets/ }).first().click();
  const sw = win.getByRole('dialog', { name: 'Widgets' }).getByRole('switch', { name: 'Deadlines', exact: true });
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await win.keyboard.press('Escape');
  await expect(win.getByRole('dialog', { name: 'Widgets' })).toBeHidden();
  const dw = widget(win, 'Deadlines');
  await expect(dw.locator('li').filter({ hasText: 'COMP2221 class test' })).toBeVisible();

  const board = await openBoard(win);
  await boardView(board, 'Week');
  if (weekStartOf(day) !== weekStartOf(studyDay(Date.now()))) await board.getByRole('button', { name: 'Next week' }).click();
  const head = daySection(board, day).locator('header');
  const card = board.locator(`section[aria-label="${aiList.name}"]`);
  for (const title of ['COMP2221 mock exam', 'COMP2221 class test', 'Stays: essay plan']) await expect(head).toContainText(title);
  await expect(card).toContainText('Exam in 1 day');
  await shot(win, 'f3-deadlines-board-before.png');

  // The board's scrim covers the widgets, so the widget's buttons get DOM clicks in the page; the
  // board stays open throughout, so whatever clears it is the widget's refresh, not a reopen.
  const hit = await dw.evaluate((n) => {
    const r = n.getBoundingClientRect();
    return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  test.info().annotations.push({ type: 'widget under the board', description: `hit-test reaches the widget: ${hit}` });
  const press = async (l: Locator): Promise<void> => {
    await expect(l).toHaveCount(1);
    await l.dispatchEvent('click');
  };
  const dRow = (title: string) => dw.locator('li').filter({ hasText: title }).getByRole('button').first();

  // Delete the earlier exam: its chip goes; the later exam keeps the line.
  await press(dRow('COMP2221 mock exam'));
  await press(dw.getByRole('button', { name: 'Delete', exact: true }));
  await press(dw.getByRole('group', { name: 'Confirm delete' }).getByRole('button', { name: 'Yes, delete' }));
  await expect(dw.getByRole('form')).toHaveCount(0);
  await expect(head).not.toContainText('COMP2221 mock exam');
  await expect(head).toContainText('COMP2221 class test');
  await expect(card).toContainText('Exam in 1 day');

  // Mark the other exam done: its chip and the exam line go; the coursework chip stays.
  await press(dRow('COMP2221 class test'));
  await press(dw.getByRole('button', { name: 'Mark done', exact: true }));
  await expect(dw.getByRole('form')).toHaveCount(0);
  await expect(head).not.toContainText('COMP2221 class test');
  await expect(card).not.toContainText(/Exam (in \d+ days?|today)/);
  await expect(head).toContainText('Stays: essay plan');
  await expect(board).toBeVisible();
  await shot(win, 'f3-deadlines-board-after.png');

  // Provenance: main holds the delete and the done.
  const all = await win.evaluate(async () => [
    ...(await window.studyat.deadlines.list({ past: false })),
    ...(await window.studyat.deadlines.list({ past: true })),
  ]);
  const byTitle = (title: string) => all.filter((d) => d.title === title);
  test.info().annotations.push({ type: 'main after', description: JSON.stringify(all.map((d) => [d.title, d.done])) });
  expect(byTitle('COMP2221 mock exam')).toHaveLength(0);
  expect(byTitle('COMP2221 class test').length).toBeGreaterThan(0);
  expect(byTitle('COMP2221 class test').every((d) => d.done)).toBe(true);
  expect(byTitle('Stays: essay plan').some((d) => !d.done)).toBe(true);
});

test('pop-ups over another widget: the timer task picker and the stats menu are opaque and on top', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  await seed(win, ['Lecture 5 notes', 'Problem sheet 5', 'Lab 4 write-up', 'Read chapter 3'].map((title) => ({ title, day: today })));
  // Two stats cards, the first under the timer's picker and the second under the first's ⋯.
  const timerBox = (await widget(win, 'Timer').boundingBox())!;
  const ids = await win.evaluate(async () => [(await window.studyat.statWidgets.add()).id, (await window.studyat.statWidgets.add()).id]);
  await win.evaluate(
    ({ ids, a, b }) => Promise.all([window.studyat.statWidgets.update(ids[0]!, a), window.studyat.statWidgets.update(ids[1]!, b)]),
    {
      ids,
      a: { x: (timerBox.x + timerBox.width / 2) / 1280, y: Math.min(0.7, (timerBox.y + timerBox.height - 40) / 800) },
      b: { x: (timerBox.x + timerBox.width / 2 + 60) / 1280, y: Math.min(0.85, (timerBox.y + timerBox.height + 60) / 800) },
    },
  );
  await reload(win);

  // Settled (any opening fade done), then: its own colour, whether it is the top element, and the
  // product of its and its ancestors' opacity (an opacity under 1 shows what is behind through it).
  const opaque = async (el: Locator): Promise<{ bg: string; filter: string; top: boolean; opacity: number; faded: string[] }> => {
    await sleep(600);
    return el.evaluate((n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height - 6);
      let opacity = 1;
      const faded: string[] = [];
      for (let a: Element | null = n; a; a = a.parentElement) {
        const o = parseFloat(getComputedStyle(a).opacity);
        if (o < 1) faded.push(`${a.tagName.toLowerCase()}.${(a.getAttribute('class') ?? '').split(' ')[0]}=${o}`);
        opacity *= o;
      }
      return { bg: cs.backgroundColor, filter: cs.backdropFilter, top: !!hit && n.contains(hit), opacity, faded };
    });
  };
  const solid = (bg: string) => /^rgb\(/.test(bg) || /^rgba\(.*,\s*1\)$/.test(bg);

  const combo = widget(win, 'Timer').getByRole('combobox', { name: 'Task' });
  await combo.click();
  const list = win.getByRole('listbox', { name: 'Task' });
  await expect(list).toBeVisible();
  const panel = list.locator('xpath=..');
  const p1 = await opaque(panel);
  test.info().annotations.push({ type: 'picker', description: JSON.stringify(p1) });
  await shot(win, 't35-3-timer-picker-over-stats.png');
  expect(solid(p1.bg), p1.bg).toBe(true);
  expect(p1.top).toBe(true);
  expect(p1.opacity, JSON.stringify(p1.faded)).toBe(1);
  await win.keyboard.press('Escape');

  // The first card sits under the timer, so its ⋯ is reached by the keyboard (task-34 Ruling 7).
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await calm(win);
  const cards = win.locator('[role="group"]').filter({ has: win.getByRole('button', { name: 'Stats widget menu' }) });
  await cards.first().getByRole('button', { name: 'Stats widget menu' }).focus();
  await win.keyboard.press('Enter');
  const menu = win.getByRole('menu', { name: 'Stats widget' });
  await expect(menu).toBeVisible();
  const p2 = await opaque(menu);
  test.info().annotations.push({ type: 'stats menu', description: JSON.stringify(p2) });
  await shot(win, 't35-3-stats-menu-over-stats.png');
  expect(solid(p2.bg), p2.bg).toBe(true);
  expect(p2.top).toBe(true);
  expect(p2.opacity, JSON.stringify(p2.faded)).toBe(1);
  await win.keyboard.press('Escape');
});

test('Week tab with tasks before today opens with today flush at the top, and keeps it until the user scrolls', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const today = studyDay(Date.now());
  const mon = weekStartOf(today);
  const before: Seed[] = [];
  for (let d = mon; d < today; d = addDays(d, 1)) {
    for (let i = 1; i <= 4; i++) before.push({ title: `Earlier task ${i} for ${formatDayLabel(d)}`, day: d });
  }
  await seed(win, before);
  test.skip(before.length === 0, 'today is a Monday: no days before it this week');
  await reload(win);
  const w = await openTasks(win, 'Week');
  const opened = Date.now();
  const at = async (ms: number): Promise<void> => sleep(Math.max(0, opened + ms - Date.now()));
  const scroller = w.locator('section[aria-label="Week"] > div').last();
  // Today's section against the week's own scroller, the scroller's state, and the spacer after
  // Sunday with what lies between the last day's bottom and the content's end. The widget renders
  // through `transform: scale(s)` (WidgetFrame), so a rect is in screen px and scrollTop in CSS px:
  // every rect distance is divided by `scale` (the rect's height over the layout height) to compare
  // like with like; `gapScreen` is the same distance as it shows on screen.
  const measure = () => scroller.evaluate((n, day) => {
    const s = n.querySelector<HTMLElement>(`section[aria-label="${day}"]`);
    const box = n.getBoundingClientRect();
    const scale = box.height / (n as HTMLElement).offsetHeight;
    const spacer = n.lastElementChild as HTMLElement;
    const last = spacer.previousElementSibling as HTMLElement;
    const padBottom = parseFloat(getComputedStyle(n).paddingBottom) || 0;
    const gapScreen = s ? s.getBoundingClientRect().top - box.top : null;
    return {
      scale: Math.round(scale * 1000) / 1000,
      gap: gapScreen === null ? null : gapScreen / scale,
      gapScreen,
      pad: parseFloat(getComputedStyle(n).paddingTop) || 0,
      scrollTop: n.scrollTop,
      max: n.scrollHeight - n.clientHeight,
      spacer: spacer.offsetHeight,
      // Content past the last day (beyond the scroller's own bottom padding): 0 when no blank space.
      tail: n.scrollHeight - ((last.getBoundingClientRect().bottom - box.top) / scale + n.scrollTop) - padBottom,
      first: n.querySelector('section')?.getAttribute('aria-label') ?? null,
    };
  }, formatDayLabel(today));
  // Flush: today's top within 2 px of the scroller's top as it shows on screen (the unit the
  // earlier rounds measured in); the CSS px distance is in the annotation.
  const flush = (m: Awaited<ReturnType<typeof measure>>) => {
    expect(m.gapScreen, JSON.stringify(m)).not.toBeNull();
    expect(Math.abs(m.gapScreen! - m.pad * m.scale), JSON.stringify(m)).toBeLessThanOrEqual(2);
  };

  // Flush at 0.8 s and at 3 s after opening: once the week's tasks have drawn, and once they settle.
  await at(800);
  const early = await measure();
  await at(3_000);
  const settled = await measure();
  test.info().annotations.push({ type: 'today at 0.8 s / 3 s', description: `${JSON.stringify(early)} then ${JSON.stringify(settled)}` });
  await calm(win);
  await shot(win, 't35-5-week-tab-today-top.png');
  expect(settled.scrollTop).toBeGreaterThan(0);
  flush(early);
  flush(settled);

  // Next week holds no today: no blank space after Sunday.
  await w.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(scroller.locator(`section[aria-label="${formatDayLabel(addDays(mon, 7))}"]`)).toBeVisible();
  await sleep(800);
  const next = await measure();
  test.info().annotations.push({ type: 'next week', description: JSON.stringify(next) });
  expect(next.spacer, JSON.stringify(next)).toBe(0);
  expect(Math.abs(next.tail), JSON.stringify(next)).toBeLessThanOrEqual(1);

  // Back on this week: flush again.
  await w.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(scroller.locator(`section[aria-label="${formatDayLabel(today)}"]`)).toBeVisible();
  await sleep(800);
  const back = await measure();
  await sleep(1_500);
  const backSettled = await measure();
  test.info().annotations.push({ type: 'back on this week', description: `${JSON.stringify(back)} then ${JSON.stringify(backSettled)}` });
  flush(back);
  flush(backSettled);

  // A wheel up inside the widget hands the week to the user: it does not snap back to today.
  const sb = (await scroller.boundingBox())!;
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.wheel(0, -200);
  await sleep(400);
  const wheeled = await measure();
  await sleep(2_000);
  const later = await measure();
  test.info().annotations.push({ type: 'after wheel up', description: `${JSON.stringify(wheeled)} then ${JSON.stringify(later)}` });
  expect(wheeled.scrollTop, JSON.stringify(wheeled)).toBeLessThan(backSettled.scrollTop - 50);
  expect(Math.abs(later.scrollTop - wheeled.scrollTop), JSON.stringify(later)).toBeLessThanOrEqual(1);
  expect(later.gap!, JSON.stringify(later)).toBeGreaterThan(later.pad + 50);
});

test('a playing 4K YouTube space switched to Auto: the badge changes promptly', async ({ launch }) => {
  const up = await fetch('https://www.youtube.com/', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  test.skip(!up, 'network is down');
  const { app, win } = await launch();
  await prepare(win);
  const dpr = await win.evaluate(() => window.devicePixelRatio);
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.webContents.getURL().includes('mini'));
    w?.setContentSize(size.width, size.height);
  }, { width: Math.round(1920 / dpr), height: Math.round(1080 / dpr) });
  await win.keyboard.press('g');
  await win.getByRole('textbox', { name: 'YouTube link' }).fill(`https://www.youtube.com/watch?v=${VIDEO_4K}`);
  await win.getByRole('button', { name: 'Add YouTube' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.spaces.list())).some((s) => s.source === VIDEO_4K)).toBe(true);
  const space = (await win.evaluate(() => window.studyat.spaces.list())).find((s) => s.source === VIDEO_4K)!;
  if ((await win.evaluate(() => window.studyat.settings.get())).activeSpaceId !== space.id) {
    await win.getByRole('button', { name: `Use ${space.name}`, exact: true }).click();
  }
  await win.getByRole('button', { name: `Menu for ${space.name}`, exact: true }).click();
  await win.getByRole('menuitem', { name: 'Settings' }).click();
  const quality = win.locator(`section[aria-label="Settings for ${space.name}"]`).getByRole('group', { name: 'Quality' });
  await quality.getByRole('button', { name: '4K', exact: true }).click();
  const badge = quality.getByRole('status', { name: 'Playing quality' });
  await expect(badge).toHaveText(/^Playing · (2160p|4K\+)$/, { timeout: 90_000 });
  await shot(win, 't35-4-quality-4k.png');
  await quality.getByRole('button', { name: 'Auto', exact: true }).click();
  const t0 = Date.now();
  await expect(badge).not.toHaveText(/^Playing · (2160p|4K\+|1440p)$/, { timeout: 10_000 });
  const samples: string[] = [`${Date.now() - t0} ms: ${(await badge.innerText()).trim()}`];
  for (let i = 0; i < 5; i++) {
    await sleep(2_000);
    samples.push((await badge.innerText()).trim());
  }
  test.info().annotations.push({ type: 'auto after 4K', description: samples.join(', ') });
  await shot(win, 't35-4-quality-auto.png');
  for (const s of samples.slice(1)) expect(s).not.toMatch(/2160p|4K\+|1440p/);
});
