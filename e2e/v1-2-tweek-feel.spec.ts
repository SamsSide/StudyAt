// v1.2 end to end, "Tweek board feel" (spec 2026-11-12-tweek-board-feel §9, AC 1–7, 10–12, 14): a task
// drags by its whole line (board and widget), one click opens the quick card (Expand: the full
// detail), and a click on any blank board line types a task. Every test launches the BUILT app on a
// throwaway STUDYAT_USER_DATA (the fixtures); the input is Playwright's own page.mouse and keyboard
// against the test window, nothing at OS level. Screenshots go to STUDYAT_SHOTS_DIR when it is set.
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, dayKeyOf, weekStartOf } from '../src/core/time';
import { formatDayLabel } from '../src/renderer/stats/format';
import { expect, prepare, shot, sleep, test, VIEW } from './fixtures';

const ROLLOVER = 4;
const studyDay = (ms: number): string => dayKeyOf(ms, ROLLOVER);

const dock = (win: Page, label: string) =>
  win.locator('nav[aria-label="Dock"]').getByRole('button', { name: new RegExp(`^${label}`) }).first();
const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();
const boardOf = (win: Page) => win.getByRole('dialog', { name: 'Tasks' });
const daySection = (scope: Locator, day: string) => scope.locator(`section[aria-label="${formatDayLabel(day)}"]`);
const rowOf = (scope: Locator, title: string) => scope.locator('li[data-task-id]').filter({ hasText: title }).first();
/** The row's title text: the thing a drag now starts from (not the grip). */
const titleOf = (scope: Locator, title: string) => rowOf(scope, title).locator('span[role="button"]').first();
const addLine = (scope: Locator) => scope.getByRole('textbox', { name: /^Add to / }).first();
const listColumn = (board: Locator, name: string) => board.locator('section[aria-label="Lists"]').locator(`section[aria-label="${name}"]`);

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

async function openTasks(win: Page, tab: 'Day' | 'Week' | 'Lists'): Promise<Locator> {
  const w = widget(win, 'Tasks');
  if (!(await w.isVisible())) await dock(win, 'Tasks').click();
  await expect(w).toBeVisible();
  const t = w.getByRole('tablist', { name: 'Tasks view' }).getByRole('tab', { name: tab, exact: true });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
  return w;
}

async function calm(win: Page): Promise<void> {
  await win.mouse.move(640, 790);
  await sleep(400);
}

/** A real-pointer drag from the centre of the row's title text (no grip): a nudge past the 6 px
 *  activation distance, then on to the point in steps, a settle, an optional shot, and release. */
async function dragByTitle(win: Page, title: Locator, to: { x: number; y: number }, mid?: string): Promise<void> {
  await title.scrollIntoViewIfNeeded();
  const t = await title.boundingBox();
  if (!t) throw new Error('no title box');
  const x = t.x + t.width / 2;
  const y = t.y + t.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 8, y + 8, { steps: 4 });
  await win.mouse.move(to.x, to.y, { steps: 20 });
  await sleep(400);
  if (mid) await shot(win, mid);
  await win.mouse.up();
  await sleep(500);
}

const centreOf = async (loc: Locator, dy = 70): Promise<{ x: number; y: number }> => {
  const b = await loc.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + dy };
};

interface Seed {
  title: string;
  day?: string;
  listId?: number;
  estimateMin?: number;
  tags?: string[];
}

async function seed(win: Page, tasks: Seed[]): Promise<number[]> {
  return win.evaluate(async (list) => {
    const ids: number[] = [];
    for (const t of list) ids.push((await window.studyat.tasks.create(t)).tasks[0]!.id);
    return ids;
  }, tasks);
}

async function listId(win: Page, name: string): Promise<number> {
  const l = (await win.evaluate(() => window.studyat.planner.lists())).lists.find((x) => x.name.startsWith(name));
  if (!l) throw new Error(`no list ${name}`);
  return l.id;
}

const taskOf = (win: Page, id: number) => win.evaluate((i) => window.studyat.planner.task(i), id);

async function dayTitles(win: Page, day: string): Promise<string[]> {
  const r = await win.evaluate((d) => window.studyat.planner.day(d), day);
  return r.tasks.filter((t) => t.day === day && !t.done).map((t) => t.title);
}

async function listTitles(win: Page, id: number): Promise<string[]> {
  const r = await win.evaluate(() => window.studyat.planner.lists());
  return r.tasks.filter((t) => t.listId === id && !t.done).map((t) => t.title);
}

const week = () => {
  const mon = weekStartOf(studyDay(Date.now()));
  return { mon, tue: addDays(mon, 1), wed: addDays(mon, 2), thu: addDays(mon, 3), fri: addDays(mon, 4) };
};

// ---------------------------------------------------------------------------------------------
// 1, 2. Drag by the line on the board (AC 1, 3).

test('board: a task drags by its title, day to day, to the Inbox and back to a day', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const { mon, thu, fri } = week();
  const [id] = await seed(win, [{ title: 'Drag me', day: mon }]);
  await reload(win);
  const board = await openBoard(win);
  await expect(rowOf(daySection(board, mon), 'Drag me')).toBeVisible();

  // Provenance of "by the line": the pointer starts on the title text, not the clipped grip.
  const grip = rowOf(daySection(board, mon), 'Drag me').getByRole('button', { name: 'Move "Drag me"' });
  const titleBox = await titleOf(daySection(board, mon), 'Drag me').boundingBox();
  const gripBox = await grip.boundingBox();
  test.info().annotations.push({ type: 'boxes', description: `title ${JSON.stringify(titleBox)} grip ${JSON.stringify(gripBox)}` });

  await dragByTitle(win, titleOf(daySection(board, mon), 'Drag me'), await centreOf(daySection(board, thu)), '04-drag-mid.png');
  await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(thu);
  expect(await dayTitles(win, thu)).toContain('Drag me');
  expect(await dayTitles(win, mon)).not.toContain('Drag me');
  await expect(rowOf(daySection(board, thu), 'Drag me')).toBeVisible();
  await expect(win.getByRole('dialog', { name: 'Task: Drag me' })).toBeHidden();

  // Thursday -> the Inbox list.
  const inbox = await listId(win, 'Inbox');
  const inboxCol = listColumn(board, 'Inbox');
  await inboxCol.scrollIntoViewIfNeeded();
  await dragByTitle(win, titleOf(daySection(board, thu), 'Drag me'), await centreOf(inboxCol, 40));
  await expect.poll(async () => (await taskOf(win, id!))?.listId).toBe(inbox);
  expect((await taskOf(win, id!))?.day).toBeNull();
  await expect(rowOf(inboxCol, 'Drag me')).toBeVisible();

  // The Inbox -> Friday.
  await daySection(board, fri).scrollIntoViewIfNeeded();
  await dragByTitle(win, titleOf(inboxCol, 'Drag me'), await centreOf(daySection(board, fri)));
  await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(fri);
  expect((await taskOf(win, id!))?.listId).toBeNull();
  expect(await dayTitles(win, fri)).toContain('Drag me');
});

// ---------------------------------------------------------------------------------------------
// 3. The widget's Week (AC 2).

test('widget Week: a task drags by its title to the next day; a click opens the card', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  // From today on: the widget's Week scrolls past days out of reach (Sunday has no day after, so it drags the other way).
  const today = studyDay(Date.now());
  const wedAfter = addDays(today, 1);
  const sameWeek = weekStartOf(wedAfter) === weekStartOf(today);
  const tue = today;
  const wed = sameWeek ? wedAfter : addDays(today, -1);
  const [id] = await seed(win, [{ title: 'Widget drag', day: tue }]);
  await reload(win);
  const w = await openTasks(win, 'Week');
  await expect(rowOf(daySection(w, tue), 'Widget drag')).toBeVisible();
  const wedBox = await daySection(w, wed).boundingBox();
  if (!wedBox) throw new Error('no target day box');
  await dragByTitle(win, rowOf(daySection(w, tue), 'Widget drag').getByRole('button', { name: 'Widget drag', exact: true }), { x: wedBox.x + wedBox.width / 2, y: wedBox.y + Math.min(30, wedBox.height / 2) });
  await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(wed);
  await expect(rowOf(daySection(w, wed), 'Widget drag')).toBeVisible();
  await expect(win.getByRole('dialog', { name: 'Task: Widget drag' })).toBeHidden();

  // 09: a click on the widget row opens the same quick card.
  await sleep(400);
  await rowOf(daySection(w, wed), 'Widget drag').getByRole('button', { name: 'Widget drag', exact: true }).click();
  const card = win.getByRole('dialog', { name: 'Task: Widget drag' });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-mode', 'card');
  await shot(win, '09-widget-card.png');
});

// ---------------------------------------------------------------------------------------------
// 4. No card after a drag (AC 4); a reorder does not focus the add line.

test('a drag released in its own column opens no card and does not focus the add line', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const { mon } = week();
  const [a, b] = await seed(win, [
    { title: 'Stay A', day: mon },
    { title: 'Stay B', day: mon },
  ]);
  await reload(win);
  const board = await openBoard(win);
  const col = daySection(board, mon);
  await expect(rowOf(col, 'Stay A')).toBeVisible();
  const t = (await titleOf(col, 'Stay A').boundingBox())!;
  await dragByTitle(win, titleOf(col, 'Stay A'), { x: t.x + t.width / 2, y: t.y + t.height / 2 + 40 });
  await sleep(500);
  await expect(win.getByRole('dialog', { name: /^Task: / })).toBeHidden();
  const focused = await win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? '', label: el?.getAttribute('aria-label') ?? '' };
  });
  test.info().annotations.push({ type: 'focus after reorder', description: JSON.stringify(focused) });
  expect(focused.label.startsWith('Add to')).toBe(false);
  await expect(addLine(col)).not.toBeFocused();
  test.info().annotations.push({ type: 'order after', description: (await dayTitles(win, mon)).join(',') });
  expect([(await taskOf(win, a!))?.day, (await taskOf(win, b!))?.day]).toEqual([mon, mon]);
});

// ---------------------------------------------------------------------------------------------
// 5. The quick card (AC 6, 7, 10).

test('a click opens the quick card 72 px down and centred; note and tag persist; Expand shows the full detail', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const { wed } = week();
  const [id] = await seed(win, [{ title: 'Card task', day: wed }]);
  await reload(win);
  const board = await openBoard(win);
  const title = titleOf(daySection(board, wed), 'Card task');
  await expect(title).toBeVisible();
  await title.click();
  const dlg = win.getByRole('dialog', { name: 'Task: Card task' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAttribute('data-mode', 'card');
  await expect(win.locator('[data-detail-backdrop]')).toBeVisible();
  await sleep(400);
  const box = (await dlg.boundingBox())!;
  const viewW = await win.evaluate(() => window.innerWidth);
  test.info().annotations.push({ type: 'card box', description: `${JSON.stringify(box)} innerWidth ${viewW}` });
  expect(Math.abs(box.y - 72)).toBeLessThanOrEqual(4);
  expect(Math.abs(box.x + box.width / 2 - viewW / 2)).toBeLessThanOrEqual(4);
  const cardWidth = box.width;
  await shot(win, '05-quick-card.png');

  // 06: the Repeat menu on the card.
  await dlg.getByRole('button', { name: 'Repeat' }).click();
  await expect(dlg.getByRole('menuitemradio', { name: 'Weekdays' })).toBeVisible();
  await shot(win, '06-card-repeat-menu.png');
  await win.keyboard.press('Escape');
  await expect(dlg).toBeVisible();

  await dlg.getByRole('textbox', { name: 'Note' }).fill('Chapter 3 summary');
  const tag = dlg.getByRole('textbox', { name: 'Add a tag' });
  await tag.fill('lecture');
  await tag.press('Enter');
  await expect(dlg).toContainText('#lecture');
  await win.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect.poll(async () => (await taskOf(win, id!))?.tags).toEqual(['lecture']);
  expect((await taskOf(win, id!))?.note).toBe('Chapter 3 summary');

  await titleOf(daySection(board, wed), 'Card task').click();
  const again = win.getByRole('dialog', { name: 'Task: Card task' });
  await expect(again).toBeVisible();
  await expect(again.getByRole('textbox', { name: 'Note' })).toHaveValue('Chapter 3 summary');
  await expect(again).toContainText('#lecture');
  await expect(again.getByRole('group', { name: 'Colour' })).toHaveCount(0);
  await shot(win, '10a-card.png');

  await again.getByRole('button', { name: 'Expand' }).click();
  await expect(again).toHaveAttribute('data-mode', 'full');
  await expect(again.getByRole('group', { name: 'Colour' })).toBeVisible();
  await sleep(300);
  const full = (await again.boundingBox())!;
  test.info().annotations.push({ type: 'widths', description: `card ${cardWidth} full ${full.width}` });
  await shot(win, '07-expanded.png');
  await shot(win, '10b-expanded.png');
  expect(Math.abs(cardWidth - 420)).toBeLessThanOrEqual(4);
  expect(Math.abs(full.width - 400)).toBeLessThanOrEqual(4);

  // A press on the backdrop closes the dialog.
  await win.mouse.click(30, 400);
  await expect(again).toBeHidden();
});

// ---------------------------------------------------------------------------------------------
// 5b. The card's task menu in a short window: is the Delete confirm clipped?

test('the card Task menu and its Delete confirm in a short window', async ({ launch }) => {
  const { app, win } = await launch();
  await prepare(win);
  const { thu } = week();
  const [id] = await seed(win, [{ title: 'Short window', day: thu }]);
  await reload(win);
  const board = await openBoard(win);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.webContents.getURL().includes('mini'));
    w?.setContentSize(1280, 640);
  });
  await sleep(600);
  await titleOf(daySection(board, thu), 'Short window').click();
  const dlg = win.getByRole('dialog', { name: 'Task: Short window' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Task menu' }).click();
  const actions = dlg.getByRole('group', { name: 'Task actions' });
  await actions.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dlg.getByText('Delete this task?')).toBeVisible();
  const box = (await dlg.boundingBox())!;
  const confirm = (await dlg.getByText('Delete this task?').boundingBox())!;
  const innerH = await win.evaluate(() => window.innerHeight);
  test.info().annotations.push({ type: 'short window', description: `dialog ${JSON.stringify(box)} confirm ${JSON.stringify(confirm)} innerHeight ${innerH}` });
  await shot(win, '11-card-task-menu-delete.png');
  await actions.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => taskOf(win, id!)).toBeNull();
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.webContents.getURL().includes('mini'));
    w?.setContentSize(size.width, size.height);
  }, VIEW);
});

// ---------------------------------------------------------------------------------------------
// 6. Click-to-type on the board (AC 11, 12).

test('a click on a blank line types a task: Friday twice in order, then the Inbox', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const { fri } = week();
  await reload(win);
  const board = await openBoard(win);
  const col = daySection(board, fri);
  await expect(col).toBeVisible();
  await calm(win);
  await shot(win, '01-board-blank-lines.png');

  // The last blank line of Friday.
  const blanks = col.locator('[data-rule="blank"]');
  const n = await blanks.count();
  expect(n).toBeGreaterThan(1);
  const last = blanks.nth(n - 1);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  const input = addLine(col);
  await expect(input).toBeFocused();
  await shot(win, '02-add-line-focused.png');
  await input.pressSequentially('Lecture 5 notes #lecture ~1h');
  await input.press('Enter');
  await expect(rowOf(col, 'Lecture 5 notes')).toBeVisible();
  await input.pressSequentially('Anki');
  await input.press('Enter');
  await expect(rowOf(col, 'Anki')).toBeVisible();
  await expect(input).toBeFocused();
  await expect.poll(() => dayTitles(win, fri)).toEqual(['Lecture 5 notes', 'Anki']);
  const first = (await win.evaluate((d) => window.studyat.planner.day(d), fri)).tasks.find((t) => t.title === 'Lecture 5 notes');
  expect({ tags: first?.tags, est: first?.estimateMin }).toEqual({ tags: ['lecture'], est: 60 });
  await win.mouse.move(640, 790);
  await shot(win, '03-two-typed.png');

  // A blank line of the Inbox column.
  const inbox = await listId(win, 'Inbox');
  const inboxCol = listColumn(board, 'Inbox');
  await inboxCol.scrollIntoViewIfNeeded();
  const inboxBlanks = inboxCol.locator('[data-rule="blank"]');
  await inboxBlanks.nth(Math.min(2, (await inboxBlanks.count()) - 1)).click();
  const inboxInput = addLine(inboxCol);
  await expect(inboxInput).toBeFocused();
  await inboxInput.pressSequentially('Inbox item');
  await inboxInput.press('Enter');
  await expect(rowOf(inboxCol, 'Inbox item')).toBeVisible();
  await expect.poll(() => listTitles(win, inbox)).toEqual(['Inbox item']);

  // Esc in the add line clears it, leaves it and keeps the board open.
  await inboxInput.pressSequentially('never saved');
  await inboxInput.press('Escape');
  await expect(inboxInput).toHaveValue('');
  await expect(inboxInput).not.toBeFocused();
  await expect(board).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// 7. The board Day view's empty sheet; the grip at rest and on keyboard focus (AC 5, 14).

test('board Day: the empty sheet focuses the add line; the underline at rest and focused', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await reload(win);
  const board = await openBoard(win);
  const b = board.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'Day', exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  const today = studyDay(Date.now());
  const sheet = board.locator(`section[data-today="true"][aria-label="${formatDayLabel(today)}"]`);
  await expect(sheet.getByText('Nothing planned for this day.')).toBeVisible();
  await calm(win);
  await shot(win, '12-day-add-line-blank.png');
  const input = addLine(sheet);
  await expect(input).not.toBeFocused();
  await sheet.getByText('Nothing planned for this day.').click();
  await expect(input).toBeFocused();
  await shot(win, '12b-day-add-line-focused.png');
});

test('the grip is hidden at rest and on hover, and shows on keyboard focus', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const { tue } = week();
  await seed(win, [{ title: 'Grip check', day: tue }]);
  await reload(win);
  const board = await openBoard(win);
  const col = daySection(board, tue);
  const row = rowOf(col, 'Grip check');
  await expect(row).toBeVisible();
  const grip = row.getByRole('button', { name: 'Move "Grip check"' });
  const dir = process.env.STUDYAT_SHOTS_DIR;
  const rowShot = async (name: string): Promise<void> => {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const b = (await col.boundingBox())!;
    await win.screenshot({ path: join(dir, name), clip: { x: Math.max(0, b.x - 10), y: b.y, width: b.width + 20, height: Math.min(220, b.height) } });
  };
  // The clipped grip keeps its button padding in its box, so "hidden" is the clip, not the width.
  const gripBox = async () => {
    const g = (await grip.boundingBox())!;
    const clip = await grip.evaluate((el) => getComputedStyle(el).clipPath);
    return { w: g.width, h: g.height, clip };
  };

  await win.mouse.move(640, 790);
  await sleep(300);
  const rest = await gripBox();
  await rowShot('13-grip-at-rest.png');
  await row.hover();
  await sleep(300);
  const hover = await gripBox();
  await rowShot('13b-grip-hovered.png');
  test.info().annotations.push({ type: 'grip sizes', description: `rest ${JSON.stringify(rest)} hover ${JSON.stringify(hover)}` });
  expect(rest.clip).not.toBe('none');
  expect(hover.clip).not.toBe('none');

  // Tab from the row's title reaches the grip, and a keyboard focus shows it.
  await win.mouse.move(640, 790);
  await titleOf(col, 'Grip check').focus();
  for (let i = 0; i < 4; i++) {
    const on = await win.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    if (on === 'Move "Grip check"') break;
    await win.keyboard.press('Tab');
  }
  await expect(grip).toBeFocused();
  expect(await grip.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await sleep(200);
  const focused = await gripBox();
  test.info().annotations.push({ type: 'grip focused', description: JSON.stringify(focused) });
  expect(focused.clip).toBe('none');
  expect(focused.w).toBeGreaterThan(8);
  await shot(win, '08-grip-keyboard-focus.png');
});
