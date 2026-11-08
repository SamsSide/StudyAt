// What a Stats section shows when main couldn't answer: a short, kind line and a way to ask again.
import styles from './stats.module.css';

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.loadError}>
      <p className={styles.muted}>{message}</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
