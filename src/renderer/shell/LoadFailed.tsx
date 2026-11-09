// Shown in place of the widgets when settings couldn't be loaded at launch, even after the store's
// retries: a calm centred glass card with one fixed sentence and "Try again" (main's reason is in
// the log, ruling R38).
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function LoadFailed() {
  const retry = useStudyStore((s) => s.retrySettings);
  return (
    <section className={`${styles.loadFailed} ${styles.frosted}`} role="alert" aria-label="Settings">
      <p>StudyAt couldn&apos;t load your settings.</p>
      <button type="button" className={styles.primary} onClick={() => void retry()}>
        Try again
      </button>
    </section>
  );
}
