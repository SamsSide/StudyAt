import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayKeyOf } from '../../core/time';
import type { Db } from '../db/db';
import { recapsRepo } from '../db/repos/recaps';
import { sessionsRepo } from '../db/repos/sessions';
import { subjectsRepo } from '../db/repos/subjects';
import { openTestDb, tempDir } from '../db/test-helpers';
import { recapsService } from './recaps';
import { statsService } from './stats';
import { IpcValidationError } from './validate';

const MIN = 60_000;
/** Wednesday 2026-11-11 12:00 local. */
const WED = new Date(2026, 10, 11, 12, 0).getTime();

let cleanup: () => void;
let db: Db;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir, WED);
});

afterEach(async () => {
  await db.close();
  cleanup();
});

/** A finished focus row of `minutes`, started at `start`. */
function addSession(start: number, minutes: number, subjectId: number | null = null): number {
  const repo = sessionsRepo(db);
  const row = repo.insertRunning({ pomodoroId: `p${start}`, subjectId, startedAt: start, dayKey: dayKeyOf(start, 4) });
  repo.close(row.id, start + minutes * MIN, minutes * MIN, 0);
  return row.id;
}

describe('statsService', () => {
  it('adds the running row live accrual to today, across every view', () => {
    addSession(WED - 3 * 3_600_000, 30);
    const running = sessionsRepo(db).insertRunning({ pomodoroId: 'live', subjectId: null, startedAt: WED - 10 * MIN, dayKey: dayKeyOf(WED, 4) });
    sessionsRepo(db).checkpoint(running.id, 5 * MIN, WED - 5 * MIN);
    // The controller's figure: 30 min done + 10 min of the running row (5 not yet checkpointed).
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 40 * MIN });
    expect(stats.overview().todayMs).toBe(40 * MIN);
    expect(stats.overview().weekMs).toBe(40 * MIN);
    expect(stats.week().days.find((d) => d.dayKey === '2026-11-11')?.ms).toBe(40 * MIN);
    expect(stats.heatmap().find((c) => c.dayKey === '2026-11-11')?.ms).toBe(40 * MIN);
    // The stored rows are untouched.
    expect(stats.sessions().find((s) => s.id === running.id)?.focusMs).toBe(5 * MIN);
  });

  it('week normalises any day to its Monday', () => {
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 0 });
    expect(stats.week('2026-11-13').weekStart).toBe('2026-11-09');
    expect(stats.week().weekStart).toBe('2026-11-09');
  });

  it('edits a done session subject but never a running one', () => {
    const id = addSession(WED - 3 * 3_600_000, 30);
    const subject = subjectsRepo(db).list()[0]!.id;
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 0 });
    stats.updateSession(id, subject);
    expect(stats.sessions().find((s) => s.id === id)?.subjectId).toBe(subject);
    expect(() => stats.updateSession(id, 9999)).toThrow(IpcValidationError);
    const running = sessionsRepo(db).insertRunning({ pomodoroId: 'r', subjectId: null, startedAt: WED, dayKey: '2026-11-11' });
    expect(() => stats.deleteSession(running.id)).toThrow(IpcValidationError);
    stats.deleteSession(id);
    expect(stats.sessions().some((s) => s.id === id)).toBe(false);
  });
});

describe('recapsService', () => {
  it('recaps computePending stores past weeks and returns last unshown once', () => {
    // Two weeks back (Mon 26 Oct) and last week (Tue 3 Nov); nothing in the week between.
    addSession(new Date(2026, 9, 27, 10).getTime(), 50);
    addSession(new Date(2026, 10, 3, 10).getTime(), 40);
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 0 });
    const recaps = recapsService({ db, stats });

    const pending = recaps.computePending(WED);
    expect(pending?.weekStart).toBe('2026-11-02');
    expect(pending?.totalMs).toBe(40 * MIN);
    expect(pending?.prevTotalMs).toBe(50 * MIN);
    expect(recaps.list().map((r) => r.weekStart)).toEqual(['2026-10-26', '2026-11-02']);

    // Until it is marked shown it stays pending; then never again.
    expect(recaps.computePending(WED)?.weekStart).toBe('2026-11-02');
    recaps.markShown('2026-11-02', WED);
    expect(recaps.computePending(WED)).toBeNull();
    expect(recapsRepo(db).get('2026-11-02')?.shownAt).toBe(WED);

    // A week later the finished week (empty) is computed and offered.
    const nextWed = WED + 7 * 86_400_000;
    const empty = recaps.computePending(nextWed);
    expect(empty).toMatchObject({ weekStart: '2026-11-09', totalMs: 0, daysStudied: 0 });
    expect(recaps.list()).toHaveLength(3);
  });

  it('R25: a subject change or delete refreshes a stored recap of that week, keeping shown_at', () => {
    const a = addSession(new Date(2026, 10, 3, 10).getTime(), 40);
    const b = addSession(new Date(2026, 10, 4, 10).getTime(), 30);
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 0 });
    const recaps = recapsService({ db, stats });
    recaps.computePending(WED);
    recaps.markShown('2026-11-02', WED);
    const subject = subjectsRepo(db).list()[1]!;

    recaps.refreshWeekOf(stats.updateSession(a, subject.id), WED);
    expect(recapsRepo(db).get('2026-11-02')?.recap.topSubjects[0]).toMatchObject({ subjectId: subject.id, ms: 40 * MIN });
    recaps.refreshWeekOf(stats.deleteSession(b), WED);
    const stored = recapsRepo(db).get('2026-11-02')!;
    expect(stored.recap.totalMs).toBe(40 * MIN);
    expect(stored.shownAt).toBe(WED);

    // A week with no stored recap gets none.
    const c = addSession(WED - 3_600_000, 30);
    recaps.refreshWeekOf(stats.deleteSession(c), WED);
    expect(recapsRepo(db).get('2026-11-09')).toBeNull();
  });

  it('computes nothing without any sessions', () => {
    const stats = statsService({ db, now: () => WED, liveTodayMs: () => 0 });
    expect(recapsService({ db, stats }).computePending(WED)).toBeNull();
  });
});
