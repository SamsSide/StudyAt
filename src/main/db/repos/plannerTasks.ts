// Planner tasks (v1.2 spec §3.6, §5): dated or in a list, with tags and subtasks. The old
// sticky notes sit untouched in the archive table (migration v4). Limits are checked by IPC and the
// services, not here; the schema's own CHECKs are the backstop.
import type { RepeatRule, Subtask, TaskColour, TaskKind } from '../../../shared/types';
import type { Db } from '../db';
import {
  all,
  bool,
  insert,
  int,
  intOrNull,
  json,
  one,
  text,
  textOrNull,
  transaction,
  type Row,
} from '../sql';

export interface TaskRow {
  id: number;
  title: string;
  note: string;
  done: boolean;
  doneAt: number | null;
  colour: TaskColour | null;
  day: string | null;
  listId: number | null;
  subjectId: number | null;
  estimateMin: number | null;
  repeat: RepeatRule | null;
  reminder: string | null;
  remindedDay: string | null;
  kind: TaskKind;
  originTaskId: number | null;
  rolledFrom: string | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  subtasks: Subtask[];
}

export interface TaskInsert {
  title: string;
  day: string | null;
  listId: number | null;
  note?: string;
  colour?: TaskColour | null;
  subjectId?: number | null;
  estimateMin?: number | null;
  repeat?: RepeatRule | null;
  reminder?: string | null;
  kind?: TaskKind;
  originTaskId?: number | null;
  rolledFrom?: string | null;
  tags?: string[];
  subtasks?: { text: string; done: boolean }[];
}

export type TaskRowPatch = Partial<
  Pick<
    TaskRow,
    | 'title'
    | 'note'
    | 'done'
    | 'colour'
    | 'subjectId'
    | 'estimateMin'
    | 'repeat'
    | 'reminder'
    | 'remindedDay'
    | 'rolledFrom'
    | 'day'
    | 'listId'
    | 'sort'
  >
>;

export interface PlannerTasksRepo {
  get(id: number): TaskRow | null;
  /** Every task, by id (the JSON export). */
  all(): TaskRow[];
  /** Dated tasks with from <= day <= to, by day, done, sort, id. */
  onDays(from: string, to: string): TaskRow[];
  /** Tasks in any list (listId omitted: all lists), by list_id, done, sort, id. */
  inLists(listId?: number): TaskRow[];
  /** Open dated tasks on a day before `day`, by day, sort, id. */
  openBefore(day: string): TaskRow[];
  /** Open dated tasks with a reminder, from <= day <= to. */
  withReminders(from: string, to: string): TaskRow[];
  /** Done tasks with an estimate, from <= day <= to (the Estimates card). */
  doneEstimated(from: string, to: string): TaskRow[];
  /** At the end of its day or list (sort = max + 1); returns the row. */
  create(input: TaskInsert, now: number): TaskRow;
  /** `done` true stamps doneAt = now, false clears it; updatedAt = now; null if missing. */
  update(id: number, patch: TaskRowPatch, now: number): TaskRow | null;
  /**
   * Moves to a day or list at `index` among its new siblings' open tasks, renumbering the
   * siblings' sort 0..n; returns every row whose day, list or sort changed.
   */
  place(id: number, to: { day: string } | { listId: number }, index: number, now: number): TaskRow[];
  setTags(id: number, tags: string[]): void;
  /** Deletes the task, its tags and its subtasks in one transaction; the removed row or null. */
  remove(id: number): TaskRow | null;
  /** Deletes the done tasks of a list (with tags and subtasks); returns their ids. */
  clearDone(listId: number): number[];
  addSubtask(taskId: number, text: string): Subtask;
  updateSubtask(id: number, patch: { text?: string; done?: boolean }): Subtask | null;
  removeSubtask(id: number): Subtask | null;
  reorderSubtasks(taskId: number, ids: number[]): void;
}

/**
 * Who hears that a task was ticked off, unticked or removed, per database: every
 * `plannerTasksRepo` of a database shares them.
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
  // A write has already happened: a listener that throws must not fail it or silence the others.
  for (const fn of [...(listeners.get(db) ?? [])]) {
    try {
      fn();
    } catch (err) {
      console.error('StudyAt: task listener failed', err);
    }
  }
}

const toSubtask = (r: Row): Subtask => ({
  id: int(r.id),
  taskId: int(r.task_id),
  text: text(r.text),
  done: bool(r.done),
  sort: int(r.sort),
});

const placeholders = (n: number): string => Array<string>(n).fill('?').join(', ');

interface Container {
  day: string | null;
  listId: number | null;
}

export function plannerTasksRepo(db: Db): PlannerTasksRepo {
  /** Tags and subtasks for a batch of task rows: two queries however many rows. */
  const hydrate = (rows: Row[]): TaskRow[] => {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => int(r.id));
    const marks = placeholders(ids.length);
    const tags = new Map<number, string[]>();
    for (const t of all(
      db.raw,
      `SELECT task_id, tag FROM task_tags WHERE task_id IN (${marks}) ORDER BY tag`,
      ids,
    )) {
      const list = tags.get(int(t.task_id)) ?? [];
      list.push(text(t.tag));
      tags.set(int(t.task_id), list);
    }
    const subs = new Map<number, Subtask[]>();
    for (const s of all(
      db.raw,
      `SELECT * FROM subtasks WHERE task_id IN (${marks}) ORDER BY sort, id`,
      ids,
    )) {
      const list = subs.get(int(s.task_id)) ?? [];
      list.push(toSubtask(s));
      subs.set(int(s.task_id), list);
    }
    return rows.map((r) => {
      const id = int(r.id);
      return {
        id,
        title: text(r.title),
        note: text(r.note),
        done: bool(r.done),
        doneAt: intOrNull(r.done_at),
        colour: textOrNull(r.colour) as TaskColour | null,
        day: textOrNull(r.day),
        listId: intOrNull(r.list_id),
        subjectId: intOrNull(r.subject_id),
        estimateMin: intOrNull(r.estimate_min),
        repeat: json<RepeatRule | null>(r.repeat, null),
        reminder: textOrNull(r.reminder),
        remindedDay: textOrNull(r.reminded_day),
        kind: text(r.kind) as TaskKind,
        originTaskId: intOrNull(r.origin_task_id),
        rolledFrom: textOrNull(r.rolled_from),
        sort: int(r.sort),
        createdAt: int(r.created_at),
        updatedAt: int(r.updated_at),
        tags: tags.get(id) ?? [],
        subtasks: subs.get(id) ?? [],
      };
    });
  };

  const query = (sql: string, params: (string | number)[] = []): TaskRow[] =>
    hydrate(all(db.raw, sql, params));
  const byId = (id: number): TaskRow | null => query('SELECT * FROM tasks WHERE id = ?', [id])[0] ?? null;
  const inContainer = (c: Container): TaskRow[] =>
    c.day !== null
      ? query('SELECT * FROM tasks WHERE day = ?', [c.day])
      : query('SELECT * FROM tasks WHERE list_id = ?', [c.listId ?? -1]);

  const deleteRows = (ids: number[]): void => {
    for (const id of ids) {
      db.raw.run('DELETE FROM task_tags WHERE task_id = ?', [id]);
      db.raw.run('DELETE FROM subtasks WHERE task_id = ?', [id]);
      db.raw.run('DELETE FROM tasks WHERE id = ?', [id]);
    }
  };

  const writeTags = (id: number, tags: string[]): void => {
    db.raw.run('DELETE FROM task_tags WHERE task_id = ?', [id]);
    for (const tag of new Set(tags))
      db.raw.run('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)', [id, tag]);
  };

  const subtaskById = (id: number): Subtask | null => {
    const r = one(db.raw, 'SELECT * FROM subtasks WHERE id = ?', [id]);
    return r ? toSubtask(r) : null;
  };

  return {
    get: byId,
    all: () => query('SELECT * FROM tasks ORDER BY id'),
    onDays: (from, to) =>
      query('SELECT * FROM tasks WHERE day >= ? AND day <= ? ORDER BY day, done, sort, id', [from, to]),
    inLists: (listId) =>
      listId === undefined
        ? query('SELECT * FROM tasks WHERE list_id IS NOT NULL ORDER BY list_id, done, sort, id')
        : query('SELECT * FROM tasks WHERE list_id = ? ORDER BY done, sort, id', [listId]),
    openBefore: (day) =>
      query('SELECT * FROM tasks WHERE done = 0 AND day < ? ORDER BY day, sort, id', [day]),
    withReminders: (from, to) =>
      query(
        `SELECT * FROM tasks WHERE done = 0 AND reminder IS NOT NULL AND day >= ? AND day <= ?
         ORDER BY day, sort, id`,
        [from, to],
      ),
    doneEstimated: (from, to) =>
      query(
        `SELECT * FROM tasks WHERE done = 1 AND estimate_min IS NOT NULL AND day >= ? AND day <= ?
         ORDER BY day, sort, id`,
        [from, to],
      ),
    create(input, now) {
      if ((input.day === null) === (input.listId === null)) {
        throw new Error('A task needs exactly one of a day and a list');
      }
      const id = transaction(db.raw, () => {
        const where = input.day !== null ? 'day = ?' : 'list_id = ?';
        const taskId = insert(
          db.raw,
          `INSERT INTO tasks (title, note, done, done_at, colour, day, list_id, subject_id, estimate_min,
                              repeat, reminder, reminded_day, kind, origin_task_id, rolled_from,
                              sort, created_at, updated_at)
           VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?,
                   (SELECT coalesce(max(sort) + 1, 0) FROM tasks WHERE ${where}), ?, ?)`,
          [
            input.title,
            input.note ?? '',
            input.colour ?? null,
            input.day,
            input.listId,
            input.subjectId ?? null,
            input.estimateMin ?? null,
            input.repeat ? JSON.stringify(input.repeat) : null,
            input.reminder ?? null,
            input.kind ?? 'task',
            input.originTaskId ?? null,
            input.rolledFrom ?? null,
            input.day ?? input.listId,
            now,
            now,
          ],
        );
        writeTags(taskId, input.tags ?? []);
        (input.subtasks ?? []).forEach((s, sort) =>
          db.raw.run('INSERT INTO subtasks (task_id, text, done, sort) VALUES (?, ?, ?, ?)', [
            taskId,
            s.text,
            s.done ? 1 : 0,
            sort,
          ]),
        );
        return taskId;
      });
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch, now) {
      const current = byId(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      const doneAt = next.done === current.done ? current.doneAt : next.done ? now : null;
      db.raw.run(
        `UPDATE tasks SET title = ?, note = ?, done = ?, done_at = ?, colour = ?, day = ?, list_id = ?,
                subject_id = ?, estimate_min = ?, repeat = ?, reminder = ?, reminded_day = ?,
                rolled_from = ?, sort = ?, updated_at = ? WHERE id = ?`,
        [
          next.title,
          next.note,
          next.done ? 1 : 0,
          doneAt,
          next.colour,
          next.day,
          next.listId,
          next.subjectId,
          next.estimateMin,
          next.repeat ? JSON.stringify(next.repeat) : null,
          next.reminder,
          next.remindedDay,
          next.rolledFrom,
          next.sort,
          now,
          id,
        ],
      );
      db.markDirty();
      if (next.done !== current.done) notify(db);
      return byId(id);
    },
    place(id, to, index, now) {
      const current = byId(id);
      if (!current) return [];
      const target: Container =
        'day' in to ? { day: to.day, listId: null } : { day: null, listId: to.listId };
      const before = new Map<number, TaskRow>([[id, current]]);
      for (const t of [...inContainer(current), ...inContainer(target)]) before.set(t.id, t);

      const open = (c: Container): number[] =>
        [...before.values()]
          .filter((t) => t.id !== id && !t.done && t.day === c.day && t.listId === c.listId)
          .sort((a, b) => a.sort - b.sort || a.id - b.id)
          .map((t) => t.id);

      transaction(db.raw, () => {
        const renumber = (ids: number[]): void =>
          ids.forEach((tid, sort) => db.raw.run('UPDATE tasks SET sort = ? WHERE id = ?', [sort, tid]));
        // The old container first, without the task; then the new one with it inserted.
        renumber(open(current));
        const siblings = open(target);
        siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, id);
        db.raw.run('UPDATE tasks SET day = ?, list_id = ?, updated_at = ? WHERE id = ?', [
          target.day,
          target.listId,
          now,
          id,
        ]);
        renumber(siblings);
      });
      db.markDirty();
      return query(`SELECT * FROM tasks WHERE id IN (${placeholders(before.size)}) ORDER BY id`, [
        ...before.keys(),
      ]).filter((after) => {
        const was = before.get(after.id)!;
        return after.day !== was.day || after.listId !== was.listId || after.sort !== was.sort;
      });
    },
    setTags(id, tags) {
      transaction(db.raw, () => writeTags(id, tags));
      db.markDirty();
    },
    remove(id) {
      const current = byId(id);
      if (!current) return null;
      transaction(db.raw, () => deleteRows([id]));
      db.markDirty();
      notify(db);
      return current;
    },
    clearDone(listId) {
      const ids = all(db.raw, 'SELECT id FROM tasks WHERE list_id = ? AND done = 1 ORDER BY id', [
        listId,
      ]).map((r) => int(r.id));
      if (ids.length === 0) return [];
      transaction(db.raw, () => deleteRows(ids));
      db.markDirty();
      notify(db);
      return ids;
    },
    addSubtask(taskId, subText) {
      const id = insert(
        db.raw,
        `INSERT INTO subtasks (task_id, text, done, sort)
         VALUES (?, ?, 0, (SELECT coalesce(max(sort) + 1, 0) FROM subtasks WHERE task_id = ?))`,
        [taskId, subText, taskId],
      );
      db.markDirty();
      return subtaskById(id)!;
    },
    updateSubtask(id, patch) {
      const current = subtaskById(id);
      if (!current) return null;
      db.raw.run('UPDATE subtasks SET text = ?, done = ? WHERE id = ?', [
        patch.text ?? current.text,
        (patch.done ?? current.done) ? 1 : 0,
        id,
      ]);
      db.markDirty();
      return subtaskById(id);
    },
    removeSubtask(id) {
      const current = subtaskById(id);
      if (!current) return null;
      db.raw.run('DELETE FROM subtasks WHERE id = ?', [id]);
      db.markDirty();
      return current;
    },
    reorderSubtasks(taskId, ids) {
      transaction(db.raw, () => {
        ids.forEach((id, sort) =>
          db.raw.run('UPDATE subtasks SET sort = ? WHERE id = ? AND task_id = ?', [sort, id, taskId]),
        );
      });
      db.markDirty();
    },
  };
}
