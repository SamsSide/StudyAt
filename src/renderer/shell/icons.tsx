// Line icons for the shell, drawn here (no icon pack to credit). 24-unit grid, 1.75 stroke.
import type { ReactNode } from 'react';
import styles from './shell.module.css';

export type IconName =
  | 'spaces'
  | 'sounds'
  | 'timer'
  | 'tasks'
  | 'spotify'
  | 'widgets'
  | 'stats'
  | 'settings'
  | 'mini'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'eyeOff'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'plus'
  | 'trash';

const PATHS: Record<IconName, ReactNode> = {
  spaces: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </>
  ),
  sounds: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M10 2h4" />
    </>
  ),
  tasks: (
    <>
      <path d="M5 4h14v11l-5 5H5z" />
      <path d="M14 20v-5h5M9 9h6M9 13h3" />
    </>
  ),
  // A plain pair of quavers: the music widget, not any brand's logo (S7).
  spotify: (
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  // Four rounded tiles, one of them a wide one: a home screen of widgets.
  widgets: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="3.5" y="13" width="17" height="7.5" rx="2" />
    </>
  ),
  stats: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  mini: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <rect x="12" y="12" width="7" height="6" rx="1" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  exitFullscreen: <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  // An eye with a stroke through it: hide the interface (focus view, spec §3.4).
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="m4 4 16 16" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4.5 7h15M10 4h4M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
