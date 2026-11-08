// The timer's clock text (spec §4). Remaining time rounds up to the next whole second so the
// display never reads 00:00 while a moment is left.
import type { Mode, PauseReason, TimerStatus } from '../../shared/types';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `25:00`, or `1:02:05` from an hour up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const MODE_LABEL: Record<Mode, string> = {
  focus: 'Pomodoro',
  short: 'Short break',
  long: 'Long break',
};

/** Spec §3.4 rule 3: why the timer is paused, when the system did it. */
export function pauseMessage(reason: PauseReason): string | null {
  if (reason === 'suspend') return 'Paused while your PC was asleep';
  if (reason === 'lock') return 'Paused while your PC was locked';
  return null;
}

/** The start button's label for a timer status. */
export function startLabel(status: TimerStatus): string {
  return status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start';
}

/** Starts, pauses or resumes, whichever the status calls for. */
export function toggleTimer(status: TimerStatus): void {
  const t = window.studyat.timer;
  void (status === 'running' ? t.pause() : status === 'paused' ? t.resume() : t.start());
}
