// The Pomodoro timer as a pure state machine (spec §3.4, appplan §5). No clock inside: every step
// takes `now`, and the main-process controller turns the effects into session rows and chimes.
// Only running focus time accrues (a Pomodoro focus or a Countdown, `isFocusMode`); breaks, pauses
// and a clock going backwards never do.
import { isFocusMode } from '../../shared/modes';
import type { Mode, PauseReason, TimerStatus } from '../../shared/types';

export interface TimerConfig {
  focusMs: number;
  shortMs: number;
  longMs: number;
  longEvery: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  /** One Countdown block (spec §3.2). */
  countdownMs: number;
}

export type TimerEvent =
  | { type: 'start' }
  | { type: 'pause'; reason: 'user' | 'suspend' | 'lock' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'skip' }
  | { type: 'setMode'; mode: Mode }
  | { type: 'tick' }
  | { type: 'giveBack'; ms: number };

export interface MachineState {
  mode: Mode;
  status: TimerStatus;
  segmentMs: number;
  remainingMs: number;
  runningSince: number | null;
  completedFocusCount: number;
  pauseReason: PauseReason;
}

export type Effect =
  | { type: 'focusStarted' }
  | { type: 'focusStopped'; reason: 'end' | 'skip' | 'reset' | 'mode' }
  | { type: 'segmentEnded'; mode: Mode; next: Mode }
  | { type: 'accrue'; ms: number };

interface StepResult {
  state: MachineState;
  effects: Effect[];
}

export function lengthOf(mode: Mode, cfg: TimerConfig): number {
  switch (mode) {
    case 'focus':
      return cfg.focusMs;
    case 'short':
      return cfg.shortMs;
    case 'long':
      return cfg.longMs;
    case 'countdown':
      return cfg.countdownMs;
  }
}

// A fresh, full-length, idle segment of `mode`.
function idleIn(mode: Mode, completedFocusCount: number, cfg: TimerConfig): MachineState {
  const segmentMs = lengthOf(mode, cfg);
  return {
    mode,
    status: 'idle',
    segmentMs,
    remainingMs: segmentMs,
    runningSince: null,
    completedFocusCount,
    pauseReason: null,
  };
}

export function initialState(cfg: TimerConfig): MachineState {
  return idleIn('focus', 0, cfg);
}

// A focus segment has started once it leaves idle; only then is there a session row to close.
function focusStarted(s: MachineState): boolean {
  return isFocusMode(s.mode) && s.status !== 'idle';
}

// Counts the running time up to `now` (never negative, never past zero remaining) and moves
// `runningSince` to `now`. Accrue effects are only for focus.
function advance(s: MachineState, now: number, effects: Effect[]): MachineState {
  if (s.status !== 'running' || s.runningSince === null) return s;
  const elapsed = Math.min(Math.max(0, now - s.runningSince), s.remainingMs);
  if (isFocusMode(s.mode) && elapsed > 0) effects.push({ type: 'accrue', ms: elapsed });
  return { ...s, remainingMs: s.remainingMs - elapsed, runningSince: now };
}

function startRunning(s: MachineState, now: number): MachineState {
  return { ...s, status: 'running', runningSince: now, pauseReason: null };
}

// After a skip or a natural end: focus goes to a break, a break goes back to focus, and a
// Countdown stays a Countdown (so its skip is a reset, spec §3.2).
function nextMode(s: MachineState, completedFocusCount: number, cfg: TimerConfig, completed: boolean): Mode {
  if (s.mode === 'countdown') return 'countdown';
  if (s.mode !== 'focus') return 'focus';
  if (!completed) return 'short';
  return cfg.longEvery > 0 && completedFocusCount % cfg.longEvery === 0 ? 'long' : 'short';
}

function endSegment(s: MachineState, now: number, cfg: TimerConfig, effects: Effect[]): MachineState {
  // A Countdown ends idle at full length: no break, no auto-start, and the Pomodoro cycle's
  // `completedFocusCount` is left alone (spec §3.2).
  if (s.mode === 'countdown') {
    effects.push({ type: 'focusStopped', reason: 'end' });
    effects.push({ type: 'segmentEnded', mode: 'countdown', next: 'countdown' });
    return idleIn('countdown', s.completedFocusCount, cfg);
  }
  const count = s.mode === 'focus' ? s.completedFocusCount + 1 : s.completedFocusCount;
  const next = nextMode(s, count, cfg, true);
  if (s.mode === 'focus') effects.push({ type: 'focusStopped', reason: 'end' });
  effects.push({ type: 'segmentEnded', mode: s.mode, next });
  const idle = idleIn(next, count, cfg);
  const autoStart = next === 'focus' ? cfg.autoStartFocus : cfg.autoStartBreaks;
  if (!autoStart) return idle;
  if (next === 'focus') effects.push({ type: 'focusStarted' });
  return startRunning(idle, now);
}

export function step(s: MachineState, e: TimerEvent, now: number, cfg: TimerConfig): StepResult {
  const effects: Effect[] = [];
  switch (e.type) {
    case 'start':
    case 'resume': {
      if (s.status === 'paused') return { state: startRunning(s, now), effects };
      // `resume` only continues a paused segment; `start` begins an idle one.
      if (e.type === 'resume' || s.status !== 'idle') return { state: s, effects };
      if (isFocusMode(s.mode)) effects.push({ type: 'focusStarted' });
      return { state: startRunning(s, now), effects };
    }
    case 'tick': {
      if (s.status !== 'running') return { state: s, effects };
      const advanced = advance(s, now, effects);
      if (advanced.remainingMs > 0) return { state: advanced, effects };
      return { state: endSegment(advanced, now, cfg, effects), effects };
    }
    case 'pause': {
      if (s.status !== 'running') return { state: s, effects };
      const advanced = advance(s, now, effects);
      return { state: { ...advanced, status: 'paused', runningSince: null, pauseReason: e.reason }, effects };
    }
    case 'giveBack': {
      const remainingMs = Math.min(s.segmentMs, s.remainingMs + Math.max(0, e.ms));
      return { state: { ...s, remainingMs }, effects };
    }
    case 'skip':
    case 'reset':
    case 'setMode': {
      if (e.type === 'setMode' && e.mode === s.mode) return { state: s, effects };
      advance(s, now, effects);
      if (focusStarted(s))
        effects.push({ type: 'focusStopped', reason: e.type === 'setMode' ? 'mode' : e.type });
      let mode: Mode;
      if (e.type === 'setMode') mode = e.mode;
      else if (e.type === 'reset') mode = s.mode;
      else mode = nextMode(s, s.completedFocusCount, cfg, false);
      return { state: idleIn(mode, s.completedFocusCount, cfg), effects };
    }
  }
}
