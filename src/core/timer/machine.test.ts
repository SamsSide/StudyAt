import { describe, expect, it } from 'vitest';
import {
  type Effect,
  type MachineState,
  type TimerConfig,
  type TimerEvent,
  initialState,
  step,
} from './machine';

const MIN = 60_000;
const cfg: TimerConfig = {
  focusMs: 25 * MIN,
  shortMs: 5 * MIN,
  longMs: 15 * MIN,
  longEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  countdownMs: 60 * MIN,
};
const T0 = 1_700_000_000_000;

// Runs events in order, collecting every effect.
function run(s: MachineState, events: Array<[TimerEvent, number]>, c: TimerConfig = cfg) {
  const effects: Effect[] = [];
  for (const [e, now] of events) {
    const r = step(s, e, now, c);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

const accrued = (effects: Effect[]) =>
  effects.reduce((sum, e) => (e.type === 'accrue' ? sum + e.ms : sum), 0);
const ofType = (effects: Effect[], type: Effect['type']) => effects.filter((e) => e.type === type);

// Completes one focus segment started at `at` and returns the state after it ends.
function completeFocus(s: MachineState, at: number, c: TimerConfig = cfg) {
  return run(
    s,
    [
      [{ type: 'start' }, at],
      [{ type: 'tick' }, at + c.focusMs],
    ],
    c,
  );
}

describe('initialState', () => {
  it('starts idle in focus at full length', () => {
    expect(initialState(cfg)).toEqual({
      mode: 'focus',
      status: 'idle',
      segmentMs: 25 * MIN,
      remainingMs: 25 * MIN,
      runningSince: null,
      completedFocusCount: 0,
      pauseReason: null,
    });
  });
});

describe('step', () => {
  it('starts focus and emits focusStarted once', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'start' }, T0 + 1000],
      [{ type: 'tick' }, T0 + 2000],
    ]);
    expect(ofType(r.effects, 'focusStarted')).toHaveLength(1);
    expect(r.state.status).toBe('running');
    expect(r.state.runningSince).toBe(T0 + 2000);
    expect(r.state.remainingMs).toBe(25 * MIN - 2000);
    expect(accrued(r.effects)).toBe(2000);
  });

  it('pause stops accrual', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'user' }, T0 + 10_000],
      [{ type: 'tick' }, T0 + 60_000],
      [{ type: 'tick' }, T0 + 120_000],
    ]);
    expect(accrued(r.effects)).toBe(10_000);
    expect(r.state.status).toBe('paused');
    expect(r.state.pauseReason).toBe('user');
    expect(r.state.runningSince).toBeNull();
    expect(r.state.remainingMs).toBe(25 * MIN - 10_000);
  });

  it('records the pause reason for suspend and lock, keeping the first one', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'lock' }, T0 + 5000],
      [{ type: 'pause', reason: 'suspend' }, T0 + 6000],
    ]);
    expect(r.state.pauseReason).toBe('lock');
    expect(accrued(r.effects)).toBe(5000);
  });

  it('resume does not emit focusStarted', () => {
    const first = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'suspend' }, T0 + 5000],
    ]);
    const r = run(first.state, [
      [{ type: 'resume' }, T0 + 50_000],
      [{ type: 'tick' }, T0 + 53_000],
    ]);
    expect(ofType(r.effects, 'focusStarted')).toHaveLength(0);
    expect(r.state.status).toBe('running');
    expect(r.state.pauseReason).toBeNull();
    expect(accrued(r.effects)).toBe(3000);
  });

  it('start while paused resumes without focusStarted', () => {
    const first = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'user' }, T0 + 5000],
    ]);
    const r = step(first.state, { type: 'start' }, T0 + 9000, cfg);
    expect(r.state.status).toBe('running');
    expect(r.effects).toEqual([]);
  });

  it('tick past zero ends segment and emits accrue for the exact remaining time', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'tick' }, T0 + 24 * MIN],
      [{ type: 'tick' }, T0 + 26 * MIN],
    ]);
    expect(accrued(r.effects)).toBe(25 * MIN);
    const last = r.effects.slice(-3);
    expect(last).toEqual([
      { type: 'accrue', ms: MIN },
      { type: 'focusStopped', reason: 'end' },
      { type: 'segmentEnded', mode: 'focus', next: 'short' },
    ]);
    expect(r.state).toMatchObject({
      mode: 'short',
      status: 'idle',
      segmentMs: 5 * MIN,
      remainingMs: 5 * MIN,
      runningSince: null,
      completedFocusCount: 1,
    });
  });

  it('fourth focus leads to long break', () => {
    let s = initialState(cfg);
    const ends: Effect[] = [];
    let at = T0;
    for (let i = 0; i < 4; i++) {
      const f = completeFocus(s, at);
      ends.push(...ofType(f.effects, 'segmentEnded'));
      at += cfg.focusMs + 1000;
      s = f.state;
      if (i < 3) {
        s = run(s, [[{ type: 'skip' }, at]]).state;
        at += 1000;
      }
    }
    expect(ends.map((e) => (e.type === 'segmentEnded' ? e.next : null))).toEqual([
      'short',
      'short',
      'short',
      'long',
    ]);
    expect(s).toMatchObject({ mode: 'long', segmentMs: 15 * MIN, completedFocusCount: 4 });
  });

  it('a break ending leads back to focus', () => {
    const f = completeFocus(initialState(cfg), T0);
    const r = run(f.state, [
      [{ type: 'start' }, T0 + 30 * MIN],
      [{ type: 'tick' }, T0 + 35 * MIN],
    ]);
    expect(r.effects).toEqual([{ type: 'segmentEnded', mode: 'short', next: 'focus' }]);
    expect(r.state).toMatchObject({ mode: 'focus', status: 'idle', remainingMs: 25 * MIN });
  });

  it('auto-start breaks when enabled', () => {
    const c = { ...cfg, autoStartBreaks: true };
    const end = T0 + cfg.focusMs;
    const f = completeFocus(initialState(c), T0, c);
    expect(f.state).toMatchObject({
      mode: 'short',
      status: 'running',
      runningSince: end,
      remainingMs: 5 * MIN,
    });
    // Break time after auto-start still never accrues.
    const r = run(f.state, [[{ type: 'tick' }, end + MIN]], c);
    expect(r.effects).toEqual([]);
    expect(r.state.remainingMs).toBe(4 * MIN);
  });

  it('does not auto-start breaks by default', () => {
    expect(completeFocus(initialState(cfg), T0).state.status).toBe('idle');
  });

  it('auto-start focus emits focusStarted after a break ends', () => {
    const c = { ...cfg, autoStartFocus: true };
    const f = completeFocus(initialState(c), T0, c);
    const r = run(
      f.state,
      [
        [{ type: 'start' }, T0 + 30 * MIN],
        [{ type: 'tick' }, T0 + 35 * MIN],
      ],
      c,
    );
    expect(r.effects).toEqual([
      { type: 'segmentEnded', mode: 'short', next: 'focus' },
      { type: 'focusStarted' },
    ]);
    expect(r.state).toMatchObject({ mode: 'focus', status: 'running', runningSince: T0 + 35 * MIN });
  });

  it('skip during focus emits focusStopped skip and moves to short', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'skip' }, T0 + 3 * MIN],
    ]);
    expect(r.effects).toEqual([
      { type: 'focusStarted' },
      { type: 'accrue', ms: 3 * MIN },
      { type: 'focusStopped', reason: 'skip' },
    ]);
    expect(r.state).toMatchObject({
      mode: 'short',
      status: 'idle',
      remainingMs: 5 * MIN,
      completedFocusCount: 0,
    });
  });

  it('skip while focus is idle emits no focusStopped', () => {
    const r = step(initialState(cfg), { type: 'skip' }, T0, cfg);
    expect(r.effects).toEqual([]);
    expect(r.state.mode).toBe('short');
  });

  it('skip while focus is paused stops focus without accruing', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'user' }, T0 + MIN],
      [{ type: 'skip' }, T0 + 10 * MIN],
    ]);
    expect(accrued(r.effects)).toBe(MIN);
    expect(ofType(r.effects, 'focusStopped')).toEqual([{ type: 'focusStopped', reason: 'skip' }]);
  });

  it('reset returns to full length idle', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'reset' }, T0 + 2 * MIN],
    ]);
    expect(r.effects.slice(1)).toEqual([
      { type: 'accrue', ms: 2 * MIN },
      { type: 'focusStopped', reason: 'reset' },
    ]);
    expect(r.state).toEqual({ ...initialState(cfg) });
  });

  it('reset of a break keeps the break mode', () => {
    const f = completeFocus(initialState(cfg), T0);
    const r = run(f.state, [
      [{ type: 'start' }, T0 + 30 * MIN],
      [{ type: 'reset' }, T0 + 31 * MIN],
    ]);
    expect(r.effects).toEqual([]);
    expect(r.state).toMatchObject({
      mode: 'short',
      status: 'idle',
      remainingMs: 5 * MIN,
      completedFocusCount: 1,
    });
  });

  it('backwards clock accrues 0', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'tick' }, T0 - 60_000],
      [{ type: 'tick' }, T0 - 59_000],
      [{ type: 'pause', reason: 'user' }, T0 - 120_000],
    ]);
    expect(accrued(r.effects)).toBe(1000);
    expect(r.effects.every((e) => e.type !== 'accrue' || e.ms >= 0)).toBe(true);
    expect(r.state.remainingMs).toBe(25 * MIN - 1000);
  });

  it('giveBack caps at segment length', () => {
    const s = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'tick' }, T0 + 12 * MIN],
    ]).state;
    const partial = step(s, { type: 'giveBack', ms: 10 * MIN }, T0 + 12 * MIN, cfg);
    expect(partial.state.remainingMs).toBe(23 * MIN);
    expect(partial.effects).toEqual([]);
    const capped = step(s, { type: 'giveBack', ms: 20 * MIN }, T0 + 12 * MIN, cfg);
    expect(capped.state.remainingMs).toBe(25 * MIN);
    const negative = step(s, { type: 'giveBack', ms: -5 * MIN }, T0 + 12 * MIN, cfg);
    expect(negative.state.remainingMs).toBe(13 * MIN);
  });

  it('setMode while running focus stops focus with reason mode', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'setMode', mode: 'long' }, T0 + 4 * MIN],
    ]);
    expect(r.effects.slice(1)).toEqual([
      { type: 'accrue', ms: 4 * MIN },
      { type: 'focusStopped', reason: 'mode' },
    ]);
    expect(r.state).toMatchObject({
      mode: 'long',
      status: 'idle',
      segmentMs: 15 * MIN,
      remainingMs: 15 * MIN,
    });
  });

  it('setMode while paused focus closes the started focus', () => {
    const r = run(initialState(cfg), [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'user' }, T0 + MIN],
      [{ type: 'setMode', mode: 'short' }, T0 + 2 * MIN],
    ]);
    expect(ofType(r.effects, 'focusStopped')).toEqual([{ type: 'focusStopped', reason: 'mode' }]);
    expect(accrued(r.effects)).toBe(MIN);
    expect(r.state).toMatchObject({ mode: 'short', status: 'idle', pauseReason: null });
  });

  it('setMode while idle changes mode at full length', () => {
    const r = step(initialState(cfg), { type: 'setMode', mode: 'short' }, T0, cfg);
    expect(r.effects).toEqual([]);
    expect(r.state).toMatchObject({
      mode: 'short',
      status: 'idle',
      segmentMs: 5 * MIN,
      remainingMs: 5 * MIN,
    });
  });

  it('setMode to the current mode is a no-op', () => {
    const s = step(initialState(cfg), { type: 'start' }, T0, cfg).state;
    const r = step(s, { type: 'setMode', mode: 'focus' }, T0 + MIN, cfg);
    expect(r.effects).toEqual([]);
    expect(r.state).toBe(s);
  });

  it('break time never accrues', () => {
    const f = completeFocus(initialState(cfg), T0);
    const r = run(f.state, [
      [{ type: 'start' }, T0 + 30 * MIN],
      [{ type: 'tick' }, T0 + 31 * MIN],
      [{ type: 'pause', reason: 'user' }, T0 + 32 * MIN],
      [{ type: 'resume' }, T0 + 33 * MIN],
      [{ type: 'skip' }, T0 + 34 * MIN],
    ]);
    expect(ofType(r.effects, 'accrue')).toEqual([]);
    expect(ofType(r.effects, 'focusStarted')).toEqual([]);
    expect(ofType(r.effects, 'focusStopped')).toEqual([]);
    expect(r.state.mode).toBe('focus');
  });

  it('ignores ticks, pauses and resumes while idle', () => {
    const s = initialState(cfg);
    for (const e of [
      { type: 'tick' },
      { type: 'pause', reason: 'user' },
      { type: 'resume' },
    ] as TimerEvent[]) {
      const r = step(s, e, T0, cfg);
      expect(r.effects).toEqual([]);
      expect(r.state).toBe(s);
    }
  });

  it('never mutates the input state', () => {
    const s = Object.freeze(initialState(cfg));
    expect(() =>
      run(s, [
        [{ type: 'start' }, T0],
        [{ type: 'tick' }, T0 + 1000],
        [{ type: 'skip' }, T0 + 2000],
      ]),
    ).not.toThrow();
  });
});

describe('countdown (spec §3.2)', () => {
  it('countdown accrues like focus and ends idle in countdown without a break', () => {
    const s = step(initialState(cfg), { type: 'setMode', mode: 'countdown' }, 0, cfg).state;
    const started = step(s, { type: 'start' }, 0, cfg);
    expect(started.effects).toContainEqual({ type: 'focusStarted' });
    const end = step(started.state, { type: 'tick' }, 60 * MIN, {
      ...cfg,
      autoStartBreaks: true,
      autoStartFocus: true,
    });
    expect(end.effects).toContainEqual({ type: 'accrue', ms: 60 * MIN });
    expect(end.effects).toContainEqual({ type: 'focusStopped', reason: 'end' });
    expect(end.effects).toContainEqual({ type: 'segmentEnded', mode: 'countdown', next: 'countdown' });
    expect(end.state).toMatchObject({
      mode: 'countdown',
      status: 'idle',
      remainingMs: 60 * MIN,
      completedFocusCount: 0,
    });
  });

  it('skip in countdown resets to full length idle countdown', () => {
    const s = step(initialState(cfg), { type: 'setMode', mode: 'countdown' }, T0, cfg).state;
    const r = run(s, [
      [{ type: 'start' }, T0],
      [{ type: 'skip' }, T0 + 10 * MIN],
    ]);
    expect(accrued(r.effects)).toBe(10 * MIN);
    expect(r.effects).toContainEqual({ type: 'focusStopped', reason: 'skip' });
    expect(r.state).toMatchObject({ mode: 'countdown', status: 'idle', remainingMs: 60 * MIN, completedFocusCount: 0 });
  });

  it('a paused countdown accrues only running time', () => {
    const s = step(initialState(cfg), { type: 'setMode', mode: 'countdown' }, T0, cfg).state;
    const r = run(s, [
      [{ type: 'start' }, T0],
      [{ type: 'pause', reason: 'user' }, T0 + 5 * MIN],
      [{ type: 'resume' }, T0 + 20 * MIN],
      [{ type: 'tick' }, T0 + 22 * MIN],
    ]);
    expect(accrued(r.effects)).toBe(7 * MIN);
    expect(r.state.remainingMs).toBe(53 * MIN);
  });

  it('leaving a started countdown for another mode stops focus', () => {
    const s = step(initialState(cfg), { type: 'setMode', mode: 'countdown' }, T0, cfg).state;
    const r = run(s, [
      [{ type: 'start' }, T0],
      [{ type: 'setMode', mode: 'focus' }, T0 + 3 * MIN],
    ]);
    expect(r.effects).toContainEqual({ type: 'focusStopped', reason: 'mode' });
    expect(r.state).toMatchObject({ mode: 'focus', status: 'idle', remainingMs: 25 * MIN });
  });
});
