// The one-time welcome card (spec §4, F8), shown until "Got it" sets `onboarded`: centred below
// the timer, a glyph, the spec's sentence and one button.
import { Icon } from './icons';
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function Welcome() {
  const updateSettings = useStudyStore((s) => s.updateSettings);
  return (
    <section className={`${styles.welcome} ${styles.frosted}`} aria-label="Welcome">
      <span className={styles.welcomeGlyph} aria-hidden="true">
        <Icon name="timer" />
      </span>
      <p>Welcome to StudyAt — pick a space, start a Pomodoro, and your study time is tracked from here.</p>
      <button
        type="button"
        className={styles.primary}
        onClick={() => void updateSettings({ onboarded: true })}
      >
        Got it
      </button>
    </section>
  );
}
