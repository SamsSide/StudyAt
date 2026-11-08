// The timer widget's body (spec §4); the frosted frame and title come from WidgetFrame. Main owns
// the clock: this only shows `timer` from the store and sends commands (appplan §5).
import type { Mode } from '../../shared/types';
import { Icon } from '../shell/icons';
import { useStudyStore } from '../shell/store';
import { formatClock, MODE_LABEL, pauseMessage, startLabel, toggleTimer } from './format';
import { SubjectSelect } from './SubjectSelect';
import styles from './timer.module.css';

const MODES: Mode[] = ['focus', 'short', 'long'];
const DEFAULT_LONG_EVERY = 4;

export function TimerWidget() {
  const timer = useStudyStore((s) => s.timer);
  const longEvery = useStudyStore((s) => s.settings?.longEvery) ?? DEFAULT_LONG_EVERY;
  const setOverlay = useStudyStore((s) => s.setOverlay);
  const api = window.studyat.timer;
  const message = timer.status === 'paused' ? pauseMessage(timer.pauseReason) : null;

  return (
    <div className={styles.timer}>
      <div className={styles.tabs} role="tablist" aria-label="Timer mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={timer.mode === mode}
            className={styles.tab}
            onClick={() => void api.setMode(mode)}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>

      <p className={styles.clock} role="timer" aria-label={`${MODE_LABEL[timer.mode]} time remaining`}>
        {formatClock(timer.remainingMs)}
      </p>
      <p className={styles.message} role="status">
        {message}
      </p>

      <div className={styles.controls}>
        <button type="button" className={styles.primary} onClick={() => toggleTimer(timer.status)}>
          {startLabel(timer.status)}
        </button>
        <button type="button" className={styles.secondary} onClick={() => void api.reset()}>
          Reset
        </button>
        <button type="button" className={styles.secondary} onClick={() => void api.skip()}>
          Skip
        </button>
      </div>

      <div className={styles.footer}>
        <SubjectSelect />
        <span className={styles.counter} title="Pomodoros towards a long break">
          {`🍅 ${timer.completedFocusCount % longEvery}/${longEvery}`}
        </span>
        <button
          type="button"
          className={styles.gear}
          onClick={() => setOverlay('settings')}
          aria-label="Timer settings"
          title="Timer settings"
        >
          <Icon name="settings" />
        </button>
      </div>
    </div>
  );
}
