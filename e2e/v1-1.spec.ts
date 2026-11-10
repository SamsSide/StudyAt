// v1.1 polish end to end (spec §9 criteria 4, 9, 10, 11, 13, 16 as far as they are end to end):
// Countdown with a task, focus view, layout scaling, image widgets, YouTube, the away switch and
// the Spotify widget's unconfigured state. Every test launches the BUILT app on a throwaway
// STUDYAT_USER_DATA (the fixtures), and screenshots go to STUDYAT_SHOTS_DIR when it is set.
import type { Page } from '@playwright/test';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, prepare, queryDb, quitApp, shot, sleep, test, type Launched } from './fixtures';

const SUBJECT = 'COMP2261 Artificial Intelligence';
const LONG_TASK =
  'Write the introduction to the essay on the halting problem, including the long historical background section';
const GIF_LINK = 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Newtons_cradle_animation_book_2.gif';

const dock = (win: Page, label: string) =>
  win.locator('nav[aria-label="Dock"]').getByRole('button', { name: new RegExp(`^${label}`) }).first();
const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();
const shell = (win: Page) => win.locator('[data-testid="shell"]');

/** Sets the window's content size and waits for the renderer to see it. */
async function resize(l: Launched, width: number, height: number): Promise<void> {
  await l.app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((b) => !b.webContents.getURL().includes('mini'));
    w?.setContentSize(size.width, size.height);
  }, { width, height });
  await expect.poll(() => l.win.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)).toBe(`${width}x${height}`);
  await sleep(500);
}

async function calm(win: Page): Promise<void> {
  await win.mouse.move(640, 500);
  await sleep(500);
}

async function openSettingsTimer(win: Page): Promise<void> {
  await dock(win, 'Settings').click();
  await win.getByRole('tab', { name: 'Timer' }).click();
}

/** A small striped GIF (48 x 32) written by hand: no committed media. */
function makeGif(path: string): void {
  const w = 48;
  const h = 32;
  const palette = [
    [0xf4, 0x8f, 0xb1],
    [0x4d, 0xb6, 0xac],
    [0xff, 0xd5, 0x4f],
    [0x42, 0x42, 0x42],
  ];
  const data: number[] = [];
  let acc = 0;
  let nbits = 0;
  const put = (code: number): void => {
    acc |= code << nbits;
    nbits += 3;
    while (nbits >= 8) {
      data.push(acc & 0xff);
      acc >>= 8;
      nbits -= 8;
    }
  };
  const colour = (i: number): number => (Math.floor((i % w) / 6) + Math.floor(i / w / 8)) % 4;
  // LZW with minimum code size 2: a clear code (4) before every pair of pixels keeps every code
  // 3 bits wide, so the stream needs no table at all.
  for (let i = 0; i < w * h; i += 2) {
    put(4);
    put(colour(i));
    put(colour(i + 1));
  }
  put(4);
  put(5);
  if (nbits > 0) data.push(acc & 0xff);
  const bytes: number[] = [...Buffer.from('GIF89a'), w, 0, h, 0, 0xf1, 0, 0];
  for (const c of palette) bytes.push(...c);
  bytes.push(0x2c, 0, 0, 0, 0, w, 0, h, 0, 0, 2);
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    bytes.push(chunk.length, ...chunk);
  }
  bytes.push(0, 0x3b);
  writeFileSync(path, Buffer.from(bytes));
}

/** A plain RGB PNG of the given size, two-tone stripes, written by hand: no committed media. */
function makePng(path: string, w: number, h: number): void {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = (table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw.set(Math.floor(x / 50) % 2 ? [0x4d, 0xb6, 0xac] : [0xf4, 0x8f, 0xb1], o);
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

test('Countdown: one minute with a task records a session and By task lists it', async ({ launch, dataDir }) => {
  const { win, app } = await launch();
  await prepare(win);

  // Set the length through Settings (the real field), not the API.
  await openSettingsTimer(win);
  await shot(win, 'v11-settings-timer-away-on.png');
  const field = win.getByLabel('Countdown length');
  await field.fill('1');
  await field.blur();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.settings.get())).countdownMinutes).toBe(1);
  await win.keyboard.press('Escape');

  const subject = (await win.evaluate(() => window.studyat.subjects.list())).find((s) => s.name === SUBJECT);
  await win.evaluate((text) => window.studyat.tasks.create({ text, colour: 'yellow' }), LONG_TASK);
  await win.evaluate(() => window.studyat.tasks.create({ text: 'Past paper Q3', colour: 'blue' }));

  await calm(win);
  await win.keyboard.press('4');
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).mode).toBe('countdown');
  await expect(win.getByRole('timer')).toContainText('01:00');
  await calm(win);
  await shot(win, 'v11-timer-countdown-idle.png');

  await win.getByRole('combobox', { name: 'Subject' }).click();
  await win.getByRole('option', { name: SUBJECT }).click();
  const task = win.getByRole('combobox', { name: 'Task' });
  await task.click();
  await expect(win.getByRole('option', { name: LONG_TASK })).toBeVisible();
  await shot(win, 'v11-task-picker-open-long-name.png');
  await win.getByRole('option', { name: LONG_TASK }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).taskText).toBe(LONG_TASK);

  // The mini timer in Countdown, from the widget's own button.
  await widget(win, 'Timer').getByRole('button', { name: 'Show mini timer' }).click();
  await expect.poll(() => app.windows().length).toBe(2);
  const mini = app.windows().find((p) => p.url().includes('mini'));
  expect(mini).toBeDefined();
  await mini?.waitForLoadState('load');
  await sleep(800);
  if (mini) await shot(mini, 'v11-mini-timer-countdown.png');
  await widget(win, 'Timer').getByRole('button', { name: 'Hide mini timer' }).click();

  await calm(win);
  await win.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status).toBe('running');
  await sleep(62_000);

  // After the 1 minute run: idle in Countdown at full length, no break, count unchanged.
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).status, { timeout: 20_000 }).toBe('idle');
  const state = await win.evaluate(() => window.studyat.timer.get());
  expect(state.mode).toBe('countdown');
  expect(state.completedFocusCount).toBe(0);
  expect(state.remainingMs).toBe(60_000);
  await expect(win.getByRole('timer')).toContainText('01:00');
  await calm(win);
  await shot(win, 'v11-timer-countdown-done.png');

  const sessions = await win.evaluate(() => window.studyat.stats.sessions());
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.subjectId).toBe(subject?.id);
  expect(sessions[0]?.taskText).toBe(LONG_TASK);
  expect(sessions[0]?.focusMs).toBeGreaterThanOrEqual(55_000);
  const byTask = await win.evaluate(() => window.studyat.stats.byTask('week'));
  expect(byTask).toHaveLength(1);
  expect(byTask[0]?.text).toBe(LONG_TASK);

  // Provenance: the row is on disk with the task columns.
  const disk = await queryDb(dataDir, 'SELECT task_id, task_text, focus_ms, status FROM sessions');
  expect(disk).toHaveLength(1);
  expect(disk[0]?.task_text).toBe(LONG_TASK);
  expect(disk[0]?.task_id).not.toBeNull();

  await win.keyboard.press('s');
  const stats = win.getByRole('dialog', { name: 'Stats' });
  await expect(stats).toBeVisible();
  await expect(stats.getByRole('heading', { name: 'By task' })).toBeVisible();
  await expect(stats.getByText(LONG_TASK).first()).toBeVisible();
  await sleep(800);
  await shot(win, 'v11-stats-top.png');
  await stats.getByRole('heading', { name: 'By task' }).scrollIntoViewIfNeeded();
  await sleep(300);
  await shot(win, 'v11-stats-by-task.png');
  const header = stats.getByRole('columnheader', { name: 'Task' });
  await header.scrollIntoViewIfNeeded();
  await expect(header).toBeVisible();
  await sleep(300);
  await shot(win, 'v11-stats-sessions-task-column.png');
});

test('Stats with no tasks linked says so', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await win.keyboard.press('s');
  const stats = win.getByRole('dialog', { name: 'Stats' });
  await expect(stats.getByText('No tasks linked yet')).toBeVisible();
  await stats.getByText('No tasks linked yet').scrollIntoViewIfNeeded();
  await sleep(500);
  await shot(win, 'v11-stats-no-tasks-linked.png');
});

test('Focus view: H hides the chrome, the capsule and Esc bring it back', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await calm(win);
  await expect(win.getByRole('button', { name: 'Hide interface' })).toBeVisible();
  await shot(win, 'v11-topbar-hide-interface-button.png');

  await win.keyboard.press('h');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'on');
  await expect(shell(win)).toHaveAttribute('data-chrome', 'hidden');
  for (let i = 0; i < 6; i++) {
    await win.mouse.move(300 + i * 40, 300 + i * 20);
    await sleep(150);
  }
  await expect(shell(win)).toHaveAttribute('data-chrome', 'hidden');
  await shot(win, 'v11-focus-view-hidden.png');

  // Tab can't reach the dock or the top bar while they are hidden.
  const reached = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await win.keyboard.press('Tab');
    reached.add(
      await win.evaluate(() => {
        const el = document.activeElement;
        if (el?.closest('nav[aria-label="Dock"]')) return 'dock';
        if (el?.closest('header')) return 'topbar';
        return 'other';
      }),
    );
  }
  expect(reached.has('dock')).toBe(false);
  expect(reached.has('topbar')).toBe(false);
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // The corner capsule.
  await win.mouse.move(20, 20);
  const capsule = win.getByRole('button', { name: 'Show interface' });
  await expect(capsule).toBeVisible();
  await shot(win, 'v11-focus-view-show-interface-capsule.png');
  const box = await capsule.boundingBox();
  expect(box && box.x < 64 && box.y < 64).toBe(true);

  // Stats opens over focus view; Esc closes only it.
  await win.mouse.move(640, 500);
  await win.keyboard.press('s');
  await expect(win.getByRole('dialog', { name: 'Stats' })).toBeVisible();
  await shot(win, 'v11-focus-view-stats-over.png');
  await win.keyboard.press('Escape');
  await expect(win.getByRole('dialog', { name: 'Stats' })).toBeHidden();
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'on');

  // H brings the chrome back.
  await win.keyboard.press('h');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'off');
  await expect(shell(win)).toHaveAttribute('data-chrome', 'shown');
  await shot(win, 'v11-focus-view-restored.png');

  // The button works, and Esc leaves focus view too.
  await win.getByRole('button', { name: 'Hide interface' }).click();
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'on');
  await win.keyboard.press('Escape');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'off');
});

test('Scaling: the layout halves at 960 x 540, a resize drag persists, scale 2 fits', async ({ launch, dataDir }) => {
  const first = await launch();
  const { win } = first;
  await prepare(win);
  const timerBox = async () => {
    const b = await widget(win, 'Timer').boundingBox();
    if (!b) throw new Error('timer widget has no box');
    return b;
  };

  await resize(first, 1920, 1080);
  await calm(win);
  const big = await timerBox();
  await shot(win, 'v11-scale-1920x1080.png');
  await resize(first, 960, 540);
  await calm(win);
  const small = await timerBox();
  await shot(win, 'v11-scale-960x540.png');
  // Same horizontal centre across and half the size; the top edge is held below the top bar.
  expect(Math.abs(big.width / 2 - small.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(big.height / 2 - small.height)).toBeLessThanOrEqual(2);
  expect(Math.abs((big.x + big.width / 2) / 1920 - (small.x + small.width / 2) / 960) * 960).toBeLessThanOrEqual(2);
  const topClear = 12 + 52 + 12;
  expect(Math.abs(small.y - Math.max(0.12 * 540, topClear))).toBeLessThanOrEqual(2);

  // Scale 2 in the small window: stepped from the corner with the keyboard.
  const corner = win.getByRole('button', { name: 'Resize Timer' });
  await corner.focus();
  for (let i = 0; i < 10; i++) await win.keyboard.press('+');
  await expect.poll(async () => (await win.evaluate(() => window.studyat.settings.get())).widgets.timer.scale).toBe(2);
  await calm(win);
  await shot(win, 'v11-scale-2-in-small-window.png');
  const two = await timerBox();
  expect(two.x).toBeGreaterThanOrEqual(0);
  expect(two.y).toBeGreaterThanOrEqual(0);
  expect(two.x + two.width).toBeLessThanOrEqual(960 + 1);
  expect(two.y + two.height).toBeLessThanOrEqual(540 + 1);
  await corner.focus();
  await win.keyboard.press('0');
  await expect.poll(async () => (await win.evaluate(() => window.studyat.settings.get())).widgets.timer.scale).toBe(1);

  // Drag the corner with the mouse at 1280 x 800; the saved scale survives a relaunch.
  await resize(first, 1280, 800);
  await calm(win);
  const before = await timerBox();
  await widget(win, 'Timer').hover();
  await sleep(300);
  await shot(win, 'v11-resize-corner-on-hover.png');
  const cb = await corner.boundingBox();
  if (!cb) throw new Error('no resize corner');
  await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await win.mouse.down();
  await win.mouse.move(cb.x + cb.width / 2 + 40, cb.y + cb.height / 2 + 40, { steps: 6 });
  await win.mouse.move(cb.x + cb.width / 2 + 90, cb.y + cb.height / 2 + 90, { steps: 6 });
  await win.mouse.up();
  const saved = (await win.evaluate(() => window.studyat.settings.get())).widgets.timer;
  expect(saved.scale).toBeGreaterThan(1.1);
  const after = await timerBox();
  expect(after.width).toBeGreaterThan(before.width * 1.1);

  await quitApp(first.app);
  const second = await launch(dataDir);
  await expect
    .poll(async () => (await second.win.evaluate(() => window.studyat.settings.get())).widgets.timer.scale)
    .toBe(saved.scale);
  await sleep(500);
  const reopened = await widget(second.win, 'Timer').boundingBox();
  expect(Math.abs((reopened?.width ?? 0) - after.width)).toBeLessThanOrEqual(2);
});

test('Images: file, link, errors, background toggle, drag and remove', async ({ launch, dataDir }) => {
  const gif = join(dataDir, 'stripes.gif');
  makeGif(gif);
  const text = join(dataDir, 'notes.txt');
  writeFileSync(text, 'not an image');
  const { app, win } = await launch();
  await prepare(win);
  const stub = (file: string) =>
    app.evaluate(({ dialog }, f) => {
      const pick = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [f] });
      dialog.showOpenDialog = pick as typeof dialog.showOpenDialog;
    }, file);
  const imagesOnDisk = (): string[] => (existsSync(join(dataDir, 'images')) ? readdirSync(join(dataDir, 'images')) : []);

  await dock(win, 'Widgets').click();
  const pop = win.getByRole('dialog', { name: 'Widgets' });
  await expect(pop.getByRole('button', { name: /Add image/ })).toBeVisible();
  await shot(win, 'v11-widgets-popover-add-image.png');
  await pop.getByRole('button', { name: /Add image/ }).click();
  const dialog = win.getByRole('dialog', { name: 'Add image' });
  await expect(dialog).toBeVisible();

  // Errors, verbatim.
  await stub(text);
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await expect(win.getByRole('alert')).toHaveText("That isn't a GIF, PNG, JPEG or WebP image.");
  await shot(win, 'v11-add-image-dialog-error.png');
  expect(imagesOnDisk()).toHaveLength(0);
  await dialog.getByLabel('Link').fill('https://localhost:1/nope.gif');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(win.getByRole('alert')).toHaveText("Couldn't download that link. Check it and your connection.");
  await shot(win, 'v11-add-image-dialog-link-error.png');

  // A file from disk.
  await stub(gif);
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list())).length).toBe(1);
  expect(imagesOnDisk().filter((f) => f.endsWith('.gif'))).toHaveLength(1);
  const framed = widget(win, 'Image');
  await expect(framed).toBeVisible();
  const img = framed.locator('img');
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(48);
  await calm(win);
  await shot(win, 'v11-image-framed.png');

  // A direct link, when the network is up.
  let linked = false;
  const online = await fetch(GIF_LINK, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  if (online) {
    await dock(win, 'Widgets').click();
    await win.getByRole('dialog', { name: 'Widgets' }).getByRole('button', { name: /Add image/ }).click();
    const d2 = win.getByRole('dialog', { name: 'Add image' });
    await d2.getByLabel('Link').fill(GIF_LINK);
    await d2.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(d2).toBeHidden({ timeout: 30_000 });
    await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list())).length).toBe(2);
    linked = true;
  }
  test.info().annotations.push({ type: 'link', description: linked ? 'link added' : 'network down: link skipped' });
  const count = linked ? 2 : 1;
  expect(imagesOnDisk()).toHaveLength(count);

  // New images cascade slightly; drag the second one well aside by its header.
  if (linked) {
    const handle = win.getByRole('button', { name: 'Move Image', exact: true }).last();
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('no header handle');
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await win.mouse.down();
    await win.mouse.move(hb.x + hb.width / 2 + 300, hb.y + hb.height / 2 + 120, { steps: 8 });
    await win.mouse.up();
    await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list()))[1]?.x ?? 0).toBeGreaterThan(0.6);
    await calm(win);
    await shot(win, 'v11-images-two-framed.png');
  }

  // Background off on the first image, then a drag.
  await widget(win, 'Image').getByRole('button', { name: 'Hide background' }).click();
  const bare = win.getByRole('button', { name: 'Image 1', exact: true });
  await expect(bare).toBeVisible();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list()))[0]?.bare).toBe(true);
  await bare.hover();
  await sleep(400);
  await shot(win, 'v11-image-bare-hover-toolbar.png');
  const b0 = await bare.boundingBox();
  const x0 = (await win.evaluate(() => window.studyat.images.list()))[0]?.x ?? 0;
  if (!b0) throw new Error('no bare image box');
  await win.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await win.mouse.down();
  await win.mouse.move(b0.x + b0.width / 2 + 150, b0.y + b0.height / 2 + 60, { steps: 8 });
  await win.mouse.up();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list()))[0]?.x ?? 0).toBeGreaterThan(x0 + 0.03);
  await calm(win);
  await shot(win, 'v11-image-bare-moved.png');

  // A bare image in focus view.
  await win.keyboard.press('h');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'on');
  await sleep(500);
  await shot(win, 'v11-image-bare-focus-view.png');
  await win.keyboard.press('h');

  // Remove one (asks first); its file goes from disk.
  await win.getByRole('button', { name: 'Image 1', exact: true }).hover();
  await win.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await expect(win.getByRole('group', { name: 'Remove this image?' })).toBeVisible();
  await shot(win, 'v11-image-remove-confirm.png');
  await win.getByRole('group', { name: 'Remove this image?' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list())).length).toBe(count - 1);
  expect(imagesOnDisk()).toHaveLength(count - 1);
});

// Task 9 fix (00b6f85): a link without a scheme gets the app's own answer, a bare image shows its
// toolbar on keyboard focus and hides it in focus view, and a thin missing image keeps its
// "Image missing" and Remove readable.
test('Images: a link without a scheme, the bare toolbar on Tab and in focus view, a thin missing image', async ({ launch, dataDir }) => {
  const png = join(dataDir, 'thin.png');
  makePng(png, 1000, 100);
  const { app, win } = await launch();
  await prepare(win);
  const imagesDir = join(dataDir, 'images');
  const imagesOnDisk = (): string[] => (existsSync(imagesDir) ? readdirSync(imagesDir) : []);
  // The bare toolbar's computed style, read by text: a role locator can't see it once focus view
  // makes it visibility: hidden (it leaves the accessibility tree), and would wait forever.
  const toolsStyle = (): Promise<{ opacity: string; visibility: string }> =>
    win.evaluate(() => {
      const button = [...document.querySelectorAll('[role="group"][aria-label="Image 1"] button')].find(
        (b) => b.textContent === 'Show background',
      );
      const cs = getComputedStyle(button?.parentElement ?? document.body);
      return { opacity: button ? cs.opacity : 'none', visibility: button ? cs.visibility : 'none' };
    });
  const toolsOpacity = async (): Promise<string> => (await toolsStyle()).opacity;

  await dock(win, 'Widgets').click();
  await win.getByRole('dialog', { name: 'Widgets' }).getByRole('button', { name: /Add image/ }).click();
  const dialog = win.getByRole('dialog', { name: 'Add image' });
  await expect(dialog).toBeVisible();

  // A link without a scheme: no browser bubble (the form doesn't validate), main answers instead.
  const link = dialog.getByLabel('Link');
  await link.fill('example.com/a.png');
  expect(await link.evaluate((el) => (el as HTMLInputElement).form?.noValidate)).toBe(true);
  const validity = await link.evaluate((el) => (el as HTMLInputElement).validity.valid);
  test.info().annotations.push({ type: 'scheme-less link', description: `type=url validity.valid=${validity}` });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(win.getByRole('alert')).toHaveText("Couldn't download that link. Check it and your connection.");
  await expect(dialog).toBeVisible();
  await shot(win, 'v11-fix9-link-no-scheme.png');
  expect(imagesOnDisk()).toHaveLength(0);

  // A thin (10:1) PNG from disk.
  await app.evaluate(({ dialog: d }, f) => {
    const pick = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [f] });
    d.showOpenDialog = pick as typeof d.showOpenDialog;
  }, png);
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list())).length).toBe(1);
  const row = (await win.evaluate(() => window.studyat.images.list()))[0];
  expect([row?.width, row?.height]).toEqual([1000, 100]);
  expect(imagesOnDisk().filter((f) => f.endsWith('.png'))).toHaveLength(1);
  await expect.poll(() => widget(win, 'Image').locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1000);

  // Background off, then focus it with Tab while the pointer is elsewhere.
  await widget(win, 'Image').getByRole('button', { name: 'Hide background' }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list()))[0]?.bare).toBe(true);
  const group = widget(win, 'Image 1');
  const body = win.getByRole('button', { name: 'Image 1', exact: true });
  await expect(body).toBeVisible();
  await win.mouse.move(1260, 790);
  await sleep(500);
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(toolsOpacity).toBe('0');
  let tabs = 0;
  for (; tabs < 80; tabs++) {
    if (await body.evaluate((el) => el === document.activeElement)) break;
    await win.keyboard.press('Tab');
  }
  test.info().annotations.push({ type: 'tab presses to the bare image', description: String(tabs) });
  await expect(body).toBeFocused();
  expect(await group.evaluate((el) => el.matches(':hover'))).toBe(false);
  await expect.poll(toolsOpacity).toBe('1');
  await shot(win, 'v11-fix9-bare-tab-toolbar.png');

  // Focus view: the toolbar goes with the chrome; the image stays.
  await win.keyboard.press('h');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'on');
  await expect.poll(toolsStyle).toEqual({ opacity: '0', visibility: 'hidden' });
  await expect(group.locator('img')).toBeVisible();
  await sleep(300);
  await shot(win, 'v11-fix9-bare-focus-view-no-toolbar.png');
  await win.keyboard.press('h');
  await expect(shell(win)).toHaveAttribute('data-focus-view', 'off');

  // Sam's ruling: a mouse click doesn't pin the bare toolbar. Click the image, move well away, and
  // the toolbar goes (it shows on hover or keyboard focus only).
  const bb = await body.boundingBox();
  if (!bb) throw new Error('no bare image box');
  await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.mouse.move(1260, 790, { steps: 6 });
  await expect.poll(toolsOpacity).toBe('0');
  const focused = await body.evaluate((el) => el === document.activeElement);
  test.info().annotations.push({ type: 'bare toolbar after click', description: `opacity=0 bodyFocused=${focused}` });
  await shot(win, 'v11-fix9-bare-after-click.png');

  // Make it missing: quit, delete its stored file, relaunch on the same data. (A reload alone can
  // still paint the picture from the renderer's cache, so it isn't a reliable way to lose it.)
  expect(await quitApp(app)).toBe(0);
  const stored = imagesOnDisk();
  expect(stored).toHaveLength(1);
  for (const f of stored) rmSync(join(imagesDir, f));
  expect(imagesOnDisk()).toHaveLength(0);
  const again = await launch();
  const win2 = again.win;
  await expect.poll(async () => (await win2.evaluate(() => window.studyat.images.list())).length).toBe(1);
  // A missing image shows in the glass (framed), whatever its background setting.
  const missing = widget(win2, 'Image');
  const message = missing.getByText('Image missing', { exact: true });
  const remove = message.locator('xpath=..').getByRole('button', { name: 'Remove', exact: true });
  await expect(message).toBeVisible();
  await expect(remove).toBeVisible();
  await calm(win2);
  const box = await message.evaluate((el) => {
    const r = (e: Element): { l: number; t: number; r: number; b: number } => {
      const b = e.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    };
    const area = el.parentElement as HTMLElement;
    const picture = area.parentElement as HTMLElement;
    const button = area.querySelector('button') as HTMLElement;
    return {
      picture: r(picture),
      area: r(area),
      text: r(el),
      button: r(button),
      overflow: area.scrollHeight > area.clientHeight || area.scrollWidth > area.clientWidth,
      pictureCss: { w: picture.style.width, h: picture.style.height },
    };
  });
  test.info().annotations.push({ type: 'missing frame', description: JSON.stringify(box) });
  expect(box.pictureCss).toEqual({ w: '240px', h: '80px' });
  expect(box.overflow).toBe(false);
  for (const inner of [box.text, box.button]) {
    expect(inner.l).toBeGreaterThanOrEqual(box.picture.l - 0.5);
    expect(inner.t).toBeGreaterThanOrEqual(box.picture.t - 0.5);
    expect(inner.r).toBeLessThanOrEqual(box.picture.r + 0.5);
    expect(inner.b).toBeLessThanOrEqual(box.picture.b + 0.5);
    expect(inner.b - inner.t).toBeGreaterThan(8);
  }
  await shot(win2, 'v11-fix9-thin-image-missing.png');

  // Remove asks first here too (a load error can also be a file that won't decode).
  await remove.click();
  const ask = win2.getByRole('group', { name: 'Remove this image?' });
  await expect(ask).toBeVisible();
  expect((await win2.evaluate(() => window.studyat.images.list())).length).toBe(1);
  await shot(win2, 'v11-final-missing-confirm.png');
  await ask.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(async () => (await win2.evaluate(() => window.studyat.images.list())).length).toBe(0);
  await expect.poll(() => imagesOnDisk().length).toBe(0);
});

test('Images: a second new image cascades off the first', async ({ launch, dataDir }) => {
  const gif = join(dataDir, 'stripes.gif');
  makeGif(gif);
  const { app, win } = await launch();
  await prepare(win);
  await app.evaluate(({ dialog }, f) => {
    const pick = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [f] });
    dialog.showOpenDialog = pick as typeof dialog.showOpenDialog;
  }, gif);
  for (const n of [1, 2]) {
    await dock(win, 'Widgets').click();
    await win.getByRole('dialog', { name: 'Widgets' }).getByRole('button', { name: /Add image/ }).click();
    const d = win.getByRole('dialog', { name: 'Add image' });
    await d.getByRole('button', { name: 'Choose file…' }).click();
    await expect(d).toBeHidden();
    await expect.poll(async () => (await win.evaluate(() => window.studyat.images.list())).length).toBe(n);
  }
  const [a, b] = await win.evaluate(() => window.studyat.images.list());
  test.info().annotations.push({ type: 'positions', description: JSON.stringify([[a?.x, a?.y], [b?.x, b?.y]]) });
  expect([b?.x, b?.y]).not.toEqual([a?.x, a?.y]);
  await calm(win);
  await shot(win, 'v11-final-images-cascade.png');
  // Provenance: the database file holds both positions. It is written on a debounce, so quit
  // (which saves) before reading it.
  expect(await quitApp(app)).toBe(0);
  const rows = await queryDb(dataDir, 'SELECT x, y FROM images ORDER BY id');
  expect(rows).toHaveLength(2);
  expect([rows[1]?.x, rows[1]?.y]).not.toEqual([rows[0]?.x, rows[0]?.y]);
  expect([rows[0]?.x, rows[0]?.y]).toEqual([a?.x, a?.y]);
  expect([rows[1]?.x, rows[1]?.y]).toEqual([b?.x, b?.y]);
});

test('A held task ticked off while idle leaves the timer on No task', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const text = 'Revise the pumping lemma';
  await win.evaluate((t) => window.studyat.tasks.create({ text: t, colour: 'green' }), text);
  const picker = win.getByRole('combobox', { name: 'Task' });
  await picker.click();
  await win.getByRole('option', { name: text }).click();
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).taskText).toBe(text);
  await expect(picker).toContainText(text);
  expect((await win.evaluate(() => window.studyat.timer.get())).status).toBe('idle');

  await dock(win, 'Tasks').click();
  await win.getByRole('checkbox', { name: `Mark "${text}" as done` }).click();
  // Main lets go of the done task and broadcasts it; the picker follows.
  await expect.poll(async () => (await win.evaluate(() => window.studyat.timer.get())).taskId).toBeNull();
  await expect(picker).toHaveText('No task');
  await calm(win);
  await shot(win, 'v11-final-held-task-cleared.png');
});

test('YouTube: dQw4w9WgXcQ plays, jfKfPfyJRdk cannot be embedded, starter spaces load', async ({ launch }) => {
  const online = await fetch('https://www.youtube.com/', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  test.skip(!online, 'network is down: YouTube parts skipped');
  const { win } = await launch();
  await prepare(win);
  const yt = async (id: string): Promise<void> => {
    if (!(await win.getByRole('textbox', { name: 'YouTube link' }).isVisible())) await win.keyboard.press('g');
    await win.getByRole('textbox', { name: 'YouTube link' }).fill(`https://www.youtube.com/watch?v=${id}`);
    await win.getByRole('button', { name: 'Add YouTube' }).click();
    await expect
      .poll(async () => (await win.evaluate(() => window.studyat.spaces.list())).some((s) => s.source === id))
      .toBe(true);
    const space = (await win.evaluate(() => window.studyat.spaces.list())).find((s) => s.source === id);
    if ((await win.evaluate(() => window.studyat.settings.get())).activeSpaceId !== space?.id) {
      await win.getByRole('button', { name: `Use ${space?.name}`, exact: true }).click();
    }
    expect((await win.evaluate(() => window.studyat.settings.get())).activeSpaceId).toBe(space?.id);
    await win.keyboard.press('Escape');
  };
  await yt('dQw4w9WgXcQ');
  await expect(win.locator('[data-testid="space-youtube"] iframe')).toHaveAttribute('src', /dQw4w9WgXcQ/);
  const timeIn = async (id: string): Promise<number> => {
    const frame = win.frames().find((f) => f.url().includes(id));
    if (!frame) return -1;
    return frame.evaluate(() => document.querySelector('video')?.currentTime ?? -1).catch(() => -1);
  };
  await expect.poll(() => timeIn('dQw4w9WgXcQ'), { timeout: 30_000 }).toBeGreaterThan(0.5);
  const t1 = await timeIn('dQw4w9WgXcQ');
  await sleep(3_000);
  const t2 = await timeIn('dQw4w9WgXcQ');
  expect(t2).toBeGreaterThan(t1 + 1);
  await shot(win, 'v11-youtube-dQw4w9WgXcQ-playing.png');

  await yt('jfKfPfyJRdk');
  await expect(win.locator('[data-testid="space-background"]').getByText("This video can't be embedded.")).toBeVisible({ timeout: 30_000 });
  await win.keyboard.press('g');
  await expect(win.getByText("This video can't be embedded", { exact: true })).toBeVisible();
  await shot(win, 'v11-youtube-jfKfPfyJRdk-cannot-embed.png');
  await win.keyboard.press('Escape');

  // The four starter YouTube spaces: each loads its iframe, plays and reports no error.
  const starters = (await win.evaluate(() => window.studyat.spaces.list())).filter((s) => s.builtin && s.kind === 'youtube');
  expect(starters).toHaveLength(4);
  for (const s of starters) {
    if (!(await win.getByRole('textbox', { name: 'YouTube link' }).isVisible())) await win.keyboard.press('g');
    await win.getByRole('button', { name: `Use ${s.name}`, exact: true }).click();
    await expect(win.locator('[data-testid="space-youtube"] iframe')).toHaveAttribute('src', new RegExp(s.source));
    await expect
      .poll(() => timeIn(s.source), { timeout: 30_000, message: `starter ${s.name} plays` })
      .toBeGreaterThan(0.3);
    await expect(win.locator('[data-testid="space-background"]').getByText(/This video can.t be (embedded|played)/)).toHaveCount(0);
  }
});

test('The away switch persists across a relaunch', async ({ launch, dataDir }) => {
  const first = await launch();
  await prepare(first.win);
  expect((await first.win.evaluate(() => window.studyat.settings.get())).awayPrompt).toBe(true);
  await openSettingsTimer(first.win);
  const sw = first.win.getByRole('switch', { name: "Ask if I've been away" });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(first.win.getByLabel('Away check after')).toBeDisabled();
  await expect.poll(async () => (await first.win.evaluate(() => window.studyat.settings.get())).awayPrompt).toBe(false);
  await shot(first.win, 'v11-settings-timer-away-off.png');
  await quitApp(first.app);

  const second = await launch(dataDir);
  expect((await second.win.evaluate(() => window.studyat.settings.get())).awayPrompt).toBe(false);
  await openSettingsTimer(second.win);
  await expect(second.win.getByRole('switch', { name: "Ask if I've been away" })).toHaveAttribute('aria-checked', 'false');
});

test('The Spotify widget still renders unconfigured', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await dock(win, 'Spotify').click();
  const spotify = widget(win, 'Spotify');
  await expect(spotify).toBeVisible();
  await expect(spotify.getByText('Set up Spotify in Settings')).toBeVisible();
  await expect(spotify.getByRole('button', { name: 'Open settings' })).toBeVisible();
  await calm(win);
  await shot(win, 'v11-spotify-unconfigured.png');
});
