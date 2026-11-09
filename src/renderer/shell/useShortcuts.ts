// In-app shortcuts (spec §3.7, plus W for the Widgets popover from widgets addendum §1, and H for
// focus view and 4 for Countdown from the v1.1 polish spec §3.2 and §3.4). Ignored
// while typing in an input, textarea, select or contenteditable, and when a modifier is held. While
// an overlay is open only Esc, ? and S act. In focus view W, K, G (and T on an auto-hide Tasks
// widget) leave it, so what they open is visible. Space is also left alone on buttons and other
// controls, where it already means "press this".
import { useEffect } from 'react';
import type { Mode } from '../../shared/types';
import { useStudyStore } from './store';

/** The help sheet's rows, in spec §3.7 order. */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Start or pause the timer' },
  { keys: 'R', action: 'Reset the timer' },
  { keys: 'N', action: 'Skip to the next session' },
  { keys: '1 / 2 / 3', action: 'Pomodoro, short break, long break' },
  { keys: '4', action: 'Countdown' },
  { keys: 'S', action: 'Stats' },
  { keys: 'T', action: 'Show or hide tasks' },
  { keys: 'W', action: 'Widgets' },
  { keys: 'K', action: 'Sounds' },
  { keys: 'G', action: 'Spaces' },
  { keys: 'M', action: 'Mini timer' },
  { keys: 'F', action: 'Full screen' },
  { keys: 'H', action: 'Hide or show the interface' },
  { keys: 'Esc', action: 'Close the top window or panel' },
  { keys: '?', action: 'This list' },
];

const MODE_KEYS: Record<string, Mode> = { '1': 'focus', '2': 'short', '3': 'long', '4': 'countdown' };

const CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'switch',
  'tab',
  'menuitem',
  'option',
  'radio',
  'slider',
  'link',
]);

const isTyping = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.closest('[contenteditable="true"], [contenteditable=""]')) return true;
  return (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  );
};

const isControl = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.tagName === 'SUMMARY')
    return true;
  const role = el.getAttribute('role');
  return role !== null && CONTROL_ROLES.has(role);
};

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : document.activeElement;
      const store = useStudyStore.getState();
      const studyat = window.studyat;

      // Esc works from anywhere, inputs included: close the Widgets popover first, then the top
      // overlay; with no overlay open it leaves focus view (spec §3.4) and an open panel just shows
      // again; only then does it close the panel.
      if (e.key === 'Escape') {
        if (store.widgetsPopover) store.setWidgetsPopover(false);
        else if (store.overlay) store.setOverlay(null);
        else if (store.focusView) store.setFocusView(false);
        else if (store.openPanel) store.setPanel(null);
        else return;
        e.preventDefault();
        return;
      }
      if (isTyping(target)) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Behind a modal overlay only the overlay keys act: ? and S swap what is on top, and nothing
      // reaches the timer or the panels unseen.
      if (store.overlay && key !== '?' && key !== 's') return;
      const mode = MODE_KEYS[key];
      if (mode) {
        void studyat.timer.setMode(mode);
      } else if (key === ' ') {
        if (isControl(target)) return;
        const { status } = store.timer;
        if (status === 'idle') void studyat.timer.start();
        else if (status === 'running') void studyat.timer.pause();
        else void studyat.timer.resume();
      } else if (key === 'r') void studyat.timer.reset();
      else if (key === 'n') void studyat.timer.skip();
      else if (key === 's') store.toggleOverlay('stats');
      else if (key === 't') {
        // An auto-hide Tasks widget is hidden in focus view, so T leaves focus view and opens it;
        // one that doesn't auto-hide is already visible and just toggles.
        const tasks = store.settings?.widgets.tasks;
        if (store.focusView && tasks?.autoHide) {
          store.setFocusView(false);
          if (!tasks.open) void store.toggleWidget('tasks');
        } else void store.toggleWidget('tasks');
      }
      // In focus view the popover and panels would open hidden, so W, K and G leave focus view and
      // then open their target (spec §3.4: shortcuts still work in focus view).
      else if (key === 'w') {
        if (store.focusView) {
          store.setFocusView(false);
          store.setWidgetsPopover(true);
        } else store.toggleWidgetsPopover();
      } else if (key === 'k' || key === 'g') {
        const panel = key === 'k' ? 'sounds' : 'spaces';
        if (store.focusView) {
          store.setFocusView(false);
          store.setPanel(panel);
        } else store.togglePanel(panel);
      } else if (key === 'm') void store.toggleMini();
      else if (key === 'f') void studyat.app.toggleFullscreen();
      else if (key === 'h') store.toggleFocusView();
      else if (key === '?') store.toggleOverlay('help');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
