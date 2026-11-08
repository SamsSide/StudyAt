import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwayPrompt, SegmentEnd, TimerState } from '../../shared/types';
import type { Db } from '../db/db';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import { TimerController } from './controller';
import { FakeClock } from './test-clock';

const MIN = 60_000;
const FOCUS = 25 * MIN;

describe('TimerController', () => {
  let cleanup: () => void;
  let db: Db;
  let clock: FakeClock;
  let lastInput: number;
  let states: TimerState[];
  let aways: (AwayPrompt | null)[];
  let ends: SegmentEnd[];
  let ids: number;
  let c: TimerController;

  const make = (): TimerController =>
    new TimerController({
      db,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      uuid: () => `p-${++ids}`,
      idleSeconds: () => (clock.time - lastInput) / 1000,
      emit: {
        state: (s) => states.push(s),
        away: (p) => aways.push(p),
        segmentEnd: (e) => ends.push(e),
      },
    });

  const rows = () => sessionsRepo(db).all();
  /** Moves the clock to `ms` after NOW, firing every interval due on the way. */
  const at = (ms: number) => clock.advance(NOW + ms - clock.time);

  async function setup(startAt = NOW): Promise<void> {
    const t = tempDir();
    cleanup = t.cleanup;
    db = await openTestDb(t.dir, startAt);
    clock = new FakeClock(startAt);
    lastInput = startAt;
    states = [];
    aways = [];
    ends = [];
    ids = 0;
    c = make();
  }

  beforeEach(() => setup());
  afterEach(async () => {
    c.dispose();
    await db.close();
    cleanup();
  });

  it('inserts running row at focus start', () => {
    const flush = vi.spyOn(db, 'flushNow');
    const s = c.start();
    expect(s).toMatchObject({ mode: 'focus', status: 'running', remainingMs: FOCUS, segmentMs: FOCUS, subjectId: null });
    expect(rows()).toEqual([
      expect.objectContaining({ pomodoroId: 'p-1', subjectId: null, startedAt: NOW, focusMs: 0, dayKey: '2026-11-08', status: 'running' }),
    ]);
    expect(flush).toHaveBeenCalled();
  });

  it('checkpoints every 15 s', () => {
    c.start();
    const flush = vi.spyOn(db, 'flushNow');
    at(14_999);
    expect(rows()[0]).toMatchObject({ focusMs: 0, checkpointAt: NOW });
    expect(flush).not.toHaveBeenCalled();
    at(15_000);
    expect(rows()[0]).toMatchObject({ focusMs: 15_000, checkpointAt: NOW + 15_000 });
    expect(flush).toHaveBeenCalledTimes(1);
    at(30_000);
    expect(rows()[0]).toMatchObject({ focusMs: 30_000, checkpointAt: NOW + 30_000 });
  });

  it('keeps checkpointing after the clock jumps backwards', () => {
    c.start();
    at(20_000);
    clock.shift(-3_600_000); // the system clock is set back an hour
    clock.advance(250);
    clock.advance(15_000);
    expect(rows()[0]?.checkpointAt).toBe(NOW + 20_000 - 3_600_000 + 15_250);
    expect(rows()[0]?.focusMs).toBe(35_000);
  });

  it('pause checkpoints immediately', () => {
    c.start();
    at(7_100);
    const flush = vi.spyOn(db, 'flushNow');
    clock.time = NOW + 7_200; // between ticks
    const s = c.pause();
    expect(s).toMatchObject({ status: 'paused', pauseReason: 'user', remainingMs: FOCUS - 7_200 });
    expect(rows()[0]).toMatchObject({ focusMs: 7_200, checkpointAt: NOW + 7_200, status: 'running' });
    expect(flush).toHaveBeenCalled();
  });

  it('segment end closes row and emits segmentEnd focus→short', () => {
    c.start();
    at(FOCUS);
    expect(ends).toEqual([{ mode: 'focus', next: 'short' }]);
    expect(rows()).toEqual([expect.objectContaining({ status: 'done', focusMs: FOCUS, endedAt: NOW + FOCUS })]);
    expect(c.getState()).toMatchObject({ mode: 'short', status: 'idle', remainingMs: 5 * MIN, completedFocusCount: 1 });
    expect(states.at(-1)).toMatchObject({ mode: 'short', status: 'idle', todayFocusMs: FOCUS });
  });

  it('rows under 60 s deleted on stop', () => {
    c.start();
    at(59_000);
    c.skip();
    expect(rows()).toEqual([]);
    expect(c.getState()).toMatchObject({ mode: 'short', status: 'idle' });
    c.setMode('focus');
    c.start();
    at(59_000 + MIN);
    c.reset();
    expect(rows()).toEqual([expect.objectContaining({ status: 'done', focusMs: MIN })]);
    expect(c.getState()).toMatchObject({ mode: 'focus', status: 'idle', remainingMs: FOCUS });
  });

  it('skip and reset neither chime nor auto-start', () => {
    settingsRepo(db).set({ autoStartBreaks: true, autoStartFocus: true });
    c.dispose();
    c = make();
    c.start();
    at(2 * MIN);
    expect(c.skip()).toMatchObject({ mode: 'short', status: 'idle' });
    expect(ends).toEqual([]);
  });

  it('subject change splits into two rows with same pomodoroId', () => {
    c.setSubject(1);
    c.start();
    at(2 * MIN);
    c.setSubject(2);
    at(4 * MIN);
    expect(c.getState()).toMatchObject({ subjectId: 2, status: 'running', remainingMs: FOCUS - 4 * MIN });
    const [a, b] = rows();
    expect(a).toMatchObject({ pomodoroId: 'p-1', subjectId: 1, status: 'done', focusMs: 2 * MIN, endedAt: NOW + 2 * MIN });
    expect(b).toMatchObject({ pomodoroId: 'p-1', subjectId: 2, status: 'running', startedAt: NOW + 2 * MIN });
    c.pause();
    expect(rows()[1]).toMatchObject({ focusMs: 2 * MIN });
  });

  it('suspend pauses with reason suspend and resume keeps it paused', () => {
    c.start();
    at(30_000);
    c.onSuspend();
    expect(c.getState()).toMatchObject({ status: 'paused', pauseReason: 'suspend' });
    clock.jump(60 * MIN);
    c.onResume();
    c.onLock(); // a second pause keeps the first reason
    expect(c.getState()).toMatchObject({ status: 'paused', pauseReason: 'suspend', remainingMs: FOCUS - 30_000 });
    expect(rows()[0]).toMatchObject({ focusMs: 30_000 });
    expect(states.at(-1)).toMatchObject({ status: 'paused', pauseReason: 'suspend' });
  });

  it('lock pauses with reason lock', () => {
    c.start();
    at(MIN);
    c.onLock();
    at(10 * MIN);
    c.onUnlock();
    expect(c.getState()).toMatchObject({ status: 'paused', pauseReason: 'lock', remainingMs: FOCUS - MIN });
    expect(rows()[0]).toMatchObject({ focusMs: MIN });
    expect(c.resume()).toMatchObject({ status: 'running', pauseReason: null });
  });

  it('a segment that ran out between ticks ends properly before a pause (R8)', () => {
    c.start();
    at(FOCUS - 100);
    clock.time = NOW + FOCUS + 50; // the 250 ms tick has not fired yet
    const s = c.pause();
    expect(ends).toEqual([{ mode: 'focus', next: 'short' }]);
    expect(s).toMatchObject({ mode: 'short', status: 'idle' });
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: FOCUS });
  });

  /** Active for the first minute, away from 1:00, back at 12:02, noticed by the 12:05 poll. */
  function awayTwelveMinutes(): void {
    c.start();
    lastInput = NOW + MIN;
    at(12 * MIN + 2_000);
    lastInput = clock.time;
    at(12 * MIN + 5_000);
  }

  it('idle 10 min then input emits away prompt with awayMs', () => {
    awayTwelveMinutes();
    expect(aways).toEqual([{ awayMs: 11 * MIN + 5_000, deadline: NOW + 12 * MIN + 5_000 + 120_000 }]);
    expect(c.getState()).toMatchObject({ status: 'running' }); // the timer kept running
  });

  it('discard subtracts awayMs, adds to discardedMs and gives time back', () => {
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    const s = c.answerAway('discard');
    expect(aways.at(-1)).toBeNull();
    expect(s.remainingMs).toBe(FOCUS - (12 * MIN + 5_000) + away);
    expect(s.todayFocusMs).toBe(MIN);
    expect(rows()[0]).toMatchObject({ focusMs: MIN, status: 'running' });
    c.reset();
    expect(rows()[0]).toMatchObject({ focusMs: MIN, discardedMs: away, status: 'done' });
  });

  it('keep changes nothing', () => {
    awayTwelveMinutes();
    const s = c.answerAway('keep');
    expect(aways.at(-1)).toBeNull();
    expect(s.remainingMs).toBe(FOCUS - (12 * MIN + 5_000));
    expect(s.todayFocusMs).toBe(12 * MIN + 5_000);
    expect(c.answerAway('discard')).toMatchObject({ remainingMs: s.remainingMs }); // no prompt pending: no-op
  });

  it('auto-discards after 2 minutes with no renderer', () => {
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    at(12 * MIN + 5_000 + 119_000);
    expect(aways).toHaveLength(1);
    at(12 * MIN + 5_000 + 120_000);
    expect(aways).toHaveLength(2);
    expect(aways[1]).toBeNull();
    const elapsed = 12 * MIN + 5_000 + 120_000;
    expect(c.getState()).toMatchObject({ remainingMs: FOCUS - elapsed + away, todayFocusMs: elapsed - away });
    c.pause();
    expect(rows()[0]).toMatchObject({ focusMs: elapsed - away });
    expect(clock.periods()).toEqual([]); // nothing left polling while paused
  });

  it('discard after segment ended while away applies to that row', () => {
    c.start();
    lastInput = NOW + 10 * MIN;
    at(27 * MIN);
    expect(ends).toEqual([{ mode: 'focus', next: 'short' }]);
    expect(aways).toEqual([]);
    lastInput = clock.time + 1_000;
    at(27 * MIN + 5_000);
    // Only the focus time that ran while away is charged: 10:00 → 25:00.
    expect(aways).toEqual([{ awayMs: 15 * MIN, deadline: NOW + 27 * MIN + 5_000 + 120_000 }]);
    const s = c.answerAway('discard');
    expect(s).toMatchObject({ mode: 'short', status: 'idle', remainingMs: 5 * MIN, todayFocusMs: 10 * MIN });
    expect(rows()).toEqual([
      expect.objectContaining({ status: 'done', focusMs: 10 * MIN, discardedMs: 15 * MIN, endedAt: NOW + FOCUS }),
    ]);
  });

  it('a discard that leaves a finished row under a minute deletes it', () => {
    c.start();
    lastInput = NOW + 30_000;
    at(26 * MIN);
    lastInput = clock.time + 1_000;
    at(26 * MIN + 5_000);
    c.answerAway('discard');
    expect(rows()).toEqual([]);
  });

  it('a discard straddling a subject change is charged to both rows, giving the time back', () => {
    c.setSubject(1);
    c.start();
    lastInput = NOW + 2 * MIN;
    at(13 * MIN);
    c.setSubject(2); // the hotkey or tray can change it without input
    at(15 * MIN);
    lastInput = clock.time + 1_000;
    at(15 * MIN + 5_000);
    expect(aways[0]?.awayMs).toBe(13 * MIN + 5_000);
    const s = c.answerAway('discard');
    expect(s.remainingMs).toBe(FOCUS - 2 * MIN);
    const [a, b] = rows();
    expect(a).toMatchObject({ subjectId: 1, status: 'done', focusMs: 2 * MIN, discardedMs: 11 * MIN });
    expect(b).toMatchObject({ subjectId: 2, status: 'running', focusMs: 0 });
    c.reset();
    expect(rows()).toHaveLength(1); // the subject-2 row had no time left
  });

  it('prompts after a lock while away, charging only the time that ran', () => {
    c.start();
    lastInput = NOW;
    at(11 * MIN);
    c.onLock();
    at(40 * MIN);
    c.onUnlock();
    lastInput = clock.time + 1_000;
    at(40 * MIN + 5_000);
    expect(aways).toEqual([{ awayMs: 11 * MIN, deadline: NOW + 40 * MIN + 5_000 + 120_000 }]);
    const s = c.answerAway('discard');
    expect(s).toMatchObject({ status: 'paused', pauseReason: 'lock', remainingMs: FOCUS, todayFocusMs: 0 });
  });

  it('polls idle time only while running or away', () => {
    expect(clock.periods()).toEqual([]);
    c.start();
    expect(clock.periods()).toEqual([250, 5_000]);
    c.pause();
    expect(clock.periods()).toEqual([]);
  });

  it('emits state at least once a second while running, not every tick', () => {
    c.start();
    states = [];
    at(10_000);
    expect(states).toHaveLength(10);
    expect(states.at(-1)).toMatchObject({ remainingMs: FOCUS - 10_000, todayFocusMs: 10_000 });
  });

  it('recoverOrphans closes running rows at checkpoint_at', () => {
    const repo = sessionsRepo(db);
    const a = repo.insertRunning({ pomodoroId: 'x', subjectId: 3, startedAt: NOW - 30 * MIN, dayKey: '2026-11-08' });
    repo.checkpoint(a.id, 20 * MIN, NOW - 10 * MIN);
    const b = repo.insertRunning({ pomodoroId: 'y', subjectId: null, startedAt: NOW - 5 * MIN, dayKey: '2026-11-08' });
    repo.checkpoint(b.id, 45_000, NOW - 4 * MIN);
    const flush = vi.spyOn(db, 'flushNow');
    c.recoverOrphans();
    expect(rows()).toEqual([expect.objectContaining({ id: a.id, status: 'done', endedAt: NOW - 10 * MIN, focusMs: 20 * MIN })]);
    expect(flush).toHaveBeenCalled();
    expect(c.getState()).toMatchObject({ mode: 'focus', status: 'idle', todayFocusMs: 20 * MIN });
  });

  it('quit closes and flushes', async () => {
    c.start();
    at(2 * MIN);
    const flush = vi.spyOn(db, 'flushNow');
    await c.quit();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: 2 * MIN, endedAt: NOW + 2 * MIN });
    expect(flush).toHaveBeenCalled();
    expect(clock.periods()).toEqual([]);
  });

  it('quit with an unanswered away prompt discards it', async () => {
    awayTwelveMinutes();
    await c.quit();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: MIN, discardedMs: 11 * MIN + 5_000 });
  });

  it('day key uses rollover from settings', async () => {
    c.dispose();
    await db.close();
    cleanup();
    const five = new Date(2026, 10, 9, 5, 0, 0).getTime();
    await setup(five);
    c.start();
    expect(rows()[0]?.dayKey).toBe('2026-11-09');
    c.reset();
    settingsRepo(db).set({ rolloverHour: 6 });
    c.start();
    expect(rows().at(-1)?.dayKey).toBe('2026-11-08');
  });

  it('reads segment lengths from settings at each segment start', () => {
    settingsRepo(db).set({ focusMinutes: 50, shortMinutes: 10 });
    expect(c.start()).toMatchObject({ remainingMs: 50 * MIN, segmentMs: 50 * MIN });
    at(50 * MIN);
    expect(c.getState()).toMatchObject({ mode: 'short', remainingMs: 10 * MIN });
  });

  it('toggle cycles idle→running→paused→running', () => {
    expect(c.toggle()).toMatchObject({ status: 'running' });
    expect(c.toggle()).toMatchObject({ status: 'paused', pauseReason: 'user' });
    expect(c.toggle()).toMatchObject({ status: 'running' });
    expect(rows()).toHaveLength(1);
  });

  it('a lock-paused timer resumes once on toggle', () => {
    c.start();
    c.onLock();
    expect(c.toggle()).toMatchObject({ status: 'running', pauseReason: null });
  });

  it('auto-started focus opens a new row with a new pomodoro', () => {
    settingsRepo(db).set({ autoStartBreaks: true, autoStartFocus: true });
    c.start();
    at(FOCUS + 5 * MIN + MIN);
    expect(ends).toEqual([
      { mode: 'focus', next: 'short' },
      { mode: 'short', next: 'focus' },
    ]);
    const [a, b] = rows();
    expect(a).toMatchObject({ pomodoroId: 'p-1', status: 'done', focusMs: FOCUS });
    expect(b).toMatchObject({ pomodoroId: 'p-2', status: 'running', startedAt: NOW + FOCUS + 5 * MIN });
  });
});
