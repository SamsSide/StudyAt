// Timer modes: which count as focus, and their labels (spec §3.2).
import type { Mode } from './types';

/** Focus and countdown are both focus segments: their running time is study time (appplan §5). */
export const isFocusMode = (m: Mode): boolean => m === 'focus' || m === 'countdown';

export const MODE_LABELS: Record<Mode, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
  countdown: 'Countdown',
};
