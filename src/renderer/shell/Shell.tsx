// The renderer shell (spec §4): the space behind everything, the top bar, the dock, one side
// panel, the open widgets in their frames, full-window overlays, the shortcut help and the
// first-run welcome. Later tasks plug their parts in through `Registry`.
import { type ComponentType, useEffect } from 'react';
import type { WidgetId } from '../../shared/types';
import '../styles/tokens.css';
import { Dock } from './Dock';
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
};
const WIDGET_ORDER: readonly WidgetId[] = ['timer', 'tasks', 'spotify', 'calendar', 'weather', 'quote', 'notes'];
const OVERLAY_TITLES = { stats: 'Stats', settings: 'Settings', help: 'Keyboard shortcuts' } as const;

const DEFAULT_AUTO_HIDE_SECONDS = 5;

export function Shell({ registry }: { registry: Registry }) {
  const settings = useStudyStore((s) => s.settings);
  const openPanel = useStudyStore((s) => s.openPanel);
  const overlay = useStudyStore((s) => s.overlay);
  const setOverlay = useStudyStore((s) => s.setOverlay);

  useEffect(() => initStudyStore(), []);
  useShortcuts();
  const visible = useAutoHide(settings?.autoHideSeconds ?? DEFAULT_AUTO_HIDE_SECONDS);

  const Background = registry.background;
  const Panel = openPanel ? registry.panels[openPanel] : null;
  const OverlayBody = overlay && overlay !== 'help' ? registry.overlays[overlay] : null;

  return (
    <div
      className={styles.shell}
      data-testid="shell"
      data-chrome={visible || overlay ? 'shown' : 'hidden'}
      data-overlay={overlay ?? 'none'}
    >
      <div className={styles.background}>
        <Background />
      </div>

      {settings &&
        WIDGET_ORDER.filter((id) => settings.widgets[id].open).map((id) => {
          const Widget = registry.widgets[id];
          return (
            <WidgetFrame key={id} id={id} title={WIDGET_TITLES[id]}>
              <Widget />
            </WidgetFrame>
          );
        })}

      <TopBar />
      <Dock />

      {openPanel && Panel && (
        <SidePanel title={PANEL_TITLES[openPanel]}>
          <Panel />
        </SidePanel>
      )}

      {settings && !settings.onboarded && <Welcome />}

      {overlay && (
        <Overlay title={OVERLAY_TITLES[overlay]} onClose={() => setOverlay(null)} narrow={overlay === 'help'}>
          {OverlayBody ? <OverlayBody /> : <ShortcutsHelp />}
        </Overlay>
      )}
    </div>
  );
}
