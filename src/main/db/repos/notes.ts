// Sticky notes for the Notes widget (widgets addendum §4b). Every write returns the whole list,
// which is what the widget shows.
import type { Note, TaskColour } from '../../../shared/types';
import type { Db } from '../db';
import { all, insert, int, one, text, transaction, type Row } from '../sql';

/** Longest note text kept; longer text is cut (widgets addendum §4b). */
export const NOTE_MAX_CHARS = 5000;

export interface NotesRepo {
  /** By `sort` then id. */
  list(): Note[];
  /** An empty note added at the end, yellow unless a colour is given. */
  create(input: { colour?: TaskColour }, now: number): Note[];
  /** Stamps `updatedAt = now`; null if there is no such note. */
  update(id: number, patch: { text?: string; colour?: TaskColour }, now: number): Note[] | null;
  /** An unknown id is a no-op. */
  remove(id: number): Note[];
  /** Sets `sort` to each id's index in `ids`; ids not listed keep their sort. */
  reorder(ids: number[]): Note[];
}

const toNote = (r: Row): Note => ({
  id: int(r.id),
  text: text(r.text),
  colour: text(r.colour) as TaskColour,
  sort: int(r.sort),
  createdAt: int(r.created_at),
  updatedAt: int(r.updated_at),
});

export function notesRepo(db: Db): NotesRepo {
  const list = (): Note[] => all(db.raw, 'SELECT * FROM notes ORDER BY sort, id').map(toNote);

  return {
    list,
    create(input, now) {
      insert(
        db.raw,
        `INSERT INTO notes (text, colour, sort, created_at, updated_at)
         VALUES ('', ?, (SELECT coalesce(max(sort) + 1, 0) FROM notes), ?, ?)`,
        [input.colour ?? 'yellow', now, now],
      );
      db.markDirty();
      return list();
    },
    update(id, patch, now) {
      const r = one(db.raw, 'SELECT * FROM notes WHERE id = ?', [id]);
      if (!r) return null;
      const current = toNote(r);
      db.raw.run('UPDATE notes SET text = ?, colour = ?, updated_at = ? WHERE id = ?', [
        (patch.text ?? current.text).slice(0, NOTE_MAX_CHARS),
        patch.colour ?? current.colour,
        now,
        id,
      ]);
      db.markDirty();
      return list();
    },
    remove(id) {
      db.raw.run('DELETE FROM notes WHERE id = ?', [id]);
      db.markDirty();
      return list();
    },
    reorder(ids) {
      transaction(db.raw, () => {
        ids.forEach((id, sort) => db.raw.run('UPDATE notes SET sort = ? WHERE id = ?', [sort, id]));
      });
      db.markDirty();
      return list();
    },
  };
}
