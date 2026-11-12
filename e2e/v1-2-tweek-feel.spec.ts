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

interface DragOptions {
  /** The drop point's depth below the target's top, kept 4 px inside its bottom edge. */
  dy?: number;
  /** A scroller both pointer points must sit inside (the widget's Week); the window always. */
  within?: Locator;
  /** The board draws the moving line as an overlay; the widget only marks the row. */
  overlay?: boolean;
  mid?: string;
}

/** A real-pointer drag from the centre of the title's first line of text (no grip) to `target`:
 *  a nudge past the 6 px activation distance, then on to the point in steps, a settle, an optional
 *  shot, and release. The target is scrolled into view, then the source, and only then are both
 *  measured: a target measured before the source scrolled can sit off the window, where dnd-kit
 *  autoscrolls and the drop misses (811cdf8). Both points are asserted on the window first. */
async function dragByTitle(win: Page, title: Locator, target: Locator, { dy = 70, within, overlay = true, mid }: DragOptions = {}): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await title.scrollIntoViewIfNeeded();
  await sleep(300);
  const start = await title.evaluate((n) => {
    const r = n.getClientRects()[0]!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const b = await target.boundingBox();
  if (!b) throw new Error('no target box');
  const to = { x: b.x + b.width / 2, y: b.y + Math.min(dy, b.height - 4) };
  const view = await win.evaluate(() => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }));
  const areas = [view];
  if (within) {
    const s = await within.boundingBox();
    if (!s) throw new Error('no scroller box');
    areas.push(s);
  }
  for (const a of areas) {
    for (const p of [start, to]) {
      const inside = p.x > a.x && p.x < a.x + a.width && p.y > a.y && p.y < a.y + a.height;
      expect(inside, `pointer ${JSON.stringify(p)} inside ${JSON.stringify(a)}`).toBe(true);
    }
  }
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 8, start.y + 8, { steps: 4 });
  // The drag is live before it moves on: the row is marked, and on the board the line follows the pointer.
  await expect(win.locator('li[data-dragging="true"]').first()).toBeAttached();
  if (overlay) await expect(win.locator('[data-drag-overlay]')).toBeVisible();
  await win.mouse.move(to.x, to.y, { steps: 20 });
  await sleep(400);
  if (mid) await shot(win, mid);
  await win.mouse.up();
  await sleep(500);
}

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

  await dragByTitle(win, titleOf(daySection(board, mon), 'Drag me'), daySection(board, thu), { mid: '04-drag-mid.png' });
  await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(thu);
  expect(await dayTitles(win, thu)).toContain('Drag me');
  expect(await dayTitles(win, mon)).not.toContain('Drag me');
  await expect(rowOf(daySection(board, thu), 'Drag me')).toBeVisible();
  await expect(win.getByRole('dialog', { name: 'Task: Drag me' })).toBeHidden();

  // Thursday -> the Inbox list.
  const inbox = await listId(win, 'Inbox');
  const inboxCol = listColumn(board, 'Inbox');
  await dragByTitle(win, titleOf(daySection(board, thu), 'Drag me'), inboxCol, { dy: 40 });
  await expect.poll(async () => (await taskOf(win, id!))?.listId).toBe(inbox);
  expect((await taskOf(win, id!))?.day).toBeNull();
  await expect(rowOf(inboxCol, 'Drag me')).toBeVisible();

  // The Inbox -> Friday.
  await dragByTitle(win, titleOf(inboxCol, 'Drag me'), daySection(board, fri));
  await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(fri);
  expect((await taskOf(win, id!))?.listId).toBeNull();
  expect(await dayTitles(win, fri)).toContain('Drag me');
});

// ---------------------------------------------------------------------------------------------
// 3. The widget's Week (AC 2).

// The drag runs in the week after today's, Monday to Tuesday: that week holds no today, so the Week
// does not scroll itself to today (E8) and both days are in reach on every weekday. (In today's own
// week a Sunday has no day after it, and the day before sits above the scroller, out of reach.) The
// pinned runs prove it: Playwright's clock sets the renderer's "today" to noon on this week's
// Sunday and on next Monday, neither before the real date, so main's own clock agrees with which
// days are past.
const thisMon = weekStartOf(studyDay(Date.now()));
const pins = [
  { name: '', day: null, weekday: null },
  { name: ' (today pinned to a Sunday)', day: addDays(thisMon, 6), weekday: 0 },
  { name: ' (today pinned to a Monday)', day: addDays(thisMon, 7), weekday: 1 },
] as const;

for (const pin of pins) {
  test(`widget Week: a task drags by its title to the next day; a click opens the card${pin.name}`, async ({ launch }) => {
    const { app, win } = await launch();
    await prepare(win);
    if (pin.day) await app.context().clock.install({ time: new Date(`${pin.day}T12:00:00`) });
    const today = pin.day ?? studyDay(Date.now());
    const mon = addDays(weekStartOf(today), 7);
    const tue = addDays(mon, 1);
    const [id] = await seed(win, [{ title: 'Widget drag', day: mon }]);
    await reload(win);
    if (pin.day) expect(await win.evaluate(() => new Date().getDay())).toBe(pin.weekday);
    const w = await openTasks(win, 'Week');
    // Provenance: the Week opens on today's week (the pinned day when pinned), then steps on a week.
    await expect(w.locator('section[data-today="true"]')).toHaveAttribute('aria-label', formatDayLabel(today));
    await w.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(w.locator('section[data-today="true"]')).toHaveCount(0);
    await expect(rowOf(daySection(w, mon), 'Widget drag')).toBeVisible();
    const scroller = w.locator('section[aria-label="Week"] > div').last();
    const title = rowOf(daySection(w, mon), 'Widget drag').getByRole('button', { name: 'Widget drag', exact: true });
    await dragByTitle(win, title, daySection(w, tue), { dy: 30, within: scroller, overlay: false });
    await expect.poll(async () => (await taskOf(win, id!))?.day).toBe(tue);
    await expect(rowOf(daySection(w, tue), 'Widget drag')).toBeVisible();
    await expect(win.getByRole('dialog', { name: 'Task: Widget drag' })).toBeHidden();

    // 09: a click on the widget row opens the same quick card.
    await sleep(400);
    await rowOf(daySection(w, tue), 'Widget drag').getByRole('button', { name: 'Widget drag', exact: true }).click();
    const card = win.getByRole('dialog', { name: 'Task: Widget drag' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-mode', 'card');
    if (!pin.day) await shot(win, '09-widget-card.png');
  });
}

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
  // Released on Stay B's lower half: a reorder inside Monday, with the drag live first (the helper).
  await dragByTitle(win, titleOf(col, 'Stay A'), rowOf(col, 'Stay B'), { dy: 1000 });
  await sleep(500);
  await expect(win.getByRole('dialog', { name: /^Task: / })).toBeHidden();
  const focused = await win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? '', label: el?.getAttribute('aria-label') ?? '' };
  });
  test.info().annotations.push({ type: 'focus after reorder', description: JSON.stringify(focused) });
  expect(focused.label.startsWith('Add to')).toBe(false);
  await expect(addLine(col)).not.toBeFocused();
  await expect.poll(() => dayTitles(win, mon)).toEqual(['Stay B', 'Stay A']);
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
  // AC 14: the bare add line has no placeholder, and no blank line carries text.
  expect((await addLine(col).getAttribute('placeholder')) ?? '').toBe('');
  expect((await blanks.allTextContents()).filter((t) => t.trim() !== '')).toEqual([]);
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
