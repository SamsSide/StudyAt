// The renderer shell (spec §4): the space behind everything, the top bar, the dock, one side
// panel, the open widgets in their frames, full-window overlays, the shortcut help and the
// first-run welcome. Later tasks plug their parts in through `Registry`.
import { type ComponentType, useEffect, useState } from 'react';
import type { WidgetId } from '../../shared/types';
import { AddImageDialog } from '../images/AddImageDialog';
import { useImagesStore } from '../images/imagesStore';
import { useNotesStore } from '../notes/notesStore';
import '../styles/tokens.css';
import { Dock } from './Dock';
import { FloatingInstances } from './FloatingInstances';
import { Icon } from './icons';
import { LoadFailed } from './LoadFailed';
import { Overlay } from './Overlay';
import styles from './shell.module.css';
import { ShortcutsHelp } from './ShortcutsHelp';
import { SidePanel } from './SidePanel';
import { initStudyStore, type PanelId, useStudyStore } from './store';
import { TopBar } from './TopBar';
import { useAutoHide } from './useAutoHide';
import { useShortcuts } from './useShortcuts';
import { Welcome } from './Welcome';
import { WidgetFrame } from './WidgetFrame';

export interface Registry {
  panels: Record<PanelId, ComponentType>;
  widgets: Record<WidgetId, ComponentType>;
  overlays: Record<'stats' | 'settings', ComponentType>;
  background: ComponentType;
}

export const PANEL_TITLES: Record<PanelId, string> = { spaces: 'Spaces', sounds: 'Sounds' };
export const WIDGET_TITLES: Record<WidgetId, string> = {
  timer: 'Timer',
  tasks: 'Tasks',
  spotify: 'Spotify',
  calendar: 'Calendar',
  weather: 'Weather',
  quote: 'Quote',
  notes: 'Notes',
  deadlines: 'Deadlines',
};
const WIDGET_ORDER: readonly WidgetId[] = [
  'timer',
  'tasks',
  'spotify',
  'calendar',
  'weather',
  'quote',
  'notes',
  'deadlines',
];
const OVERLAY_TITLES = { stats: 'Stats', settings: 'Settings', help: 'Keyboard shortcuts' } as const;

const DEFAULT_AUTO_HIDE_SECONDS = 5;
/** The top-left corner, in px, where the pointer brings up "Show interface" in focus view (spec §3.4). */
const CORNER_PX = 64;

/** Focus view's way back for the mouse: a small capsule that is there only while the pointer is in
 *  the top-left corner (or while it has focus, so a keyboard user doesn't lose it mid-press). */
function ShowInterface({ onShow }: { onShow: () => void }) {
  const [inCorner, setInCorner] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => setInCorner(e.clientX < CORNER_PX && e.clientY < CORNER_PX);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  if (!inCorner && !focused) return null;
  return (
    <button
      type="button"
      className={`${styles.showInterface} ${styles.frosted}`}
      onClick={onShow}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      Show interface
    </button>
  );
}

/**
 * The Deadlines widget's bare mode (v1.2 spec §3.10): an icon in the header, as on an image
 * widget; when bare, a "Show background" text button in the floating toolbar.
 */
function BackgroundToggle({ bare }: { bare: boolean }) {
  const patchWidget = useStudyStore((s) => s.patchWidget);
  const toggle = (): void => void patchWidget('deadlines', { bare: !bare });
  if (bare) {
    return (
      <button type="button" className={styles.toolText} onClick={toggle}>
        Show background
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${styles.small}`}
      aria-label="Hide background"
      title="Hide background"
      onClick={toggle}
    >
      <Icon name="eyeOff" />
    </button>
  );
}

// Its body is a list with fields and buttons, so bare it is no drag-button (interactiveBody).
const deadlinesFrame = (bare: boolean) => ({
  chrome: bare ? ('bare' as const) : ('framed' as const),
  interactiveBody: true,
  headerExtra: <BackgroundToggle bare={bare} />,
});

export function Shell({ registry }: { registry: Registry }) {
  const settings = useStudyStore((s) => s.settings);
  const settingsFailed = useStudyStore((s) => s.settingsFailed);
  const openPanel = useStudyStore((s) => s.openPanel);
  const overlay = useStudyStore((s) => s.overlay);
  const setOverlay = useStudyStore((s) => s.setOverlay);
  const focusView = useStudyStore((s) => s.focusView);
  const setFocusView = useStudyStore((s) => s.setFocusView);

  useEffect(() => initStudyStore(), []);
  useEffect(() => void useImagesStore.getState().load(), []);
  // Popped-out notes float whether or not the Notes widget is open (v1.2 spec §3.2).
  useEffect(() => void useNotesStore.getState().load(), []);
  useShortcuts();
  const visible = useAutoHide(settings?.autoHideSeconds ?? DEFAULT_AUTO_HIDE_SECONDS);
  // An overlay always shows over everything; focus view keeps the chrome hidden whatever the mouse
  // does (spec §3.4); otherwise auto-hide decides.
  const chrome = overlay ? 'shown' : focusView ? 'hidden' : visible ? 'shown' : 'hidden';

  const Background = registry.background;
  const Panel = openPanel ? registry.panels[openPanel] : null;
  const OverlayBody = overlay && overlay !== 'help' ? registry.overlays[overlay] : null;

  return (
    <div
      className={styles.shell}
      data-testid="shell"
      data-chrome={chrome}
      data-focus-view={focusView ? 'on' : 'off'}
      data-pointer={visible ? 'active' : 'idle'}
      data-overlay={overlay ?? 'none'}
    >
      <div className={styles.background}>
        <Background />
      </div>

      {settings &&
        WIDGET_ORDER.filter((id) => settings.widgets[id].open).map((id) => {
          const Widget = registry.widgets[id];
          return (
            <WidgetFrame
              key={id}
              id={id}
              title={WIDGET_TITLES[id]}
              {...(id === 'deadlines' ? deadlinesFrame(settings.widgets.deadlines.bare === true) : {})}
            >
              <Widget />
            </WidgetFrame>
          );
        })}
      {/* Images, note stickies and the rest of the many-of-a-kind widgets float after the fixed ones. */}
      {settings && <FloatingInstances />}

      <TopBar />
      <Dock />

      {openPanel && Panel && (
        <SidePanel title={PANEL_TITLES[openPanel]}>
          <Panel />
        </SidePanel>
      )}

      {focusView && !overlay && <ShowInterface onShow={() => setFocusView(false)} />}

      {settings && !settings.onboarded && <Welcome />}
      {!settings && settingsFailed && <LoadFailed />}

      {/* Keyed so a swap (Settings to Stats with S) mounts a fresh dialog and focus moves into it. */}
      {overlay && (
        <Overlay
          key={overlay}
          title={OVERLAY_TITLES[overlay]}
          onClose={() => setOverlay(null)}
          narrow={overlay === 'help'}
        >
          {OverlayBody ? <OverlayBody /> : <ShortcutsHelp />}
        </Overlay>
      )}
      <AddImageDialog />
    </div>
  );
}
