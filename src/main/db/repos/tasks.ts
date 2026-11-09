// Sticky-note tasks (spec §3.10).
import type { TaskPatch } from '../../../shared/ipc';
import type { Task, TaskColour } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, intOrNull, one, text, transaction, type Row } from '../sql';

export interface TasksRepo {
  /** By `sort` then id. */
  list(): Task[];
  /** Added at the end. */
  create(input: { text: string; colour: TaskColour }, now: number): Task;
  /** Ticking a task off stamps `doneAt = now`; unticking clears it. */
  update(id: number, patch: TaskPatch, now: number): Task | null;
  /** Sets `sort` to each id's index in `ids`; ids not listed keep their sort. */
  reorder(ids: number[]): void;
  clearDone(): void;
}

/**
 * Who hears that a task was ticked off, unticked or removed, per database: every `tasksRepo` of a
 * database shares them. The timer listens so a held task that is done or gone leaves it whenever
 * no focus segment runs (v1.1 spec §3.3).
 */
const listeners = new WeakMap<Db, Set<() => void>>();

/** Calls `fn` after every change to a task's done state or a removal; returns the unsubscribe. */
export function onTasksChanged(db: Db, fn: () => void): () => void {
  let set = listeners.get(db);
  if (!set) listeners.set(db, (set = new Set()));
  set.add(fn);
  return () => void set.delete(fn);
}

function notify(db: Db): void {
  for (const fn of [...(listeners.get(db) ?? [])]) fn();
}

const toTask = (r: Row): Task => ({
  id: int(r.id),
  text: text(r.text),
  colour: text(r.colour) as TaskColour,
  done: bool(r.done),
  sort: int(r.sort),
  createdAt: int(r.created_at),
  doneAt: intOrNull(r.done_at),
});

export function tasksRepo(db: Db): TasksRepo {
  const byId = (id: number): Task | null => {
    const r = one(db.raw, 'SELECT * FROM tasks WHERE id = ?', [id]);
    return r ? toTask(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM tasks ORDER BY sort, id').map(toTask),
    create(input, now) {
      const id = insert(
        db.raw,
        `INSERT INTO tasks (text, colour, done, sort, created_at, done_at)
         VALUES (?, ?, 0, (SELECT coalesce(max(sort) + 1, 0) FROM tasks), ?, NULL)`,
        [input.text, input.colour, now],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch, now) {
      const current = byId(id);
      if (!current) return null;
      const done = patch.done ?? current.done;
      const doneAt = done === current.done ? current.doneAt : done ? now : null;
      db.raw.run('UPDATE tasks SET text = ?, colour = ?, done = ?, done_at = ? WHERE id = ?', [
        patch.text ?? current.text,
        patch.colour ?? current.colour,
        done ? 1 : 0,
        doneAt,
        id,
      ]);
      db.markDirty();
      if (done !== current.done) notify(db);
      return byId(id);
    },
    reorder(ids) {
      transaction(db.raw, () => {
        ids.forEach((id, sort) => db.raw.run('UPDATE tasks SET sort = ? WHERE id = ?', [sort, id]));
      });
      db.markDirty();
    },
    clearDone() {
      db.raw.run('DELETE FROM tasks WHERE done = 1');
      db.markDirty();
      notify(db);
    },
  };
}
