// Line icons for notes' own buttons (pop out, dock back), drawn like the shell's icons:
// 24-unit grid, 1.75 stroke, no icon pack to credit.
import type { ReactNode } from 'react';
import shell from '../shell/shell.module.css';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className={shell.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A sheet with an arrow leaving its top-right corner. */
export function PopOutIcon() {
  return (
    <Svg>
      <path d="M13 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V11" />
      <path d="M15 4h5v5M20 4l-8 8" />
    </Svg>
  );
}

/** An arrow going back into a tray. */
export function DockBackIcon() {
  return (
    <Svg>
      <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    </Svg>
  );
}
