// The dock on the left (spec §4): icon + label for Spaces, Sounds, Timer, Tasks, Spotify, Widgets,
// Stats and Settings. Spaces/Sounds open the side panel, Timer/Tasks/Spotify toggle their widgets,
// Widgets opens a popover of the other widgets' switches (widgets addendum §1), and Stats and
// Settings open full-window overlays. Each item is a glass tile that lifts on hover, with
// a small dot beside it while its panel, widget or overlay is open.
import { useCallback, useId, useRef } from 'react';
import type { WidgetId } from '../../shared/types';
import { Icon, type IconName } from './icons';
import styles from './shell.module.css';
import { type OverlayId, type PanelId, useStudyStore } from './store';
import { WidgetsPopover } from './WidgetsPopover';

type DockItem =
  | { kind: 'panel'; id: PanelId; label: string; icon: IconName; key: string }
  | { kind: 'widget'; id: WidgetId; label: string; icon: IconName; key?: string }
  | { kind: 'popover'; id: 'widgets'; label: string; icon: IconName; key: string }
  | { kind: 'overlay'; id: Exclude<OverlayId, 'help'>; label: string; icon: IconName; key?: string };

const ITEMS: readonly DockItem[] = [
  { kind: 'panel', id: 'spaces', label: 'Spaces', icon: 'spaces', key: 'G' },
  { kind: 'panel', id: 'sounds', label: 'Sounds', icon: 'sounds', key: 'K' },
  { kind: 'widget', id: 'timer', label: 'Timer', icon: 'timer' },
  { kind: 'widget', id: 'tasks', label: 'Tasks', icon: 'tasks', key: 'T' },
  { kind: 'widget', id: 'spotify', label: 'Spotify', icon: 'spotify' },
  { kind: 'popover', id: 'widgets', label: 'Widgets', icon: 'widgets', key: 'W' },
  { kind: 'overlay', id: 'stats', label: 'Stats', icon: 'stats', key: 'S' },
  { kind: 'overlay', id: 'settings', label: 'Settings', icon: 'settings' },
];

export function Dock() {
  const openPanel = useStudyStore((s) => s.openPanel);
  const overlay = useStudyStore((s) => s.overlay);
  const widgets = useStudyStore((s) => s.settings?.widgets);
  const togglePanel = useStudyStore((s) => s.togglePanel);
  const toggleWidget = useStudyStore((s) => s.toggleWidget);
  const setOverlay = useStudyStore((s) => s.setOverlay);
  const popoverOpen = useStudyStore((s) => s.widgetsPopover);
  const setWidgetsPopover = useStudyStore((s) => s.setWidgetsPopover);
  const toggleWidgetsPopover = useStudyStore((s) => s.toggleWidgetsPopover);
  const widgetsButton = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const closePopover = useCallback(() => setWidgetsPopover(false), [setWidgetsPopover]);

  const stateProps = (item: DockItem) => {
    if (item.kind === 'panel')
      return { 'aria-expanded': openPanel === item.id, onClick: () => togglePanel(item.id) };
    if (item.kind === 'widget')
      return { 'aria-pressed': widgets?.[item.id].open ?? false, onClick: () => void toggleWidget(item.id) };
    if (item.kind === 'popover')
      return {
        ref: widgetsButton,
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': popoverOpen,
        'aria-controls': popoverOpen ? popoverId : undefined,
        onClick: toggleWidgetsPopover,
      };
    return {
      'aria-current': overlay === item.id ? ('page' as const) : undefined,
      onClick: () => setOverlay(item.id),
    };
  };

  return (
    <>
      <nav className={`${styles.dock} ${styles.frosted} ${styles.fades}`} aria-label="Dock">
        <ul className={styles.dockList}>
          {ITEMS.map((item) => (
            <li key={item.id}>
              {item.kind === 'overlay' && item.id === 'stats' && (
                <div className={styles.dockDivider} aria-hidden="true" />
              )}
              <button
                type="button"
                className={`${styles.iconButton} ${styles.dockItem}`}
                title={item.key ? `${item.label} (${item.key})` : item.label}
                {...stateProps(item)}
              >
                <span className={styles.dockDot} aria-hidden="true" />
                <span className={styles.dockIcon} aria-hidden="true">
                  <Icon name={item.icon} />
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {popoverOpen && <WidgetsPopover id={popoverId} anchor={widgetsButton} onClose={closePopover} />}
    </>
  );
}
