// Planner lists (v1.2 spec §3.6, §5): named groups of undated tasks, each with an optional subject.
import type { TaskList } from '../../../shared/types';
import type { Db } from '../db';
import { all, insert, int, intOrNull, one, text, transaction, type Row } from '../sql';

export interface TaskListsRepo {
  /** By `sort` then id. */
  list(): TaskList[];
  get(id: number): TaskList | null;
  count(): number;
  /** Added at the end. */
  create(input: { name: string; subjectId: number | null }, now: number): TaskList;
  update(id: number, patch: { name?: string; subjectId?: number | null }): TaskList | null;
  /** Sets `sort` to each id's index in `ids`; ids not listed keep their sort. */
  reorder(ids: number[]): void;
  /** The list row only; the service deletes its tasks. */
  remove(id: number): TaskList | null;
}

const toList = (r: Row): TaskList => ({
  id: int(r.id),
  name: text(r.name),
  subjectId: intOrNull(r.subject_id),
  sort: int(r.sort),
  createdAt: int(r.created_at),
});

export function taskListsRepo(db: Db): TaskListsRepo {
  const byId = (id: number): TaskList | null => {
    const r = one(db.raw, 'SELECT * FROM task_lists WHERE id = ?', [id]);
    return r ? toList(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM task_lists ORDER BY sort, id').map(toList),
    get: byId,
    count: () => int(one(db.raw, 'SELECT count(*) AS n FROM task_lists')!.n),
    create(input, now) {
      const id = insert(
        db.raw,
        `INSERT INTO task_lists (name, subject_id, sort, created_at)
         VALUES (?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM task_lists), ?)`,
        [input.name, input.subjectId, now],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch) {
      const current = byId(id);
      if (!current) return null;
      db.raw.run('UPDATE task_lists SET name = ?, subject_id = ? WHERE id = ?', [
        patch.name ?? current.name,
        patch.subjectId === undefined ? current.subjectId : patch.subjectId,
        id,
      ]);
      db.markDirty();
      return byId(id);
    },
    reorder(ids) {
      transaction(db.raw, () => {
        ids.forEach((id, sort) => db.raw.run('UPDATE task_lists SET sort = ? WHERE id = ?', [sort, id]));
      });
      db.markDirty();
    },
    remove(id) {
      const current = byId(id);
      if (!current) return null;
      db.raw.run('DELETE FROM task_lists WHERE id = ?', [id]);
      db.markDirty();
      return current;
    },
  };
}
