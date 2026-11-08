// Runs `fn` now and then every `ms`, but only while `enabled` and the window is visible
// (spec §3.10: Spotify polls only while the widget is open and the window shown).
import { useEffect, useRef } from 'react';

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
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [ms, enabled]);
}
