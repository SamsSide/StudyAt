(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayKeyOf } from '../../core/time';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { plannerTasksRepo } from '../db/repos/plannerTasks';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { taskListsRepo } from '../db/repos/taskLists';
import { openTestDb, tempDir } from '../db/test-helpers';
import { deadlineDay, plannerService } from './planner';

const MIN = 60_000;
/** Wednesday 2026-11-11 15:00 local. */
const NOW = new Date(2026, 10, 11, 15, 0).getTime();

let cleanup: () => void;
let db: Db;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir, NOW);
  settingsRepo(db).set({ rolloverHour: 4 });
});

afterEach(async () => {
  await db.close();
  cleanup();
});

const svc = (now = NOW, live = 0) => plannerService({ db, now: () => now, liveTodayMs: () => live });

/** A finished focus row of `minutes` for `taskId`, started at `start`. */
function addSession(start: number, minutes: number, taskId: number | null = null): void {
  const repo = sessionsRepo(db);
  const row = repo.insertRunning({
    pomodoroId: `p${start}`,
    subjectId: null,
    taskId,
    taskText: null,
    startedAt: start,
    dayKey: dayKeyOf(start, 4),
  });
  repo.close(row.id, start + minutes * MIN, minutes * MIN, 0);
}

const dated = (title: string, day: string, extra: { subjectId?: number | null } = {}) =>
  plannerTasksRepo(db).create({ title, day, listId: null, ...extra }, NOW);

describe('plannerService', () => {
  it('today follows the rollover hour', () => {
    expect(svc().today()).toBe('2026-11-11');
    expect(svc(new Date(2026, 10, 12, 2, 0).getTime()).today()).toBe('2026-11-11');
    expect(svc(new Date(2026, 10, 12, 4, 0).getTime()).today()).toBe('2026-11-12');
  });

  it("a task in a linked list takes the list's subject; its own subject wins", () => {
    const list = taskListsRepo(db).create({ name: 'Revision', subjectId: 3 }, NOW);
    const plain = plannerTasksRepo(db).create({ title: 'a', day: null, listId: list.id }, NOW);
    const own = plannerTasksRepo(db).create({ title: 'b', day: null, listId: list.id, subjectId: 5 }, NOW);
    const none = dated('c', '2026-11-11');
    const s = svc();
    expect(s.effectiveSubject(plain)).toBe(3);
    expect(s.effectiveSubject(own)).toBe(5);
    expect(s.effectiveSubject(none)).toBeNull();
    const byId = new Map(s.toPlanner([plain, own, none]).map((t) => [t.id, t.effectiveSubjectId]));
    expect(byId.get(plain.id)).toBe(3);
    expect(byId.get(own.id)).toBe(5);
    expect(byId.get(none.id)).toBeNull();
  });

  it('actualMs sums focus of sessions with the task id, including the running row live', () => {
    const task = dated('t', '2026-11-11');
    addSession(NOW - 5 * 3_600_000, 10, task.id);
    addSession(NOW - 4 * 3_600_000, 15, task.id);
    addSession(NOW - 3 * 3_600_000, 20, null);
    const repo = sessionsRepo(db);
    const running = repo.insertRunning({
      pomodoroId: 'live',
      subjectId: null,
      taskId: task.id,
      taskText: null,
      startedAt: NOW - 10 * MIN,
      dayKey: dayKeyOf(NOW, 4),
    });
    repo.checkpoint(running.id, 2 * MIN, NOW - 5 * MIN);
    // Stored today: 10 + 15 + 20 + 2 = 47 min; the controller says 52 (5 min not yet checkpointed).
    const s = svc(NOW, 52 * MIN);
    expect(s.actualByTask().get(task.id)).toBe(32 * MIN);
    expect(s.task(task.id)?.actualMs).toBe(32 * MIN);
    expect(s.task(9999)).toBeNull();
    // Read-only: the running row is unchanged.
    expect(repo.all().find((r) => r.id === running.id)?.focusMs).toBe(2 * MIN);
  });

  it('week returns Mon..Sun tasks open before done, deadlines due that week and studied per day', () => {
    const tasks = plannerTasksRepo(db);
    dated('mon', '2026-11-09');
    const sun = dated('sun', '2026-11-15');
    dated('next', '2026-11-16');
    const doneMon = dated('done mon', '2026-11-09');
    tasks.update(doneMon.id, { done: true }, NOW);
    const dl = deadlinesRepo(db);
    const exam = dl.create({ title: 'Exam', kind: 'exam', subjectId: null, due: '2026-11-12T09:00', note: '' }, NOW);
    const finished = dl.create({ title: 'Old', kind: 'exam', subjectId: null, due: '2026-11-13T09:00', note: '' }, NOW);
    dl.update(finished.id, { done: true }, NOW);
    dl.create({ title: 'Later', kind: 'coursework', subjectId: null, due: '2026-11-16T09:00', note: '' }, NOW);
    addSession(new Date(2026, 10, 10, 10, 0).getTime(), 30);

    const w = svc().week('2026-11-12');
    expect(w.from).toBe('2026-11-09');
    expect(w.to).toBe('2026-11-15');
    expect(w.tasks.map((t) => t.title)).toEqual(['mon', 'done mon', 'sun']);
    expect(w.tasks[2]?.id).toBe(sun.id);
    expect(w.deadlines.map((d) => d.id)).toEqual([exam.id]);
    expect(w.studiedMs['2026-11-10']).toBe(30 * MIN);
    expect(svc().day('2026-11-15').tasks.map((t) => t.title)).toEqual(['sun']);
  });

  it('month covers whole Mon-Sun weeks', () => {
    const m = svc().month('2026-11');
    expect(m.from).toBe('2026-10-26');
    expect(m.to).toBe('2026-12-06');
  });

  it('studied per day is focus time credited to the start day', () => {
    // 23:50 Tuesday for 30 min crosses midnight: credited to Tuesday.
    addSession(new Date(2026, 10, 10, 23, 50).getTime(), 30);
    const w = svc().week('2026-11-10');
    expect(w.studiedMs['2026-11-10']).toBe(30 * MIN);
    expect(w.studiedMs['2026-11-11']).toBeUndefined();
  });

  it('a deadline at 02:00 with rollover 04:00 belongs to the previous study day', () => {
    expect(deadlineDay('2026-11-12T02:00', 4)).toBe('2026-11-11');
    expect(deadlineDay('2026-11-12T04:00', 4)).toBe('2026-11-12');
    expect(deadlineDay('2026-11-12T09:00', 4)).toBe('2026-11-12');
    deadlinesRepo(db).create({ title: 'Night exam', kind: 'exam', subjectId: null, due: '2026-11-12T02:00', note: '' }, NOW);
    expect(svc().day('2026-11-11').deadlines).toHaveLength(1);
    expect(svc().day('2026-11-12').deadlines).toHaveLength(0);
  });

  it('lists returns lists, their tasks and upcoming deadlines', () => {
    const lists = taskListsRepo(db);
    const a = lists.create({ name: 'A', subjectId: null }, NOW);
    const b = lists.create({ name: 'B', subjectId: null }, NOW);
    const tasks = plannerTasksRepo(db);
    const bTask = tasks.create({ title: 'b1', day: null, listId: b.id }, NOW);
    const aDone = tasks.create({ title: 'a done', day: null, listId: a.id }, NOW);
    tasks.update(aDone.id, { done: true }, NOW);
    tasks.create({ title: 'a open', day: null, listId: a.id }, NOW);
    dated('dated', '2026-11-11');
    const dl = deadlinesRepo(db);
    dl.create({ title: 'Past', kind: 'exam', subjectId: null, due: '2026-11-11T09:00', note: '' }, NOW);
    const soon = dl.create({ title: 'Soon', kind: 'exam', subjectId: null, due: '2026-11-12T09:00', note: '' }, NOW);
    const late = dl.create({ title: 'Late', kind: 'coursework', subjectId: null, due: '2026-12-01T09:00', note: '' }, NOW);
    const v = svc().lists();
    expect(v.lists.map((l) => l.name).slice(-2)).toEqual(['A', 'B']); // the migration seeds course lists first
    expect(v.tasks.map((t) => t.title)).toEqual(['a open', 'a done', 'b1']);
    expect(v.tasks[2]?.id).toBe(bTask.id);
    expect(v.deadlines.map((d) => d.id)).toEqual([soon.id, late.id]);
  });
});
