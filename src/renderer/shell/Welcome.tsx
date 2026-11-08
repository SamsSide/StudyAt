// The one-time welcome card (spec §4), shown until "Got it" sets `onboarded`.
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function Welcome() {
  const updateSettings = useStudyStore((s) => s.updateSettings);
  return (
    <section className={`${styles.welcome} ${styles.frosted}`} aria-label="Welcome">
      <p>Welcome to StudyAt — pick a space, start a Pomodoro, and your study time is tracked from here.</p>
      <button type="button" className={styles.primary} onClick={() => void updateSettings({ onboarded: true })}>
        Got it
      </button>
    </section>
  );
}
