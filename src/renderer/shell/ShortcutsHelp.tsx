// The `?` sheet: every in-app shortcut of spec §3.7.
import styles from './shell.module.css';
import { SHORTCUTS } from './useShortcuts';

export function ShortcutsHelp() {
  return (
    <dl className={styles.keys}>
      {SHORTCUTS.map(({ keys, action }) => (
        <div key={keys}>
          <dt>{keys}</dt>
          <dd>{action}</dd>
        </div>
      ))}
    </dl>
  );
}
