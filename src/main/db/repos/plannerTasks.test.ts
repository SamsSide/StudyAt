import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { onTasksChanged, plannerTasksRepo, type PlannerTasksRepo } from './plannerTasks';
import { one } from '../sql';

const D = '2026-11-09';

describe('plannerTasksRepo', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;
  let repo: PlannerTasksRepo;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir);
    repo = plannerTasksRepo(db);
  });
  afterEach(async () => {
    await db.close();
    cleanup();
  });

  const count = (table: string): number => Number(one(db.raw, `SELECT count(*) AS n FROM ${table}`)!.n);
  const dated = (title: string, day = D) => repo.create({ title, day, listId: null }, NOW);
  const listed = (title: string, listId = 1) => repo.create({ title, day: null, listId }, NOW);

  it('creates a dated task at the end of its day with tags and subtasks', () => {
    const a = dated('A');
    const b = repo.create(
      {
        title: 'B',
        day: D,
        listId: null,
        tags: ['lecture', 'a-b'],
        subtasks: [
          { text: 'one', done: false },
          { text: 'two', done: true },
        ],
      },
      NOW + 1,
    );
    expect([a.sort, b.sort]).toEqual([0, 1]);
    expect(b.tags).toEqual(['a-b', 'lecture']);
    expect(b.subtasks.map((s) => [s.text, s.done, s.sort])).toEqual([
      ['one', false, 0],
      ['two', true, 1],
    ]);
    expect(b).toMatchObject({ note: '', done: false, doneAt: null, kind: 'task', createdAt: NOW + 1 });
    expect(listed('L').sort).toBe(0);
    expect(listed('L2').sort).toBe(1);
  });

  it('the placement check rejects both and neither', () => {
    expect(() => repo.create({ title: 'x', day: 'x', listId: 1 }, NOW)).toThrow();
    expect(() => repo.create({ title: 'x', day: null, listId: null }, NOW)).toThrow();
    expect(count('tasks')).toBe(0);
  });

  it('update ticks and unticks, stamping doneAt; notifies listeners on done changes and removal', () => {
    const fn = vi.fn();
    onTasksChanged(db, fn);
    const t = dated('A');
    expect(repo.update(t.id, { done: true }, NOW + 5)).toMatchObject({
      done: true,
      doneAt: NOW + 5,
      updatedAt: NOW + 5,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(repo.update(t.id, { done: false }, NOW + 6)).toMatchObject({ done: false, doneAt: null });
    expect(fn).toHaveBeenCalledTimes(2);
    repo.update(t.id, { title: 'B' }, NOW + 7);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(repo.get(t.id)!.title).toBe('B');
    repo.remove(t.id);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(repo.update(t.id, { title: 'x' }, NOW)).toBeNull();
  });

  it('repeat round-trips as JSON', () => {
    const t = repo.create({ title: 'R', day: D, listId: null, repeat: { kind: 'every', days: 3 } }, NOW);
    expect(repo.get(t.id)!.repeat).toEqual({ kind: 'every', days: 3 });
    repo.update(t.id, { repeat: null }, NOW);
    expect(repo.get(t.id)!.repeat).toBeNull();
  });

  it('onDays orders open before done, then sort', () => {
    const a = dated('A');
    const b = dated('B');
    repo.update(a.id, { done: true }, NOW);
    dated('other', '2026-11-12');
    dated('outside', '2026-11-20');
    expect(repo.onDays(D, '2026-11-12').map((t) => t.title)).toEqual(['B', 'A', 'other']);
    expect(repo.get(a.id)!.sort).toBe(0);
    expect(repo.get(b.id)!.sort).toBe(1);
  });

  it('place moves a task from a list to a day at an index and renumbers both', () => {
    const a = listed('A');
    const b = listed('B');
    const c = dated('C');
    const d = dated('D');
    const changed = repo.place(b.id, { day: D }, 1, NOW + 9);
    expect(repo.onDays(D, D).map((t) => [t.title, t.sort])).toEqual([
      ['C', 0],
      ['B', 1],
      ['D', 2],
    ]);
    expect(repo.get(b.id)).toMatchObject({ day: D, listId: null, updatedAt: NOW + 9 });
    expect(repo.get(a.id)!.sort).toBe(0);
    expect(changed.map((t) => t.id).sort()).toEqual([b.id, d.id].sort());
    expect(changed.map((t) => t.id)).not.toContain(c.id);
    expect(changed.map((t) => t.id)).not.toContain(a.id);
  });

  it('place renumbers the list it leaves and reorders within a container', () => {
    const a = listed('A');
    const b = listed('B');
    const c = listed('C');
    const changed = repo.place(a.id, { day: D }, 0, NOW);
    expect(repo.inLists(1).map((t) => [t.title, t.sort])).toEqual([
      ['B', 0],
      ['C', 1],
    ]);
    expect(changed.map((t) => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    repo.place(c.id, { listId: 1 }, 0, NOW);
    expect(repo.inLists(1).map((t) => t.title)).toEqual(['C', 'B']);
    expect(repo.place(9999, { day: D }, 0, NOW)).toEqual([]);
  });

  it('remove deletes tags and subtasks too', () => {
    const t = repo.create(
      { title: 'T', day: D, listId: null, tags: ['a', 'b'], subtasks: [{ text: 's', done: false }] },
      NOW,
    );
    const keep = repo.create({ title: 'K', day: D, listId: null, tags: ['k'] }, NOW);
    expect(count('task_tags')).toBe(3);
    expect(repo.remove(t.id)).toMatchObject({ id: t.id, title: 'T' });
    expect(count('task_tags')).toBe(1);
    expect(count('subtasks')).toBe(0);
    expect(repo.get(keep.id)).not.toBeNull();
    expect(repo.remove(t.id)).toBeNull();
  });

  it("clearDone(list) removes only that list's done tasks", () => {
    const a = listed('A');
    const b = repo.create({ title: 'B', day: null, listId: 1, tags: ['x'] }, NOW);
    const other = listed('O', 2);
    const dayTask = dated('D');
    for (const t of [a, other, dayTask]) repo.update(t.id, { done: true }, NOW);
    const fn = vi.fn();
    onTasksChanged(db, fn);
    expect(repo.clearDone(1)).toEqual([a.id]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(repo.get(a.id)).toBeNull();
    expect(repo.get(b.id)).not.toBeNull();
    expect(repo.get(other.id)).not.toBeNull();
    expect(repo.get(dayTask.id)).not.toBeNull();
    expect(repo.clearDone(1)).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('subtasks add, tick, rename, reorder, remove', () => {
    const t = dated('T');
    const s1 = repo.addSubtask(t.id, 'one');
    const s2 = repo.addSubtask(t.id, 'two');
    expect([s1.sort, s2.sort]).toEqual([0, 1]);
    expect(repo.updateSubtask(s1.id, { done: true })).toMatchObject({ done: true, text: 'one' });
    expect(repo.updateSubtask(s1.id, { text: 'uno' })).toMatchObject({ done: true, text: 'uno' });
    expect(repo.updateSubtask(9999, { done: true })).toBeNull();
    repo.reorderSubtasks(t.id, [s2.id, s1.id]);
    expect(repo.get(t.id)!.subtasks.map((s) => s.text)).toEqual(['two', 'uno']);
    expect(repo.removeSubtask(s2.id)).toMatchObject({ text: 'two' });
    expect(repo.removeSubtask(s2.id)).toBeNull();
    expect(repo.get(t.id)!.subtasks).toHaveLength(1);
  });

  it('setTags replaces tags and dedupes', () => {
    const t = repo.create({ title: 'T', day: D, listId: null, tags: ['a'] }, NOW);
    repo.setTags(t.id, ['z', 'b', 'z']);
    expect(repo.get(t.id)!.tags).toEqual(['b', 'z']);
  });

  it('openBefore and withReminders and doneEstimated filter as named', () => {
    const early = dated('early', '2026-11-05');
    const doneEarly = dated('doneEarly', '2026-11-06');
    repo.update(doneEarly.id, { done: true }, NOW);
    dated('today', '2026-11-08');
    listed('listed');
    expect(repo.openBefore('2026-11-08').map((t) => t.id)).toEqual([early.id]);

    const r1 = repo.create({ title: 'r1', day: D, listId: null, reminder: '09:00' }, NOW);
    const r2 = repo.create({ title: 'r2', day: '2026-11-20', listId: null, reminder: '10:00' }, NOW);
    const r3 = repo.create({ title: 'r3', day: D, listId: null, reminder: '11:00' }, NOW);
    repo.update(r3.id, { done: true }, NOW);
    expect(repo.withReminders(D, '2026-11-10').map((t) => t.id)).toEqual([r1.id]);
    expect(repo.withReminders(D, '2026-11-30').map((t) => t.id)).toEqual([r1.id, r2.id]);

    const e1 = repo.create({ title: 'e1', day: D, listId: null, estimateMin: 30 }, NOW);
    const e2 = repo.create({ title: 'e2', day: D, listId: null, estimateMin: 30 }, NOW);
    const e3 = dated('noEstimate');
    for (const t of [e1, e3]) repo.update(t.id, { done: true }, NOW);
    expect(repo.doneEstimated(D, D).map((t) => t.id)).toEqual([e1.id]);
    expect(repo.get(e2.id)!.done).toBe(false);
    expect(repo.all()).toHaveLength(count('tasks'));
  });
});
