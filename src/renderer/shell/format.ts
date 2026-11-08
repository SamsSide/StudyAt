// Display formatting for durations main has already computed. Minutes are floored: the app never
// shows more study time than was recorded (appplan §5).
const MINUTE = 60_000;

const split = (ms: number): { h: number; m: number } => {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
};

/** `2h 05m`: the top bar's today figure (spec §4). */
export function formatHm(ms: number): string {
  const { h, m } = split(ms);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** A goal length: `3h`, `1h 30m`, `45m`. */
export function formatGoal(ms: number): string {
  const { h, m } = split(ms);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Goal ring tooltip, spec §3.14 verbatim: "{h}h {m}m of {goal} today". */
export function goalTooltip(todayMs: number, goalMs: number): string {
  const { h, m } = split(todayMs);
  return `${h}h ${m}m of ${formatGoal(goalMs)} today`;
}
