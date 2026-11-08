// Pushes from main that the renderer mirrors into its stores: whether the main window is on
// screen (the space pauses while hidden or minimised, spec §3.8 — `document.hidden` can't tell,
// because the window runs with `backgroundThrottling: false`) and whether the mini timer is
// showing (spec §3.7), so the top bar and timer widget toggles stay truthful whoever moved it.
import { useEffect } from 'react';
import { useStudyStore } from './shell/store';
import { useWindowVisibility } from './spaces/windowVisibility';

export function useAppBridge(): void {
  useEffect(() => {
    const app = window.studyat.app;
    const offVisibility = app.onVisibility((visible) => useWindowVisibility.getState().setVisible(visible));
    const offMini = app.onMini((shown) => useStudyStore.setState({ miniShown: shown }));
    return () => {
      offVisibility();
      offMini();
    };
  }, []);
}
