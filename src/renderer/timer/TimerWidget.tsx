// The timer widget's body (spec §4); the frosted frame and title come from WidgetFrame. Main owns
// the clock: this only shows `timer` from the store and sends commands (appplan §5).
import { type KeyboardEvent, useRef } from 'react';
import type { Mode } from '../../shared/types';
import { Icon } from '../shell/icons';
import { useStudyStore } from '../shell/store';
import { formatClock, MODE_LABEL, pauseMessage, startLabel, toggleTimer } from './format';
import { SubjectSelect } from './SubjectSelect';
import styles from './timer.module.css';

const MODES: Mode[] = ['focus', 'short', 'long'];
const DEFAULT_LONG_EVERY = 4;
const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function TimerWidget() {
  const timer = useStudyStore((s) => s.timer);
  const longEvery = useStudyStore((s) => s.settings?.longEvery) ?? DEFAULT_LONG_EVERY;
  const setOverlay = useStudyStore((s) => s.setOverlay);
  const miniShown = useStudyStore((s) => s.miniShown);
  const toggleMini = useStudyStore((s) => s.toggleMini);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const api = window.studyat.timer;
  const message = timer.status === 'paused' ? pauseMessage(timer.pauseReason) : null;

  // A radio group is one tab stop; the arrow keys move round it and pick as they go.
  const onModeKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEP[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const from = radios.current.findIndex((el) => el === document.activeElement);
    const next = (Math.max(0, from) + step + MODES.length) % MODES.length;
    radios.current[next]?.focus();
    void api.setMode(MODES[next]!);
  };

  return (
    <div className={styles.timer}>
      <div className={styles.tabs} role="radiogroup" aria-label="Timer mode" onKeyDown={onModeKey}>
        {MODES.map((mode, i) => (
          <button
            key={mode}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={timer.mode === mode}
            tabIndex={timer.mode === mode ? 0 : -1}
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
        <div className={styles.footerActions}>
          <button
            type="button"
            className={styles.gear}
            onClick={() => void toggleMini()}
            aria-label={miniShown ? 'Hide mini timer' : 'Show mini timer'}
            aria-pressed={miniShown}
            title="Mini timer (M)"
          >
            <Icon name="mini" />
          </button>
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
    </div>
  );
}
