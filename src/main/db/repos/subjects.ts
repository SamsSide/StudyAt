// Subjects (spec §3.3, §3.12). Subjects are archived, never deleted, so sessions keep their tag.
import type { SubjectPatch } from '../../../shared/ipc';
import type { Subject } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, one, text, type Row } from '../sql';

export interface SubjectsRepo {
  /** Every subject, archived included, by `sort` then id. */
  list(): Subject[];
  create(input: { name: string; colour: string }): Subject;
  update(id: number, patch: SubjectPatch): Subject | null;
  archive(id: number): Subject | null;
}

const toSubject = (r: Row): Subject => ({
  id: int(r.id),
  name: text(r.name),
  colour: text(r.colour),
  archived: bool(r.archived),
  sort: int(r.sort),
});

export function subjectsRepo(db: Db): SubjectsRepo {
  const byId = (id: number): Subject | null => {
    const r = one(db.raw, 'SELECT * FROM subjects WHERE id = ?', [id]);
    return r ? toSubject(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM subjects ORDER BY sort, id').map(toSubject),
    create({ name, colour }) {
      const id = insert(
        db.raw,
        'INSERT INTO subjects (name, colour, archived, sort) VALUES (?, ?, 0, (SELECT coalesce(max(sort) + 1, 0) FROM subjects))',
        [name, colour],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch) {
      const current = byId(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      db.raw.run('UPDATE subjects SET name = ?, colour = ?, sort = ? WHERE id = ?', [next.name, next.colour, next.sort, id]);
      db.markDirty();
      return byId(id);
    },
    archive(id) {
      if (!byId(id)) return null;
      db.raw.run('UPDATE subjects SET archived = 1 WHERE id = ?', [id]);
      db.markDirty();
      return byId(id);
    },
  };
}
