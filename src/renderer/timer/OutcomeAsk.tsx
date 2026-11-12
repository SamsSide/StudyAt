// "Did you do it?" (v1.2 spec §3.11): shown while main holds `askOutcome`, i.e. after a focus
// segment that had an intention, until answered, skipped or the next focus starts.
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { SessionOutcome } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

const ANSWERS: { outcome: SessionOutcome; label: string }[] = [
  { outcome: 'done', label: 'Done' },
  { outcome: 'partly', label: 'Partly' },
  { outcome: 'not', label: 'Not' },
];

export function OutcomeAsk() {
  const ask = useStudyStore((s) => s.timer.askOutcome);
  const enabled = useStudyStore((s) => s.settings?.sessionIntention ?? DEFAULT_SETTINGS.sessionIntention);
  if (!ask || !enabled) return null;
  const answer = (outcome: SessionOutcome | null): void => {
    void window.studyat.timer.setOutcome(ask.pomodoroId, outcome).catch(() => undefined);
  };
  return (
    <div className={styles.outcome} role="group" aria-label="Did you do it?">
      <p className={styles.outcomeIntention}>{ask.intention}</p>
      <div className={styles.outcomeRow}>
        <span className={styles.outcomeQuestion}>Did you do it?</span>
        {ANSWERS.map((a) => (
          <button key={a.outcome} type="button" className={styles.outcomeButton} onClick={() => answer(a.outcome)}>
            {a.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.linkButton}
          aria-label="Skip the question"
          onClick={() => answer(null)}>
          Skip
        </button>
      </div>
    </div>
  );
}
