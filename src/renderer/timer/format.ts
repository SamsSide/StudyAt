// The timer's labels and commands (spec §4). The clock text lives in shared/clock so main's
// window title and tray format it the same way.
import type { Mode, PauseReason, TimerStatus } from '../../shared/types';

export { formatClock } from '../../shared/clock';

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
