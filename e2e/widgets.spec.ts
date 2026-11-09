// Task 19 extra (widgets addendum): Calendar, Weather, Quote and Notes open from the Widgets
// popover; unconfigured Weather and Calendar say so; Quote shows a quote; a note's text survives a
// relaunch. Weather is then pointed at London live: a temperature, or the stale/error copy offline,
// never a crash.
import type { Page } from '@playwright/test';
import { expect, prepare, quitApp, shot, sleep, test } from './fixtures';

const NOTE = 'Persistence check: revise Turing machines before Friday';
const NEW_WIDGETS = ['Calendar', 'Weather', 'Quote', 'Notes'] as const;

const widget = (win: Page, title: string) => win.locator(`[role="group"][aria-label="${title}"]`).first();

async function openFromPopover(win: Page, names: readonly string[]): Promise<void> {
  await win.locator('nav[aria-label="Dock"]').getByRole('button', { name: /^Widgets/ }).click();
  const pop = win.getByRole('dialog', { name: 'Widgets' });
  await expect(pop).toBeVisible();
  for (const n of names) {
    const sw = pop.getByRole('switch', { name: n });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
  }
  await shot(win, 'widgets-popover.png');
  await win.keyboard.press('Escape');
  await expect(pop).toBeHidden();
}

test('the four new widgets open and a note persists across a relaunch', async ({ launch }, testInfo) => {
  const first = await launch();
  const win = first.win;
  await prepare(win);
  await openFromPopover(win, NEW_WIDGETS);
  for (const n of NEW_WIDGETS) await expect(widget(win, n)).toBeVisible();

  await expect(widget(win, 'Weather')).toContainText('Choose your location in Settings');
  await expect(widget(win, 'Calendar')).toContainText('Add your Google Calendar in Settings');
  await expect.poll(async () => (await widget(win, 'Quote').innerText()).trim().length).toBeGreaterThan(10);

  const notes = widget(win, 'Notes');
  if ((await notes.locator('textarea').count()) === 0) await notes.getByRole('button', { name: 'New note' }).click();
  await notes.locator('textarea').first().fill(NOTE);
  await sleep(1_000);
  // Provenance: main stored it.
  await expect.poll(async () => (await win.evaluate(() => window.studyat.notes.list())).map((n) => n.text)).toContain(NOTE);

  // Optional live check: London. A temperature, or the stale/error copy if offline.
  await win.evaluate(() =>
    window.studyat.weather.setPlace({
      name: 'London',
      latitude: 51.5072,
      longitude: -0.1276,
      country: 'United Kingdom',
      admin1: 'England',
    }),
  );
  const weather = widget(win, 'Weather');
  await expect(weather).not.toContainText('Choose your location in Settings', { timeout: 20_000 });
  let text = '';
  for (let i = 0; i < 40 && !/\d+\s*°/.test(text); i++) {
    text = await weather.innerText();
    await sleep(500);
  }
  testInfo.annotations.push({ type: 'weather', description: text.replace(/\s+/g, ' ').slice(0, 200) });
  expect(/\d+\s*°/.test(text) || /couldn|offline|try again|updated/i.test(text)).toBe(true);
  await quitApp(first.app);

  const second = await launch();
  const notes2 = widget(second.win, 'Notes');
  // The widget stays open across launches; reopen it if this build doesn't.
  if (!(await notes2.isVisible())) await openFromPopover(second.win, ['Notes']);
  await expect(notes2.locator('textarea').first()).toHaveValue(NOTE);
  const stored = await second.win.evaluate(() => window.studyat.notes.list());
  expect(stored.map((n) => n.text)).toContain(NOTE);
});
