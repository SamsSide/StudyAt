// The 360 px side panel beside the dock (spec §4), holding Spaces or Sounds. Esc closes it once
// no overlay is open (useShortcuts).
import type { ReactNode } from 'react';
import { Icon } from './icons';
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function SidePanel({ title, children }: { title: string; children: ReactNode }) {
  const setPanel = useStudyStore((s) => s.setPanel);
  return (
    <aside className={`${styles.sidePanel} ${styles.frosted} ${styles.fades}`} aria-label={title}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.small}`}
          onClick={() => setPanel(null)}
          aria-label={`Close ${title}`}
          title="Close (Esc)"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
