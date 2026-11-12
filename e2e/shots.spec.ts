// The final screenshot set (task-19-extra), at 1280 x 800, on a seeded profile. Runs only when
// STUDYAT_SHOTS_DIR is set; the criterion specs add their own shots (first launch, timer running,
// mini window, spaces, sounds, tasks, stats, recap, widgets popover) in the same run.
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { VIEW, expect, prepare, quitApp, seedHistory, shot, sleep, test } from './fixtures';

const SHOTS = process.env.STUDYAT_SHOTS_DIR;
test.skip(!SHOTS, 'screenshots only: set STUDYAT_SHOTS_DIR');

const ALL = ['Timer', 'Tasks', 'Spotify', 'Calendar', 'Weather', 'Quote', 'Notes', 'Deadlines'] as const;
/** The seven widgets an old (v1.1) profile has; Deadlines came in v1.2 and starts closed. */
const OLD = ALL.filter((t) => t !== 'Deadlines');
const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();
const dock = (win: Page, label: string) =>
  win.locator('nav[aria-label="Dock"]').getByRole('button', { name: new RegExp(`^${label}`) }).first();

async function closeRecap(win: Page): Promise<void> {
  const recap = win.locator('[role="dialog"][aria-modal="true"]');
  await recap.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (await recap.isVisible()) {
    await win.keyboard.press('Escape');
    await expect(recap).toBeHidden();
  }
}

async function calm(win: Page): Promise<void> {
  await win.mouse.move(VIEW.width / 2, VIEW.height / 2);
  await sleep(600);
}

async function openAll(win: Page): Promise<void> {
  // v1.2 spec §3.1: Spotify is toggled from the Widgets popover now, with Deadlines.
  if (!(await widget(win, 'Tasks').isVisible())) await dock(win, 'Tasks').click();
  await dock(win, 'Widgets').click();
  const pop = win.getByRole('dialog', { name: 'Widgets' });
  for (const n of ['Spotify', 'Calendar', 'Weather', 'Quote', 'Notes', 'Deadlines']) {
    const sw = pop.getByRole('switch', { name: n });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  }
  await win.keyboard.press('Escape');
  for (const t of ALL) await expect(widget(win, t)).toBeVisible();
}

/** Every widget rectangle lies inside the window. */
async function widgetRects(win: Page, names: readonly string[] = ALL): Promise<Record<string, { x: number; y: number; width: number; height: number } | null>> {
  const out: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
  for (const t of names) out[t] = await widget(win, t).boundingBox();
  return out;
}

test('final screenshots: widgets, settings, help', async ({ launch, dataDir }) => {
  await seedHistory(dataDir);
  const { win } = await launch();
  await closeRecap(win);
  await prepare(win);
  await calm(win);
  await shot(win, 'main-view.png');

  await win.evaluate(async () => {
    await window.studyat.tasks.create({ title: 'Read chapter 4 of the biology notes' });
    await window.studyat.tasks.create({ title: 'Past paper Q3' });
    const notes = await window.studyat.notes.create();
    const id = notes[0]?.id;
    if (id !== undefined) await window.studyat.notes.update(id, { text: 'Ask about Q3 in office hours' });
    await window.studyat.weather.setPlace({
      name: 'London',
      latitude: 51.5072,
      longitude: -0.1276,
      country: 'United Kingdom',
      admin1: 'England',
    });
  });
  await openAll(win);
  await sleep(5_000);
  await calm(win);
  await shot(win, 'all-widgets.png');
  for (const t of ['Tasks', 'Spotify', 'Calendar', 'Weather', 'Quote', 'Notes', 'Deadlines']) {
    await widget(win, t).screenshot({ path: join(SHOTS ?? '', `widget-${t.toLowerCase()}.png`) });
  }
  const rects = await widgetRects(win);
  for (const [t, r] of Object.entries(rects)) {
    expect(r, t).not.toBeNull();
    expect(r!.x, t).toBeGreaterThanOrEqual(0);
    expect(r!.y, t).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width, t).toBeLessThanOrEqual(VIEW.width + 1);
    expect(r!.y + r!.height, t).toBeLessThanOrEqual(VIEW.height + 1);
  }

  await dock(win, 'Settings').click();
  for (const tab of ['Timer', 'Chimes', 'Calendar', 'Weather', 'Data']) {
    await win.getByRole('tab', { name: tab, exact: true }).click();
    await sleep(700);
    await shot(win, `settings-${tab.toLowerCase()}.png`);
  }
  await win.keyboard.press('Escape');
  await sleep(500);

  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await win.keyboard.press('?');
  await sleep(800);
  await shot(win, 'shortcuts-help.png');
  await win.keyboard.press('Escape');
});

test('final screenshots: a profile with old saved widget spots is clamped on screen', async ({ launch }) => {
  const first = await launch();
  await prepare(first.win);
  // The widget spots the app saved before the layout change in 7bb4aee, all open.
  await first.win.evaluate(() =>
    window.studyat.settings.set({
      widgets: {
        timer: { open: true, x: 0.5, y: 0.12, autoHide: false, scale: 1 },
        tasks: { open: true, x: 0.82, y: 0.14, autoHide: false, scale: 1 },
        spotify: { open: true, x: 0.82, y: 0.62, autoHide: false, scale: 1 },
        calendar: { open: true, x: 0.18, y: 0.62, autoHide: false, scale: 1 },
        weather: { open: true, x: 0.18, y: 0.14, autoHide: false, scale: 1 },
        quote: { open: true, x: 0.5, y: 0.86, autoHide: false, scale: 1 },
        notes: { open: true, x: 0.82, y: 0.38, autoHide: false, scale: 1 },
      },
    }),
  );
  await quitApp(first.app);

  const { win } = await launch();
  for (const t of OLD) await expect(widget(win, t)).toBeVisible();
  await sleep(2_000);
  await calm(win);
  await shot(win, 'old-widget-spots-clamped.png');
  const rects = await widgetRects(win, OLD);
  for (const [t, r] of Object.entries(rects)) {
    expect(r, t).not.toBeNull();
    expect(r!.x + r!.width, t).toBeLessThanOrEqual(VIEW.width + 1);
    expect(r!.y + r!.height, t).toBeLessThanOrEqual(VIEW.height + 1);
  }
});

test('final screenshots: the away prompt, when Windows reports the PC idle', async ({ launch }, testInfo) => {
  const { win } = await launch();
  // The shortest away check (2 min); the prompt needs real Windows idle time, so this only
  // captures it when nobody touches the PC meanwhile.
  await prepare(win);
  await win.evaluate(() => window.studyat.settings.set({ idleMinutes: 2 }));
  await win.evaluate(() => window.studyat.timer.start());
  const prompt = win.getByRole('alertdialog');
  const seen = await prompt
    .waitFor({ timeout: 170_000 })
    .then(() => true)
    .catch(() => false);
  if (!seen) {
    testInfo.annotations.push({ type: 'away', description: 'no away prompt: the PC was not idle for 2 min' });
    return;
  }
  await sleep(500);
  await shot(win, 'away-prompt.png');
  await win.evaluate(() => window.studyat.timer.answerAway('discard'));
});
