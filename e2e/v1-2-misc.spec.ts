// v1.2 end to end, part C (simple-tasks plan, Task 4): the v5 migration on a real v4 file, the
// removals (no B key, no Settings -> Tasks, no Estimates card) and the two planner-era checks that
// survive: pop-ups over another widget, and the YouTube Auto badge. Every test launches the BUILT
// app on a throwaway STUDYAT_USER_DATA (the fixtures).
import type { Locator, Page } from '@playwright/test';
import initSqlJs from 'sql.js';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS, migrate } from '../src/main/db/migrations';
import { SEED_SUBJECTS } from '../src/shared/subjects';
import { DB_NAME, expect, prepare, queryDb, quitApp, shot, sleep, test, WASM } from './fixtures';

/** Task 1's spike video: it has a 2160p stream (task-1-report.md). */
const VIDEO_4K = 'LXb3EKWsInQ';

const dock = (win: Page, label: string) =>
  win.locator('nav[aria-label="Dock"]').getByRole('button', { name: new RegExp(`^${label}`) }).first();
const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();

async function calm(win: Page): Promise<void> {
  await win.mouse.move(640, 790);
  await sleep(400);
}

async function reload(win: Page): Promise<void> {
  await win.reload();
  await win.locator('[data-testid="shell"]').waitFor({ timeout: 30_000 });
  await sleep(800);
}

test('pop-ups over another widget: the timer task picker and the stats menu are opaque and on top', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await win.evaluate(async () => {
    for (const text of ['Lecture 5 notes', 'Problem sheet 5', 'Lab 4 write-up', 'Read chapter 3']) {
      await window.studyat.tasks.create({ text, colour: 'yellow' });
    }
  });
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

test('migration: a v4 database opens at schema 5 with a backup, stickies back and the planner archived', async ({ launch, dataDir }) => {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const raw = new SQL.Database();
  const now = Date.now();
  await migrate(raw, null, now, MIGRATIONS.filter((m) => m.version <= 4));
  SEED_SUBJECTS.forEach((s, i) => raw.run('INSERT INTO subjects (name, colour, archived, sort) VALUES (?, ?, 0, ?)', [s.name, s.colour, i]));
  // v4 left the v1 stickies in tasks_v1_archive: one old sticky, and one planner task.
  raw.run('INSERT INTO tasks_v1_archive (text, colour, done, sort, created_at) VALUES (?, ?, 0, 0, ?)', ['Old sticky', 'yellow', now]);
  raw.run("INSERT INTO tasks (title, day, sort, created_at, updated_at) VALUES (?, '2026-11-13', 0, ?, ?)", ['Planner task', now, now]);
  raw.run("INSERT INTO settings (key, value) VALUES ('onboarded', 'true')");
  raw.run("INSERT INTO settings (key, value) VALUES ('idleMinutes', '60')");
  writeFileSync(join(dataDir, DB_NAME), raw.export());
  raw.close();
  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '4' }]);

  const { app, win } = await launch();
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await win.keyboard.press('t');
  const items = win.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Old sticky');
  await expect(items.nth(1)).toContainText('Planner task');
  // Provenance: the migration ran (schema, backup, archive), not just a widget rendering.
  expect(await quitApp(app)).toBe(0);
  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '5' }]);
  expect(readdirSync(join(dataDir, 'backups')).filter((f) => /^pre-migration-v4-.*\.sqlite$/.test(f))).toHaveLength(1);
  expect(await queryDb(dataDir, 'SELECT count(*) AS n FROM planner_tasks_v4_archive')).toEqual([{ n: 1 }]);
  expect(await queryDb(dataDir, 'SELECT text FROM tasks ORDER BY sort')).toEqual([{ text: 'Old sticky' }, { text: 'Planner task' }]);
});

test('B opens nothing, Settings has no Tasks section, the Widgets popover has no Estimates', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const boardKey = 'b'; // the retired board key
  await win.keyboard.press(boardKey);
  await sleep(500);
  await expect(win.getByRole('dialog')).toHaveCount(0);

  await dock(win, 'Settings').click();
  await expect(win.getByRole('tab', { name: 'Timer' })).toBeVisible();
  await expect(win.getByRole('tab', { name: 'Tasks' })).toHaveCount(0);
  await win.keyboard.press('Escape');

  await dock(win, 'Widgets').click();
  await win.getByRole('dialog', { name: 'Widgets' }).getByRole('button', { name: 'Add stats widget…' }).click();
  const card = win.locator('[role="group"]').filter({ has: win.getByRole('button', { name: 'Stats widget menu' }) }).first();
  await card.getByRole('button', { name: 'Stats widget menu' }).click();
  await expect(win.getByRole('menuitemradio', { name: 'By subject' })).toBeVisible();
  await expect(win.getByRole('menuitemradio', { name: 'Estimates' })).toHaveCount(0);
  await win.keyboard.press('Escape');
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
