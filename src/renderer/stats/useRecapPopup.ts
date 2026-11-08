// The once-only weekly recap pop-up (spec §3.5): on mount, ask main for the most recent finished
// week's recap if it hasn't been shown, show it, and tell main it has been shown so it never pops
// up again. Returns the element for App to render, or null. StrictMode-safe: the double-run
// effect in development asks `recaps.pending()` once and marks a week shown once.
import { createElement, type ReactElement, useEffect, useRef, useState } from 'react';
import type { WeeklyRecap } from '../../shared/types';
import { RecapPopup } from './RecapCard';

export function useRecapPopup(): ReactElement | null {
  const [recap, setRecap] = useState<WeeklyRecap | null>(null);
  const asked = useRef(false);
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // No cancel flag: StrictMode's throwaway cleanup would drop the only answer.
    window.studyat.recaps.pending().then(
      (pending) => {
        if (pending) setRecap(pending);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!recap || marked.current === recap.weekStart) return;
    marked.current = recap.weekStart;
    // If this fails the recap simply shows again next launch.
    window.studyat.recaps.markShown(recap.weekStart).catch(() => undefined);
  }, [recap]);

  return recap ? createElement(RecapPopup, { recap, onClose: () => setRecap(null) }) : null;
}
