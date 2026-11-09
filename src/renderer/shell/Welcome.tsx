// The one-time welcome card (spec §4, F8), shown until "Got it" sets `onboarded`: centred below
// the timer, a glyph, the spec's sentence and one button. If the save fails the card stays and
// says so in a fixed line (main's reason goes to the log, ruling R38).
import { useState } from 'react';
import { logIpcError } from '../lib/ipcError';
import { Icon } from './icons';
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function Welcome() {
  const updateSettings = useStudyStore((s) => s.updateSettings);
  const [failed, setFailed] = useState(false);

  const done = async (): Promise<void> => {
    setFailed(false);
    try {
      await updateSettings({ onboarded: true });
    } catch (err) {
      logIpcError('Saving the welcome failed', err);
      setFailed(true);
    }
  };

  return (
    <section className={`${styles.welcome} ${styles.frosted}`} aria-label="Welcome">
      <span className={styles.welcomeGlyph} aria-hidden="true">
        <Icon name="timer" />
      </span>
      <p>Welcome to StudyAt — pick a space, start a Pomodoro, and your study time is tracked from here.</p>
      <button type="button" className={styles.primary} onClick={() => void done()}>
        Got it
      </button>
      {failed && (
        <p role="alert" className={styles.failure}>
          Couldn&apos;t save that. Please try again.
        </p>
      )}
    </section>
  );
}
