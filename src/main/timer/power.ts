// Wires Electron's powerMonitor to the timer (spec §3.4 rules 3–4): suspend and lock pause it with
// their reason; resume and unlock leave it paused until Sam resumes.
import type { PowerMonitor } from 'electron';
import type { TimerController } from './controller';

type PowerEvents = Pick<PowerMonitor, 'on' | 'removeListener'>;

/** Subscribes `c` to suspend, resume, lock and unlock; returns the unsubscribe. */
export function wirePower(pm: PowerEvents, c: TimerController): () => void {
  const onSuspend = () => c.onSuspend();
  const onResume = () => c.onResume();
  const onLock = () => c.onLock();
  const onUnlock = () => c.onUnlock();
  pm.on('suspend', onSuspend);
  pm.on('resume', onResume);
  pm.on('lock-screen', onLock);
  pm.on('unlock-screen', onUnlock);
  return () => {
    pm.removeListener('suspend', onSuspend);
    pm.removeListener('resume', onResume);
    pm.removeListener('lock-screen', onLock);
    pm.removeListener('unlock-screen', onUnlock);
  };
}

/** The `idleSeconds` dependency of the controller. */
export function systemIdleSeconds(pm: Pick<PowerMonitor, 'getSystemIdleTime'>): () => number {
  return () => pm.getSystemIdleTime();
}
