import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwayPrompt, SegmentEnd, TimerState } from '../../shared/types';
import type { Db } from '../db/db';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import { one } from '../db/sql';
import { AWAY_MARKER_KEY, readAwayMarker } from './away-marker';
import { SLEEP_GAP_MS, TimerController } from './controller';
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
  /** The segment length passed with each segment end, for the notification. */
  let endLengths: number[];
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
        segmentEnd: (e, segmentMs) => {
          ends.push(e);
          endLengths.push(segmentMs);
        },
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
    endLengths = [];
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
    expect(s).toMatchObject({
      mode: 'focus',
      status: 'running',
      remainingMs: FOCUS,
      segmentMs: FOCUS,
      subjectId: null,
    });
    expect(rows()).toEqual([
      expect.objectContaining({
        pomodoroId: 'p-1',
        subjectId: null,
        startedAt: NOW,
        focusMs: 0,
        dayKey: '2026-11-08',
        status: 'running',
      }),
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
    expect(rows()).toEqual([
      expect.objectContaining({ status: 'done', focusMs: FOCUS, endedAt: NOW + FOCUS }),
    ]);
    expect(c.getState()).toMatchObject({
      mode: 'short',
      status: 'idle',
      remainingMs: 5 * MIN,
      completedFocusCount: 1,
    });
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
    expect(a).toMatchObject({
      pomodoroId: 'p-1',
      subjectId: 1,
      status: 'done',
      focusMs: 2 * MIN,
      endedAt: NOW + 2 * MIN,
    });
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
    expect(c.getState()).toMatchObject({
      status: 'paused',
      pauseReason: 'suspend',
      remainingMs: FOCUS - 30_000,
    });
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
    expect(rows()[0]).toMatchObject({ focusMs: MIN, discardedMs: away, status: 'running' }); // on disk before close
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
      expect.objectContaining({
        status: 'done',
        focusMs: 10 * MIN,
        discardedMs: 15 * MIN,
        endedAt: NOW + FOCUS,
      }),
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
    const a = repo.insertRunning({
      pomodoroId: 'x',
      subjectId: 3,
      taskId: null,
      taskText: null,
      startedAt: NOW - 30 * MIN,
      dayKey: '2026-11-08',
    });
    repo.checkpoint(a.id, 20 * MIN, NOW - 10 * MIN);
    const b = repo.insertRunning({
      pomodoroId: 'y',
      subjectId: null,
      taskId: null,
      taskText: null,
      startedAt: NOW - 5 * MIN,
      dayKey: '2026-11-08',
    });
    repo.checkpoint(b.id, 45_000, NOW - 4 * MIN);
    const flush = vi.spyOn(db, 'flushNow');
    c.recoverOrphans();
    expect(rows()).toEqual([
      expect.objectContaining({ id: a.id, status: 'done', endedAt: NOW - 10 * MIN, focusMs: 20 * MIN }),
    ]);
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
  // ── Sam's answer A4: an unreported sleep (Modern Standby) is never accrued ──

  it('a tick gap over 30 s with no suspend event pauses for suspend at the last tick', () => {
    expect(SLEEP_GAP_MS).toBe(30_000);
    c.start();
    at(30_000);
    clock.jump(31_000); // asleep, no suspend event
    clock.advance(250);
    expect(c.getState()).toMatchObject({
      status: 'paused',
      pauseReason: 'suspend',
      remainingMs: FOCUS - 30_000,
      todayFocusMs: 30_000,
    });
    expect(rows()[0]).toMatchObject({ status: 'running', focusMs: 30_000, checkpointAt: NOW + 30_000 });
    expect(states.at(-1)).toMatchObject({ status: 'paused', pauseReason: 'suspend' });
    expect(clock.periods()).toEqual([]);
  });

  it('a tick gap of 20 s (or exactly 30 s) is accrued normally', () => {
    c.start();
    at(30_000);
    clock.jump(20_000);
    clock.advance(250);
    expect(c.getState()).toMatchObject({ status: 'running', remainingMs: FOCUS - 50_250 });
    clock.jump(30_000);
    clock.advance(0);
    expect(c.getState()).toMatchObject({ status: 'running', remainingMs: FOCUS - 80_250 });
  });

  it('an unreported sleep past the segment end does not finish the segment', () => {
    c.start();
    at(24 * MIN);
    clock.jump(10 * MIN);
    clock.advance(250);
    expect(ends).toEqual([]);
    expect(c.getState()).toMatchObject({
      mode: 'focus',
      status: 'paused',
      pauseReason: 'suspend',
      remainingMs: MIN,
    });
    expect(rows()[0]).toMatchObject({ focusMs: 24 * MIN });
  });

  it('a command after an unreported sleep pauses for suspend before it acts', () => {
    c.start();
    at(30_000);
    clock.jump(5 * MIN);
    expect(c.pause()).toMatchObject({
      status: 'paused',
      pauseReason: 'suspend',
      remainingMs: FOCUS - 30_000,
    });
    expect(rows()[0]).toMatchObject({ focusMs: 30_000 });
  });

  it('onResume on a still-running timer pauses for suspend at the last tick', () => {
    c.start();
    at(30_000);
    clock.jump(10_000); // under the gap, but Electron says we slept
    c.onResume();
    expect(c.getState()).toMatchObject({
      status: 'paused',
      pauseReason: 'suspend',
      remainingMs: FOCUS - 30_000,
    });
    expect(rows()[0]).toMatchObject({ focusMs: 30_000, checkpointAt: NOW + 30_000 });
  });

  it('quit after an unreported sleep closes the row without the gap', async () => {
    c.start();
    at(2 * MIN);
    clock.jump(20 * MIN);
    await c.quit();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: 2 * MIN });
  });

  // ── Sam's answer A1: quit while away discards, even before the return is noticed ──

  it('quit with an away period not yet noticed discards it', async () => {
    c.start();
    lastInput = NOW + MIN;
    at(12 * MIN); // the 11:00 poll saw 10 min idle; Sam has not come back
    expect(aways).toEqual([]);
    await c.quit();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: MIN, discardedMs: 11 * MIN });
  });

  // ── Sam's answer A3: a pomodoro is credited to its start day ──

  it('a subject change after the 04:00 rollover keeps the start day', async () => {
    c.dispose();
    await db.close();
    cleanup();
    await setup(new Date(2026, 10, 9, 3, 50, 0).getTime());
    c.setSubject(1);
    c.start();
    clock.advance(15 * MIN); // 04:05
    c.setSubject(2);
    clock.advance(5 * MIN);
    c.reset();
    expect(rows().map((r) => [r.subjectId, r.dayKey])).toEqual([
      [1, '2026-11-08'],
      [2, '2026-11-08'],
    ]);
  });

  // ── Finding 5: nothing steps or writes once disposed ──

  it('ignores commands after quit', async () => {
    c.start();
    at(2 * MIN);
    await c.quit();
    const before = rows();
    const flush = vi.spyOn(db, 'flushNow');
    const insert = vi.spyOn(db, 'markDirty');
    c.skip();
    c.setMode('focus');
    c.start();
    c.setSubject(4);
    c.onSuspend();
    c.onResume();
    c.answerAway('discard');
    c.recoverOrphans();
    await c.quit();
    expect(rows()).toEqual(before);
    expect(flush).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(clock.periods()).toEqual([]);
  });

  it('ignores commands after dispose', () => {
    c.dispose();
    c.start();
    expect(rows()).toEqual([]);
    expect(clock.periods()).toEqual([]);
  });

  it('quit after dispose still discards an open away period and closes the row (A1)', async () => {
    c.start();
    lastInput = NOW + MIN;
    at(12 * MIN); // away since 1:00, not yet noticed
    c.dispose();
    const flush = vi.spyOn(db, 'flushNow');
    await c.quit();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: MIN, discardedMs: 11 * MIN });
    expect(flush).toHaveBeenCalled();
    expect(clock.periods()).toEqual([]);
  });

  it('answers a late command after quit without touching the closed database', async () => {
    c.start();
    at(2 * MIN);
    await c.quit();
    const after = c.getState();
    await db.close();
    expect(c.pause()).toEqual(after);
    expect(c.getState()).toMatchObject({
      status: 'running',
      remainingMs: FOCUS - 2 * MIN,
      todayFocusMs: 2 * MIN,
    });
  });

  it('answers a late command after dispose without touching the closed database', async () => {
    c.start();
    at(2 * MIN);
    c.dispose();
    await db.close();
    expect(() => c.start()).not.toThrow();
    expect(c.getState()).toMatchObject({ mode: 'focus', status: 'running' });
  });

  // ── Findings 6 and 7: the ledger and row map stay bounded without under-charging ──

  it('a lowered idle threshold still charges an earlier row of the same pomodoro', () => {
    settingsRepo(db).set({ idleMinutes: 30, focusMinutes: 60 });
    c.start();
    at(2 * MIN);
    c.setSubject(1); // tray, no input
    at(14 * MIN);
    settingsRepo(db).set({ idleMinutes: 10 });
    c.applySettings();
    at(14 * MIN + 5_000); // the poll notices 14:05 idle since 0:00
    lastInput = clock.time + 1_000;
    at(14 * MIN + 10_000);
    expect(aways[0]?.awayMs).toBe(14 * MIN + 10_000);
    expect(c.answerAway('discard')).toMatchObject({ remainingMs: 60 * MIN, todayFocusMs: 0 });
    // The untagged row lost all of its 2 minutes and was deleted.
    expect(rows()).toEqual([
      expect.objectContaining({
        subjectId: 1,
        status: 'running',
        focusMs: 0,
        discardedMs: 12 * MIN + 10_000,
      }),
    ]);
  });

  it('forgets rows of older pomodoros once nothing can charge them', () => {
    for (let i = 0; i < 5; i++) {
      c.setMode('focus');
      c.start();
      clock.advance(3 * MIN);
      lastInput = clock.time;
      c.skip();
    }
    clock.advance(30 * MIN);
    lastInput = clock.time;
    c.applySettings();
    expect((Reflect.get(c, 'rows') as Map<number, unknown>).size).toBe(2);
  });
  // ── Ruling R39: a crash during an unanswered away period never credits the away time ──

  const marker = () => one(db.raw, 'SELECT value FROM meta WHERE key = ?', [AWAY_MARKER_KEY]);
  /** The process dies: nothing is closed or flushed; the next launch recovers from the database. */
  const crashAndRelaunch = (): TimerController => {
    c.dispose();
    c = make();
    c.recoverOrphans();
    return c;
  };

  it('persists an away marker and a checkpoint as soon as the idle threshold is crossed', () => {
    c.start();
    lastInput = NOW + MIN;
    at(11 * MIN); // the 11:00 poll sees 10 min idle: away since 1:00
    expect(JSON.parse(String(marker()?.value))).toEqual({
      since: NOW + MIN,
      rows: [{ rowId: rows()[0]!.id, focusMsAtSince: MIN }],
    });
    expect(rows()[0]).toMatchObject({ checkpointAt: NOW + 11 * MIN, focusMs: 11 * MIN });
  });

  it('a crash while away, not yet noticed, recovers the row without the away time', () => {
    c.start();
    lastInput = NOW + MIN;
    at(13 * MIN + 7_000);
    const cp = rows()[0]!;
    crashAndRelaunch();
    expect(rows()).toEqual([
      expect.objectContaining({
        status: 'done',
        endedAt: cp.checkpointAt,
        focusMs: MIN,
        discardedMs: cp.focusMs - MIN,
      }),
    ]);
    expect(marker()).toBeNull();
  });

  it('a crash with the away prompt unanswered keeps the focus earned after return', () => {
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    at(14 * MIN); // two more minutes of focus after Sam came back
    const cp = rows()[0]!;
    expect(cp.focusMs).toBeGreaterThan(away + MIN);
    crashAndRelaunch();
    expect(rows()).toEqual([
      expect.objectContaining({
        status: 'done',
        endedAt: cp.checkpointAt,
        focusMs: cp.focusMs - away,
        discardedMs: away,
      }),
    ]);
    expect(marker()).toBeNull();
  });

  it('once the prompt is raised, the marker holds its fixed charges and the row is checkpointed', () => {
    awayTwelveMinutes();
    expect(JSON.parse(String(marker()?.value))).toEqual({
      since: NOW + MIN,
      charges: [{ rowId: rows()[0]!.id, ms: 11 * MIN + 5_000 }],
    });
    expect(rows()[0]).toMatchObject({ checkpointAt: NOW + 12 * MIN + 5_000, focusMs: 12 * MIN + 5_000 });
  });

  it('a crash with the prompt unanswered after the segment ended charges the closed row', () => {
    settingsRepo(db).set({ focusMinutes: 13 });
    c.start();
    lastInput = NOW + MIN;
    at(12 * MIN + 2_000);
    lastInput = clock.time;
    at(12 * MIN + 5_000); // prompt: 11:05 at stake, auto-discard at 14:05
    at(13 * MIN + 30_000); // the focus row closed at 13:00, the prompt still open
    expect(aways.at(-1)).not.toBeNull();
    crashAndRelaunch();
    expect(rows()).toEqual([
      expect.objectContaining({
        status: 'done',
        endedAt: NOW + 13 * MIN,
        focusMs: 13 * MIN - (11 * MIN + 5_000),
        discardedMs: 11 * MIN + 5_000,
      }),
    ]);
  });

  it('a crash while away after the segment ended takes the away time out of the closed row', () => {
    c.start();
    lastInput = NOW + 10 * MIN;
    at(27 * MIN); // the focus row closed at 25:00 with the away time in it
    crashAndRelaunch();
    expect(rows()).toEqual([
      expect.objectContaining({
        status: 'done',
        endedAt: NOW + FOCUS,
        focusMs: 10 * MIN,
        discardedMs: 15 * MIN,
      }),
    ]);
  });

  it('a crash while away deletes a recovered row left under a minute (rule 6)', () => {
    c.start();
    lastInput = NOW + 30_000;
    at(12 * MIN);
    crashAndRelaunch();
    expect(rows()).toEqual([]);
  });

  it('a crash after Keep recovers normally', () => {
    awayTwelveMinutes();
    c.answerAway('keep');
    expect(marker()).toBeNull();
    at(13 * MIN);
    const cp = rows()[0]!;
    crashAndRelaunch();
    expect(rows()[0]).toMatchObject({
      status: 'done',
      endedAt: cp.checkpointAt,
      focusMs: cp.focusMs,
      discardedMs: 0,
    });
    expect(cp.focusMs).toBeGreaterThan(12 * MIN);
  });

  it('discard, auto-discard and quit clear the marker', async () => {
    awayTwelveMinutes();
    c.answerAway('discard');
    expect(marker()).toBeNull();
    c.reset();
    lastInput = clock.time;
    c.start();
    lastInput = clock.time;
    at(25 * MIN); // away again, noticed at the next poll past 10 min idle
    expect(marker()).not.toBeNull();
    lastInput = clock.time + 1_000;
    at(25 * MIN + 5_000);
    expect(aways.at(-1)).not.toBeNull();
    at(25 * MIN + 5_000 + 120_000); // auto-discard
    expect(marker()).toBeNull();
    lastInput = clock.time - 11 * MIN; // idle again past the threshold
    clock.advance(5_000);
    expect(marker()).not.toBeNull();
    await c.quit();
    expect(marker()).toBeNull();
  });

  it('a row opened while away joins the marker', () => {
    c.setSubject(1);
    c.start();
    lastInput = NOW + MIN;
    at(11 * MIN);
    c.setSubject(2); // the tray, no input
    const ids = rows().map((r) => r.id);
    expect(JSON.parse(String(marker()?.value)).rows).toEqual([
      { rowId: ids[0], focusMsAtSince: MIN },
      { rowId: ids[1], focusMsAtSince: 0 },
    ]);
    at(12 * MIN);
    crashAndRelaunch();
    expect(rows().map((r) => [r.subjectId, r.focusMs])).toEqual([[1, MIN]]);
  });

  // ── v1.1: the away-prompt switch (spec §3.1) ──

  it('awayPrompt off: 15 idle minutes during focus keep all focus and never prompt', () => {
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    c.start();
    lastInput = NOW + MIN;
    at(16 * MIN); // idle seconds pass 600 at 11:00 and keep rising
    lastInput = clock.time;
    at(FOCUS);
    expect(aways.filter((p) => p !== null)).toEqual([]);
    expect(rows()).toEqual([expect.objectContaining({ status: 'done', focusMs: FOCUS, discardedMs: 0 })]);
    expect(readAwayMarker(db)).toBeNull();
  });

  it('awayPrompt off: the timer never reads idle time', () => {
    settingsRepo(db).set({ awayPrompt: false });
    const polls = vi.fn(() => 0);
    c.dispose();
    c = new TimerController({
      db,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      uuid: () => `p-${++ids}`,
      idleSeconds: polls,
      emit: { state: () => undefined, away: () => undefined, segmentEnd: () => undefined },
    });
    c.start();
    at(5 * MIN);
    expect(polls).not.toHaveBeenCalled();
  });

  it('turning awayPrompt off drops an unprompted away period and clears the marker', () => {
    c.start();
    lastInput = NOW + MIN;
    at(11 * MIN); // away since 1:00, marker written
    expect(readAwayMarker(db)).not.toBeNull();
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    expect(readAwayMarker(db)).toBeNull();
    at(12 * MIN + 2_000);
    lastInput = clock.time; // back
    at(FOCUS);
    expect(aways.filter((p) => p !== null)).toEqual([]);
    expect(rows()).toEqual([expect.objectContaining({ status: 'done', focusMs: FOCUS, discardedMs: 0 })]);
    expect(readAwayMarker(db)).toBeNull();
  });

  it('turning awayPrompt off leaves a showing prompt to resolve', () => {
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    expect(aways).toHaveLength(1);
    c.answerAway('discard');
    expect(aways.at(-1)).toBeNull();
    expect(rows()[0]).toMatchObject({ focusMs: MIN, discardedMs: away });
    expect(readAwayMarker(db)).toBeNull();
  });

  it('turning awayPrompt off leaves a showing prompt to auto-discard', () => {
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    at(12 * MIN + 5_000 + 120_000);
    expect(aways.at(-1)).toBeNull();
    expect(rows()[0]).toMatchObject({ discardedMs: away });
  });

  it('turning awayPrompt back on applies from the next poll; focus before the switch stays kept', () => {
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    c.start();
    lastInput = NOW + MIN;
    at(5 * MIN);
    settingsRepo(db).set({ awayPrompt: true });
    c.applySettings();
    at(11 * MIN + 5_000); // a poll sees over 10 min idle: idle since 1:00, but away only since 5:00
    expect(readAwayMarker(db)).toMatchObject({ since: NOW + 5 * MIN });
    at(12 * MIN + 2_000);
    lastInput = clock.time;
    at(12 * MIN + 5_000);
    expect(aways).toEqual([{ awayMs: 7 * MIN + 5_000, deadline: NOW + 12 * MIN + 5_000 + 120_000 }]);
    c.answerAway('discard');
    expect(rows()[0]).toMatchObject({ focusMs: 5 * MIN, discardedMs: 7 * MIN + 5_000 });
  });

  it('turning awayPrompt on while already idle past the threshold charges nothing before the switch', () => {
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    c.start();
    lastInput = NOW + MIN;
    at(15 * MIN); // 14 min idle, all of it kept while the switch was off
    settingsRepo(db).set({ awayPrompt: true });
    c.applySettings();
    at(15 * MIN + 5_000); // the first poll: away, clamped to the switch-on moment
    expect(readAwayMarker(db)).toMatchObject({ since: NOW + 15 * MIN });
    at(17 * MIN + 2_000);
    lastInput = clock.time;
    at(17 * MIN + 5_000);
    expect(aways).toEqual([{ awayMs: 2 * MIN + 5_000, deadline: NOW + 17 * MIN + 5_000 + 120_000 }]);
    c.answerAway('discard');
    expect(rows()[0]).toMatchObject({ focusMs: 15 * MIN, discardedMs: 2 * MIN + 5_000 });
    expect(readAwayMarker(db)).toBeNull();
  });

  it('a crash while away after the switch went on discards only the time since the switch', () => {
    settingsRepo(db).set({ awayPrompt: false });
    c.applySettings();
    c.start();
    lastInput = NOW + MIN;
    at(15 * MIN);
    settingsRepo(db).set({ awayPrompt: true });
    c.applySettings();
    at(16 * MIN); // away since 15:00 (clamped); the last checkpoint is 15:50 (15:05 + 3 × 15 s)
    crashAndRelaunch();
    expect(rows()[0]).toMatchObject({ status: 'done', focusMs: 15 * MIN, discardedMs: 50_000 });
  });

  // ── v1.1: Countdown (spec §3.2) ──

  it('countdown writes one row with its focus and fires segment end with mode countdown', () => {
    c.setMode('countdown');
    expect(c.start()).toMatchObject({ mode: 'countdown', status: 'running', segmentMs: 60 * MIN });
    at(30 * MIN);
    expect(rows()[0]).toMatchObject({ status: 'running', focusMs: 30 * MIN });
    at(60 * MIN);
    expect(ends).toEqual([{ mode: 'countdown', next: 'countdown' }]);
    expect(endLengths).toEqual([60 * MIN]);
    expect(rows()).toEqual([
      expect.objectContaining({ pomodoroId: 'p-1', status: 'done', focusMs: 60 * MIN, endedAt: NOW + 60 * MIN }),
    ]);
    expect(c.getState()).toMatchObject({
      mode: 'countdown',
      status: 'idle',
      remainingMs: 60 * MIN,
      completedFocusCount: 0,
      todayFocusMs: 60 * MIN,
    });
  });

  it('a countdown length changed mid-run applies at the next start; the end reports the run length', () => {
    c.setMode('countdown');
    c.start();
    settingsRepo(db).set({ countdownMinutes: 90 });
    c.applySettings();
    at(60 * MIN);
    expect(endLengths).toEqual([60 * MIN]);
    expect(c.getState()).toMatchObject({ mode: 'countdown', status: 'idle', remainingMs: 90 * MIN });
  });

  it('countdown takes its length from countdownMinutes, resizing the idle segment', () => {
    c.setMode('countdown');
    settingsRepo(db).set({ countdownMinutes: 90 });
    expect(c.applySettings()).toMatchObject({ mode: 'countdown', remainingMs: 90 * MIN, segmentMs: 90 * MIN });
  });

  it('countdown does not auto-start, whatever the toggles say', () => {
    settingsRepo(db).set({ autoStartBreaks: true, autoStartFocus: true, countdownMinutes: 30 });
    c.setMode('countdown');
    c.start();
    at(35 * MIN);
    expect(c.getState()).toMatchObject({ mode: 'countdown', status: 'idle', remainingMs: 30 * MIN });
    expect(rows()).toHaveLength(1);
  });

  it('countdown accrues no time while paused and skip drops a row under a minute', () => {
    c.setMode('countdown');
    c.start();
    at(40_000);
    c.pause();
    at(10 * MIN);
    c.skip();
    expect(rows()).toEqual([]);
    expect(c.getState()).toMatchObject({ mode: 'countdown', status: 'idle', remainingMs: 60 * MIN });
  });

  it('an away discard in a countdown takes the time out and gives it back', () => {
    c.setMode('countdown');
    awayTwelveMinutes();
    const away = 11 * MIN + 5_000;
    const s = c.answerAway('discard');
    expect(s.remainingMs).toBe(60 * MIN - (12 * MIN + 5_000) + away);
    expect(rows()[0]).toMatchObject({ focusMs: MIN, discardedMs: away });
  });

  it('todayFocusMs counts a running countdown live', () => {
    c.setMode('countdown');
    c.start();
    clock.time = NOW + 7_100; // between ticks
    expect(c.getState().todayFocusMs).toBe(7_100);
  });

  // ── v1.1: a task on the timer (spec §3.3) ──

  it('the held task is written on the row and in the state', () => {
    expect(c.setTask(1, 'A')).toMatchObject({ taskId: 1, taskText: 'A', status: 'idle' });
    c.start();
    expect(rows()[0]).toMatchObject({ taskId: 1, taskText: 'A' });
    expect(states.at(-1)).toMatchObject({ taskId: 1, taskText: 'A' });
  });

  it("setTask mid-segment splits the row on the pomodoro's day key", async () => {
    c.dispose();
    await db.close();
    cleanup();
    await setup(new Date(2026, 10, 9, 3, 50, 0).getTime());
    c.setTask(1, 'A');
    c.start();
    clock.advance(10 * MIN); // 04:00, the rollover
    expect(c.setTask(2, 'B')).toMatchObject({ taskId: 2, taskText: 'B', status: 'running' });
    clock.advance(15 * MIN);
    expect(ends).toEqual([{ mode: 'focus', next: 'short' }]);
    expect(rows().map((r) => [r.pomodoroId, r.dayKey, r.taskId, r.taskText, r.focusMs])).toEqual([
      ['p-1', '2026-11-08', 1, 'A', 10 * MIN],
      ['p-1', '2026-11-08', 2, 'B', 15 * MIN],
    ]);
  });

  it('setTask while idle changes the state without a row', () => {
    const before = states.length;
    expect(c.setTask(3, 'Read ch. 4')).toMatchObject({ taskId: 3, taskText: 'Read ch. 4' });
    expect(rows()).toEqual([]);
    expect(states.length).toBeGreaterThan(before);
    expect(c.setTask(null, null)).toMatchObject({ taskId: null, taskText: null });
  });

  it('setTask same id is a no-op', () => {
    c.setTask(1, 'A');
    c.start();
    at(2 * MIN);
    c.setTask(1, 'A edited');
    expect(rows()).toHaveLength(1);
    expect(c.getState()).toMatchObject({ taskId: 1, taskText: 'A' });
  });

  it('the held task carries over a segment end into the next focus row', () => {
    settingsRepo(db).set({ autoStartBreaks: true, autoStartFocus: true });
    c.setTask(1, 'A');
    c.start();
    at(FOCUS + 5 * MIN + MIN);
    expect(rows().map((r) => [r.pomodoroId, r.taskId])).toEqual([
      ['p-1', 1],
      ['p-2', 1],
    ]);
  });
});
