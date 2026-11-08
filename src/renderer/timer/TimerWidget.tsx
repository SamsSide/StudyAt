// The timer widget's body (spec §4); the frosted frame and title come from WidgetFrame. Main owns
// the clock: this only shows `timer` from the store and sends commands (appplan §5).
import { type KeyboardEvent, useRef, useState } from 'react';
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
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // The roving tab stop: the mode last arrowed to, until main reports a mode change.
  const [roving, setRoving] = useState<{ base: Mode; at: Mode } | null>(null);
  if (roving && roving.base !== timer.mode) setRoving(null);
  const tabStop = roving?.base === timer.mode ? roving.at : timer.mode;
  const api = window.studyat.timer;
  const message = timer.status === 'paused' ? pauseMessage(timer.pauseReason) : null;

  // The modes are one tab stop. The arrow keys (and Home/End) only move focus: changing mode
  // mid-focus ends the session (appplan §5), so only Enter, Space or a click picks one.
  const onModeKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const from = buttons.current.findIndex((el) => el === document.activeElement);
    const step = STEP[e.key];
    let next: number;
    if (step !== undefined) next = (Math.max(0, from) + step + MODES.length) % MODES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MODES.length - 1;
    else return;
    e.preventDefault();
    buttons.current[next]?.focus();
    setRoving({ base: timer.mode, at: MODES[next]! });
  };

  return (
    <div className={styles.timer}>
      <div className={styles.tabs} role="toolbar" aria-label="Timer mode" onKeyDown={onModeKey}>
        {MODES.map((mode, i) => (
          <button
            key={mode}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            aria-pressed={timer.mode === mode}
            tabIndex={tabStop === mode ? 0 : -1}
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
