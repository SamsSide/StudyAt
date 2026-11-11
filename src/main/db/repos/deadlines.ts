// Deadlines (v1.2 spec §3.10): an exam or a piece of coursework with a local wall-clock due time.
import type { Deadline, DeadlineKind } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, intOrNull, one, run, text, type Row } from '../sql';

export interface DeadlinesRepo {
  /** By due, then id. */
  all(): Deadline[];
  get(id: number): Deadline | null;
  create(input: { title: string; kind: DeadlineKind; subjectId: number | null; due: string; note: string }, now: number): Deadline;
  update(
    id: number,
    patch: Partial<Pick<Deadline, 'title' | 'kind' | 'subjectId' | 'due' | 'note' | 'done'>>,
    now: number,
  ): Deadline | null;
  remove(id: number): Deadline | null;
}

const toDeadline = (r: Row): Deadline => ({
  id: int(r.id),
  title: text(r.title),
  kind: text(r.kind) as DeadlineKind,
  subjectId: intOrNull(r.subject_id),
  due: text(r.due),
  note: text(r.note),
  done: bool(r.done),
  createdAt: int(r.created_at),
  updatedAt: int(r.updated_at),
});

export function deadlinesRepo(db: Db): DeadlinesRepo {
  const byId = (id: number): Deadline | null => {
    const r = one(db.raw, 'SELECT * FROM deadlines WHERE id = ?', [id]);
    return r ? toDeadline(r) : null;
  };

  return {
    all: () => all(db.raw, 'SELECT * FROM deadlines ORDER BY due, id').map(toDeadline),
    get: byId,
    create(input, now) {
      const id = insert(
        db.raw,
        `INSERT INTO deadlines (title, kind, subject_id, due, note, done, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [input.title, input.kind, input.subjectId, input.due, input.note, now, now],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch, now) {
      const current = byId(id);
      if (!current) return null;
      db.raw.run(
        'UPDATE deadlines SET title = ?, kind = ?, subject_id = ?, due = ?, note = ?, done = ?, updated_at = ? WHERE id = ?',
        [
          patch.title ?? current.title,
          patch.kind ?? current.kind,
          patch.subjectId !== undefined ? patch.subjectId : current.subjectId,
          patch.due ?? current.due,
          patch.note ?? current.note,
          (patch.done ?? current.done) ? 1 : 0,
          now,
          id,
        ],
      );
      db.markDirty();
      return byId(id);
    },
    remove(id) {
      const current = byId(id);
      if (!current) return null;
      run(db.raw, 'DELETE FROM deadlines WHERE id = ?', [id]);
      db.markDirty();
      return current;
    },
  };
}
