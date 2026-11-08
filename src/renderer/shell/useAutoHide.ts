// Auto-hide (spec §3.7): the chrome fades after `seconds` without mouse movement and any mouse
// move or key brings it back. 0 seconds means never hide.
import { useEffect, useState } from 'react';

const WAKE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;

export function useAutoHide(seconds: number): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    let timeout = window.setTimeout(() => setHidden(true), seconds * 1000);
    const wake = (): void => {
      setHidden(false);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setHidden(true), seconds * 1000);
    };
    for (const name of WAKE_EVENTS) window.addEventListener(name, wake, { passive: true });
    return () => {
      window.clearTimeout(timeout);
      for (const name of WAKE_EVENTS) window.removeEventListener(name, wake);
    };
  }, [seconds]);

  return seconds <= 0 || !hidden;
}
