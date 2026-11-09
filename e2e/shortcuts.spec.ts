// Spec §9 criterion 15: Space and the global hotkey toggle the timer.
// Playwright can't press a global hotkey, so the hotkey is pressed as real Windows input: a
// PowerShell keybd_event of Ctrl+Alt+P, which RegisterHotKey sees like a keyboard. Registration is
// asserted first with globalShortcut.isRegistered; off Windows, or if the press doesn't reach the
// app, the test says which in its annotations.
import { execFileSync } from 'node:child_process';
import { expect, prepare, sleep, test } from './fixtures';

const HOTKEY = 'Ctrl+Alt+P';

/** Ctrl down, Alt down, P down/up, Alt up, Ctrl up, through user32 keybd_event. */
function pressCtrlAltP(): void {
  const script = [
    "$sig = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);'",
    '$k = Add-Type -MemberDefinition $sig -Name K -Namespace StudyAtE2E -PassThru',
    '$k::keybd_event(0x11, 0, 0, [System.UIntPtr]::Zero)',
    '$k::keybd_event(0x12, 0, 0, [System.UIntPtr]::Zero)',
    '$k::keybd_event(0x50, 0, 0, [System.UIntPtr]::Zero)',
    '$k::keybd_event(0x50, 0, 2, [System.UIntPtr]::Zero)',
    '$k::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero)',
    '$k::keybd_event(0x11, 0, 2, [System.UIntPtr]::Zero)',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
}

test('Space toggles the timer', async ({ launch }) => {
  const { win } = await launch();
  await prepare(win);
  const status = async (): Promise<string> => (await win.evaluate(() => window.studyat.timer.get())).status;
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await win.keyboard.press('Space');
  await expect.poll(status).toBe('running');
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await win.keyboard.press('Space');
  await expect.poll(status).toBe('paused');
});

test('the global hotkey is registered and toggles the timer', async ({ launch }, testInfo) => {
  const { app, win } = await launch();
  await prepare(win);
  const registered = await app.evaluate(({ globalShortcut }, accel) => globalShortcut.isRegistered(accel), HOTKEY);
  expect(registered, `${HOTKEY} should be registered (is another StudyAt running?)`).toBe(true);
  test.skip(process.platform !== 'win32', 'the hotkey press needs Windows input');

  const status = async (): Promise<string> => (await win.evaluate(() => window.studyat.timer.get())).status;
  expect(await status()).toBe('idle');
  pressCtrlAltP();
  await expect.poll(status, { timeout: 10_000 }).toBe('running');
  await sleep(600); // past the 400 ms repeat gap (PRESS_GAP_MS)
  pressCtrlAltP();
  await expect.poll(status, { timeout: 10_000 }).toBe('paused');
  testInfo.annotations.push({ type: 'hotkey', description: 'pressed as Windows input via keybd_event' });
});
