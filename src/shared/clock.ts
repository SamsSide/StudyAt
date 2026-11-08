// The timer's clock text, shared so the widget, the mini timer, the window title and the tray all
// read the same (spec §3.7, §4). Remaining time rounds up to the next whole second so the display
// never reads 00:00 while a moment is left.

const pad = (n: number): string => String(n).padStart(2, '0');

/** `25:00`, or `1:02:05` from an hour up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
