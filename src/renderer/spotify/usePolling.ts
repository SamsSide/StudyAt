// Runs `fn` now and then every `ms`, but only while `enabled` and the window is on screen (spec §3.10:
// Spotify polls only while the widget is open and the window shown; Calendar and Weather share it).
// The window runs with `backgroundThrottling: false`, so `document.hidden` stays false when it is
// minimised or hidden to the tray; main's report (`useWindowVisibility`) is what says so. Either
// one saying hidden stops the timer; being shown again polls at once, then on the interval.
import { useEffect, useRef } from 'react';
import { useWindowVisibility } from '../spaces/windowVisibility';

const onScreen = (): boolean => useWindowVisibility.getState().visible && !document.hidden;

export function usePolling(fn: () => void | Promise<void>, ms: number, enabled: boolean): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      void Promise.resolve(latest.current()).catch(() => undefined);
    };
    const start = () => {
      if (timer !== null) return;
      run();
      timer = setInterval(run, ms);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const sync = () => (onScreen() ? start() : stop());

    sync();
    document.addEventListener('visibilitychange', sync);
    const unsubscribe = useWindowVisibility.subscribe(sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      unsubscribe();
      stop();
    };
  }, [ms, enabled]);
}
