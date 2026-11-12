(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMIT_COPY } from '../../shared/planner';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { plannerTasksRepo } from '../db/repos/plannerTasks';
import { settingsRepo } from '../db/repos/settings';
import { subjectsRepo } from '../db/repos/subjects';
import { taskListsRepo } from '../db/repos/taskLists';
import { openTestDb, tempDir } from '../db/test-helpers';
import { plannerService } from './planner';
import { taskWritesService } from './taskWrites';
import { IpcValidationError } from './validate';

/** Wednesday 2026-11-11 15:00 local. */
const NOW = new Date(2026, 10, 11, 15, 0).getTime();
const TODAY = '2026-11-11';

let cleanup: () => void;
let db: Db;
let subjectId: number;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir, NOW);
  settingsRepo(db).set({ rolloverHour: 4 });
  subjectId = subjectsRepo(db).create({ name: 'COMP2221', colour: '#4f8cff' }).id;
});

afterEach(async () => {
  await db.close();
  cleanup();
});

const writes = (now = NOW) => {
  const planner = plannerService({ db, now: () => now, liveTodayMs: () => 0 });
  return taskWritesService({ db, now: () => now, planner });
};
const repo = () => plannerTasksRepo(db);
const onDay = (day: string) => repo().onDays(day, day);
const rejects = (fn: () => unknown, message: string | RegExp) => {
  expect(fn).toThrow(IpcValidationError);
  expect(fn).toThrow(message);
};

describe('taskWritesService', () => {
  it('create defaults to today, at the end, with tags', () => {
    const w = writes();
    const a = w.create({ title: 'Read', tags: ['#Lecture', 'lab'] }).tasks[0]!;
    expect(a.day).toBe(TODAY);
    expect(a.tags).toEqual(['lab', 'lecture']);
    const b = w.create({ title: 'Write' }).tasks[0]!;
    expect(b.sort).toBe(a.sort + 1);
    const list = w.createList({ name: 'Labs' }).at(-1)!;
    const c = w.create({ title: 'Lab', listId: list.id }).tasks[0]!;
    expect(c.listId).toBe(list.id);
    expect(c.day).toBeNull();
    rejects(() => w.create({ title: 'x', listId: 999 }), 'No such list');
    rejects(() => w.create({ title: 'x', subjectId: 999 }), 'No such subject');
  });

  it('create rejects a 21st list and a 31st subtask with the limit copy', () => {
    const w = writes();
    while (taskListsRepo(db).count() < 20) w.createList({ name: `L${taskListsRepo(db).count()}` });
    rejects(() => w.createList({ name: 'one more' }), LIMIT_COPY.lists);
    const t = w.create({ title: 'T' }).tasks[0]!;
    for (let i = 0; i < 30; i++) w.addSubtask(t.id, `s${i}`);
    rejects(() => w.addSubtask(t.id, 'one more'), LIMIT_COPY.subtasks);
  });

  it('counts list names in code points', () => {
    const w = writes();
    expect(() => w.createList({ name: '😀'.repeat(60) })).not.toThrow();
    rejects(() => w.createList({ name: '😀'.repeat(61) }), /list name/);
    rejects(() => w.createList({ name: '   ' }), /list name/);
  });

  it('ticking a daily task creates the next copy with everything but done', () => {
    const w = writes();
    const row = repo().create(
      {
        title: 'Lecture',
        note: 'ch 4',
        colour: 'blue',
        day: TODAY,
        listId: null,
        subjectId,
        estimateMin: 45,
        repeat: { kind: 'daily' },
        reminder: '18:30',
        tags: ['lecture'],
        subtasks: [
          { text: 'a', done: true },
          { text: 'b', done: false },
        ],
      },
      NOW,
    );
    const change = w.update(row.id, { done: true });
    expect(change.tasks).toHaveLength(2);
    const [ticked, copy] = change.tasks;
    expect(ticked!.done).toBe(true);
    expect(copy).toMatchObject({
      title: 'Lecture',
      note: 'ch 4',
      colour: 'blue',
      day: '2026-11-12',
      subjectId,
      estimateMin: 45,
      tags: ['lecture'],
      repeat: { kind: 'daily' },
      reminder: '18:30',
      done: false,
      rolledFrom: null,
    });
    expect(copy!.subtasks.map((s) => [s.text, s.done])).toEqual([
      ['a', false],
      ['b', false],
    ]);
  });

  it('a repeating task ticked late lands on the first matching day on or after today', () => {
    const w = writes();
    const row = repo().create(
      { title: 'Weekly', day: '2026-11-02', listId: null, repeat: { kind: 'weekly' } },
      NOW,
    );
    const change = w.update(row.id, { done: true });
    expect(change.tasks[1]!.day).toBe('2026-11-16');
  });

  it('unticking does not remove the copy', () => {
    const w = writes();
    const row = repo().create({ title: 'D', day: TODAY, listId: null, repeat: { kind: 'daily' } }, NOW);
    w.update(row.id, { done: true });
    const change = w.update(row.id, { done: false });
    expect(change.tasks).toHaveLength(1);
    expect(onDay('2026-11-12')).toHaveLength(1);
  });

  it('a task without a repeat makes no copy on ticking', () => {
    const w = writes();
    const row = repo().create({ title: 'P', day: TODAY, listId: null }, NOW);
    expect(w.update(row.id, { done: true }).tasks).toHaveLength(1);
  });

  it('keeps stored values for patch keys that are present but undefined', () => {
    const w = writes();
    const row = repo().create(
      { title: 'Keep', note: 'n', day: TODAY, listId: null, estimateMin: 30, subjectId },
      NOW,
    );
    const t = w.update(row.id, { title: undefined, note: 'new', estimateMin: undefined, tags: undefined })
      .tasks[0]!;
    expect(t).toMatchObject({ title: 'Keep', note: 'new', estimateMin: 30, subjectId });
    const list = w.createList({ name: 'Keep', subjectId }).at(-1)!;
    const lists = w.updateList(list.id, { name: undefined, subjectId: undefined });
    expect(lists.find((l) => l.id === list.id)).toMatchObject({ name: 'Keep', subjectId });
    const sub = w.addSubtask(row.id, 'x').subtasks[0]!;
    expect(w.updateSubtask(sub.id, { text: undefined, done: true }).subtasks[0]).toMatchObject({
      text: 'x',
      done: true,
    });
  });

  it('refuses a repeat or reminder on a list task', () => {
    const w = writes();
    const list = w.createList({ name: 'L' }).at(-1)!;
    const t = w.create({ title: 'T', listId: list.id }).tasks[0]!;
    rejects(() => w.update(t.id, { repeat: { kind: 'daily' } }), 'Repeat and reminders are for tasks on a day');
    rejects(() => w.update(t.id, { reminder: '09:00' }), 'Repeat and reminders are for tasks on a day');
    expect(() => w.update(t.id, { repeat: null, reminder: null })).not.toThrow();
  });

  it('writes to a missing task are refused and leave no orphans', () => {
    const w = writes();
    rejects(() => w.update(999, { tags: ['x'] }), 'No such task');
    rejects(() => w.addSubtask(999, 'x'), 'No such task');
    rejects(() => w.move(999, { day: TODAY, index: 0 }), 'No such task');
    rejects(() => w.remove(999), 'No such task');
    rejects(() => w.duplicate(999), 'No such task');
    rejects(() => w.reorderSubtasks(999, []), 'No such task');
    expect(all('SELECT count(*) AS n FROM task_tags')).toBe(0);
    expect(all('SELECT count(*) AS n FROM subtasks')).toBe(0);
  });

  it('move from a linked list to a day copies the list subject when the task has none', () => {
    const w = writes();
    const list = w.createList({ name: 'COMP', subjectId }).at(-1)!;
    const plain = w.create({ title: 'plain', listId: list.id }).tasks[0]!;
    const other = subjectsRepo(db).create({ name: 'Other', colour: '#ff0000' }).id;
    const owned = w.create({ title: 'owned', listId: list.id, subjectId: other }).tasks[0]!;
    w.move(plain.id, { day: TODAY, index: 0 });
    w.move(owned.id, { day: TODAY, index: 0 });
    expect(repo().get(plain.id)).toMatchObject({ day: TODAY, listId: null, subjectId });
    expect(repo().get(owned.id)).toMatchObject({ day: TODAY, subjectId: other });
  });

  it('move to a list clears repeat and reminder', () => {
    const w = writes();
    const list = w.createList({ name: 'L' }).at(-1)!;
    const row = repo().create(
      { title: 'R', day: TODAY, listId: null, repeat: { kind: 'daily' }, reminder: '09:00' },
      NOW,
    );
    const other = repo().create({ title: 'O', day: TODAY, listId: null }, NOW);
    const change = w.move(row.id, { listId: list.id, index: 0 });
    const moved = change.tasks.find((t) => t.id === row.id)!;
    expect(moved).toMatchObject({ day: null, listId: list.id, repeat: null, reminder: null });
    expect(repo().get(row.id)!.remindedDay).toBeNull();
    // The day it left is renumbered.
    expect(repo().get(other.id)!.sort).toBe(0);
    rejects(() => w.move(row.id, { listId: 999, index: 0 }), 'No such list');
  });

  it('move reorders within a day', () => {
    const w = writes();
    const [a, b, c] = ['a', 'b', 'c'].map((title) => w.create({ title }).tasks[0]!);
    w.move(c!.id, { day: TODAY, index: 0 });
    expect(onDay(TODAY).map((t) => t.title)).toEqual(['c', 'a', 'b']);
    expect(a && b).toBeTruthy();
  });

  it('remove deletes and reports the id', () => {
    const w = writes();
    const t = w.create({ title: 'gone', tags: ['x'] }).tasks[0]!;
    w.addSubtask(t.id, 's');
    expect(w.remove(t.id)).toEqual({ tasks: [], removed: [t.id] });
    expect(repo().get(t.id)).toBeNull();
    expect(all('SELECT count(*) AS n FROM subtasks')).toBe(0);
  });

  it('duplicate puts an unticked copy right after', () => {
    const w = writes();
    const [a, , c] = ['a', 'b', 'c'].map((title) => w.create({ title, tags: ['t'] }).tasks[0]!);
    w.addSubtask(a!.id, 's');
    w.update(a!.id, { done: false });
    const sub = repo().get(a!.id)!.subtasks[0]!;
    w.updateSubtask(sub.id, { done: true });
    const change = w.duplicate(a!.id);
    const copy = change.tasks.find((t) => t.id !== a!.id && t.title === 'a')!;
    expect(copy.done).toBe(false);
    expect(copy.tags).toEqual(['t']);
    expect(copy.subtasks.map((s) => s.done)).toEqual([false]);
    expect(onDay(TODAY).map((t) => t.title)).toEqual(['a', 'a', 'b', 'c']);
    expect(c).toBeTruthy();
  });

  it('scheduleRevision creates Revise tasks on the chosen days with the exam cap', () => {
    const w = writes();
    const list = w.createList({ name: 'COMP2221', subjectId }).at(-1)!;
    const t = w.create({ title: 'Lecture 5 notes', listId: list.id }).tasks[0]!;
    deadlinesRepo(db).create(
      { title: 'Exam', kind: 'exam', subjectId, due: '2026-11-20T09:00', note: '' },
      NOW,
    );
    const change = w.scheduleRevision(t.id, [1, 3, 7, 21]);
    expect(change.tasks.map((x) => x.day)).toEqual(['2026-11-12', '2026-11-14', '2026-11-18', '2026-11-19']);
    for (const r of change.tasks) {
      expect(r).toMatchObject({
        title: 'Revise: Lecture 5 notes',
        kind: 'revision',
        subjectId,
        tags: ['revision'],
        estimateMin: null,
        originTaskId: t.id,
      });
    }
  });

  it('scheduleRevision on a revision task is refused', () => {
    const w = writes();
    const t = w.create({ title: 'L' }).tasks[0]!;
    const rev = w.scheduleRevision(t.id, [1]).tasks[0]!;
    rejects(() => w.scheduleRevision(rev.id, [1]), 'Revision tasks never offer revision again');
  });

  it('scheduleRevision does not touch the shared default revision days', () => {
    const days = [1, 3, 7, 21];
    const t = writes().create({ title: 'L' }).tasks[0]!;
    writes().scheduleRevision(t.id, days);
    expect(days).toEqual([1, 3, 7, 21]);
  });

  it('rollForward does nothing while the setting is off (the default)', () => {
    repo().create({ title: 'old', day: '2026-11-09', listId: null }, NOW);
    expect(writes().rollForward(NOW)).toEqual({ tasks: [], removed: [] });
    expect(onDay('2026-11-09')).toHaveLength(1);
  });

  it('rollForward moves open past-day tasks, sets rolledFrom, and is idempotent', () => {
    settingsRepo(db).set({ rollTasksForward: true });
    const existing = repo().create({ title: 'today', day: TODAY, listId: null }, NOW);
    const a = repo().create({ title: 'a', day: '2026-11-09', listId: null }, NOW);
    const b = repo().create(
      { title: 'b', day: '2026-11-10', listId: null, rolledFrom: '2026-11-05' },
      NOW,
    );
    const done = repo().create({ title: 'done', day: '2026-11-10', listId: null }, NOW);
    repo().update(done.id, { done: true }, NOW);
    const w = writes();
    const change = w.rollForward(NOW);
    expect(change.tasks.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(repo().get(a.id)).toMatchObject({ day: TODAY, rolledFrom: '2026-11-09' });
    expect(repo().get(b.id)).toMatchObject({ day: TODAY, rolledFrom: '2026-11-05' });
    expect(repo().get(done.id)!.day).toBe('2026-11-10');
    expect(onDay(TODAY).map((t) => t.id)).toEqual([existing.id, a.id, b.id]);
    expect(w.rollForward(NOW).tasks).toEqual([]);
  });

  it('removeList deletes its tasks', () => {
    const w = writes();
    const list = w.createList({ name: 'L' }).at(-1)!;
    const keep = w.createList({ name: 'K' }).at(-1)!;
    const t = w.create({ title: 'in', listId: list.id, tags: ['x'] }).tasks[0]!;
    w.addSubtask(t.id, 's');
    const kept = w.create({ title: 'kept', listId: keep.id }).tasks[0]!;
    const change = w.removeList(list.id);
    expect(change.removed).toEqual([list.id]);
    expect(change.lists.map((l) => l.id)).toContain(keep.id);
    expect(change.lists.map((l) => l.id)).not.toContain(list.id);
    expect(repo().get(t.id)).toBeNull();
    expect(repo().get(kept.id)).not.toBeNull();
    expect(all('SELECT count(*) AS n FROM subtasks')).toBe(0);
    rejects(() => w.removeList(list.id), 'No such list');
  });

  it('clearDone removes only done tasks of that list', () => {
    const w = writes();
    const list = w.createList({ name: 'L' }).at(-1)!;
    const other = w.createList({ name: 'M' }).at(-1)!;
    const a = w.create({ title: 'a', listId: list.id }).tasks[0]!;
    const b = w.create({ title: 'b', listId: list.id }).tasks[0]!;
    const c = w.create({ title: 'c', listId: other.id }).tasks[0]!;
    w.update(a.id, { done: true });
    w.update(c.id, { done: true });
    expect(w.clearDone(list.id)).toEqual({ tasks: [], removed: [a.id] });
    expect(repo().get(b.id)).not.toBeNull();
    expect(repo().get(c.id)).not.toBeNull();
  });

  it('subtasks add, tick, reorder, remove return the parent task', () => {
    const w = writes();
    const t = w.create({ title: 'T' }).tasks[0]!;
    w.addSubtask(t.id, 'one');
    const two = w.addSubtask(t.id, 'two');
    expect(two.id).toBe(t.id);
    const [s1, s2] = two.subtasks;
    expect(w.updateSubtask(s1!.id, { done: true }).subtasks[0]!.done).toBe(true);
    expect(w.reorderSubtasks(t.id, [s2!.id, s1!.id]).subtasks.map((s) => s.text)).toEqual(['two', 'one']);
    const after = w.removeSubtask(s2!.id);
    expect(after.id).toBe(t.id);
    expect(after.subtasks.map((s) => s.text)).toEqual(['one']);
    rejects(() => w.removeSubtask(s2!.id), 'No such subtask');
  });

  it('list reorder and rename return every list', () => {
    const w = writes();
    const a = w.createList({ name: 'A' }).at(-1)!;
    const b = w.createList({ name: 'B' }).at(-1)!;
    const ids = taskListsRepo(db).list().map((l) => l.id).reverse();
    expect(w.reorderLists(ids).map((l) => l.id)).toEqual(ids);
    expect(ids.slice(0, 2)).toEqual([b.id, a.id]);
    expect(w.updateList(a.id, { name: 'A2', subjectId }).find((l) => l.id === a.id)).toMatchObject({
      name: 'A2',
      subjectId,
    });
    rejects(() => w.updateList(999, { name: 'x' }), 'No such list');
    rejects(() => w.updateList(a.id, { subjectId: 999 }), 'No such subject');
    
  });
});

/** The single count a `SELECT count(*) AS n` returns. */
function all(sql: string): number {
  const res = db.raw.exec(sql);
  return Number(res[0]?.values[0]?.[0] ?? 0);
}
