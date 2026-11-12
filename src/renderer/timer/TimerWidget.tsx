// The timer widget's body (spec §4); the frosted frame and title come from WidgetFrame. Main owns
// the clock: this only shows `timer` from the store and sends commands (appplan §5).
import { type KeyboardEvent, useRef, useState } from 'react';
import type { Mode } from '../../shared/types';
import { isFocusMode } from '../../shared/modes';
import { Icon } from '../shell/icons';
import { useStudyStore } from '../shell/store';
import { formatClock, MODE_LABEL, pauseMessage, startLabel, toggleTimer } from './format';
import { IntentionField } from './IntentionField';
import { OutcomeAsk } from './OutcomeAsk';
import { SubjectSelect } from './SubjectSelect';
import { TaskSelect } from './TaskSelect';
import styles from './timer.module.css';

const MODES: Mode[] = ['focus', 'short', 'long', 'countdown'];
/** The tab text: short beside the full MODE_LABEL names (spec §3.2). */
const TAB_LABEL: Record<Mode, string> = {
  focus: 'Pomodoro',
  short: 'Short',
  long: 'Long',
  countdown: 'Countdown',
};
const COUNTDOWN_PRESETS = [30, 45, 60, 90, 120];
const COUNTDOWN_MIN = 1;
const COUNTDOWN_MAX = 240;
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
  const countdownMinutes = useStudyStore((s) => s.settings?.countdownMinutes) ?? 60;
  const updateSettings = useStudyStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const api = window.studyat.timer;

  const saveMinutes = (n: number): void => {
    void updateSettings({ countdownMinutes: n }).catch(() => undefined);
  };
  const commitMinutes = (raw: string): void => {
    setDraft(null);
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    const next = Math.min(COUNTDOWN_MAX, Math.max(COUNTDOWN_MIN, Math.round(n)));
    if (next !== countdownMinutes) saveMinutes(next);
  };
  const showPresets = timer.mode === 'countdown' && timer.status === 'idle';
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
            {TAB_LABEL[mode]}
          </button>
        ))}
      </div>

      <p className={styles.clock} role="timer" aria-label={`${MODE_LABEL[timer.mode]} time remaining`}>
        {formatClock(timer.remainingMs)}
      </p>
      {showPresets && (
        <div className={styles.presets} role="group" aria-label="Countdown length">
          {COUNTDOWN_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={styles.preset}
              aria-pressed={countdownMinutes === m}
              onClick={() => saveMinutes(m)}
            >
              {m}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            className={styles.presetInput}
            aria-label="Countdown minutes"
            min={COUNTDOWN_MIN}
            max={COUNTDOWN_MAX}
            value={draft ?? String(countdownMinutes)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commitMinutes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMinutes(e.currentTarget.value);
            }}
          />
        </div>
      )}
      <p className={styles.message} role="status">
        {message}
      </p>

      <OutcomeAsk />

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
      {isFocusMode(timer.mode) && <TaskSelect />}
      <IntentionField />
    </div>
  );
}
