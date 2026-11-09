// The once-only weekly recap pop-up (spec §3.5): on mount, ask main for the most recent finished
// week's recap if it hasn't been shown, show it, and tell main it has been shown so it never pops
// up again. A window left open (or hidden to the tray) across a new week asks again when it
// becomes visible or focused, at most once per study day. Returns the element for App to render,
// or null. StrictMode-safe: the double-run effect in development asks `recaps.pending()` once and
// marks a week shown once.
import { createElement, type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { dayKeyOf } from '../../core/time';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { WeeklyRecap } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { useWindowVisibility } from '../spaces/windowVisibility';
import { RecapPopup } from './RecapCard';

export function useRecapPopup(): ReactElement | null {
  const [recap, setRecap] = useState<WeeklyRecap | null>(null);
  const visible = useWindowVisibility((s) => s.visible);
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? DEFAULT_SETTINGS.rolloverHour);
  const askedOn = useRef<string | null>(null);
  const marked = useRef<string | null>(null);

  const ask = useCallback((): void => {
    const day = dayKeyOf(Date.now(), rolloverHour);
    if (askedOn.current === day) return;
    askedOn.current = day;
    // No cancel flag: StrictMode's throwaway cleanup would drop the only answer.
    window.studyat.recaps.pending().then(
      (pending) => {
        if (pending) setRecap(pending);
      },
      () => {
        askedOn.current = null; // Try again next time the window is back.
      },
    );
  }, [rolloverHour]);

  useEffect(() => {
    if (visible) ask();
  }, [visible, ask]);

  useEffect(() => {
    window.addEventListener('focus', ask);
    return () => window.removeEventListener('focus', ask);
  }, [ask]);

  useEffect(() => {
    if (!recap || marked.current === recap.weekStart) return;
    marked.current = recap.weekStart;
    // If this fails the recap simply shows again next launch.
    window.studyat.recaps.markShown(recap.weekStart).catch(() => undefined);
  }, [recap]);

  return recap ? createElement(RecapPopup, { recap, onClose: () => setRecap(null) }) : null;
}
