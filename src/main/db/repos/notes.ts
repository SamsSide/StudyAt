// Sticky notes for the Notes widget (widgets addendum §4b), and their pop-out stickies (v1.2 spec
// §3.2): a popped note is placed on the canvas at x, y (fractions 0..1 of the window) and scale
// 0.5..2, and keeps its `sort`, so docking it back returns it to its place in the stack. Every
// write returns the whole list, which is what the widget shows. The limit of 12 popped notes is
// enforced by the caller (it reads `poppedCount()`).
import type { Note, TaskColour } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, one, run, text, transaction, type Cell, type Row } from '../sql';

/** Longest note text kept; longer text is cut, never through an emoji (widgets addendum §4b). */
export const NOTE_MAX_CHARS = 5000;
export const NOTE_SCALE_MIN = 0.5;
export const NOTE_SCALE_MAX = 2;

export interface NotesRepo {
  /** By `sort` then id. */
  list(): Note[];
  /** An empty note added at the end, yellow unless a colour is given. */
  create(input: { colour?: TaskColour }, now: number): Note[];
  /**
   * Stamps `updatedAt = now`; x, y clamped to 0..1, scale to 0.5..2; null if there is no such note.
   */
  update(
    id: number,
    patch: { text?: string; colour?: TaskColour; x?: number; y?: number; scale?: number; bare?: boolean },
    now: number,
  ): Note[] | null;
  /** An unknown id is a no-op. */
  remove(id: number): Note[];
  /** Sets `sort` to each id's index in `ids`; ids not listed keep their sort. */
  reorder(ids: number[]): Note[];
  /** Pops a note out onto the canvas at `at` (clamped to 0..1); null if there is no such note. */
  popOut(id: number, at: { x: number; y: number }): Note[] | null;
  /** Returns a note to the stack at its old `sort`; null if there is no such note. */
  dockBack(id: number): Note[] | null;
  poppedCount(): number;
}

/** At most NOTE_MAX_CHARS UTF-16 units, never ending in half a surrogate pair. */
export function clipNoteText(text: string): string {
  let out = text.slice(0, NOTE_MAX_CHARS);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/** `v` within lo..hi; `fallback` when it isn't a finite number. */
function clamp<T extends number | null>(v: number, lo: number, hi: number, fallback: T): number | T {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

const realOrNull = (v: Cell): number | null => (v === null || v === undefined ? null : Number(v));

const toNote = (r: Row): Note => ({
  id: int(r.id),
  text: text(r.text),
  colour: text(r.colour) as TaskColour,
  sort: int(r.sort),
  createdAt: int(r.created_at),
  updatedAt: int(r.updated_at),
  popped: bool(r.popped),
  x: realOrNull(r.x),
  y: realOrNull(r.y),
  scale: Number(r.scale),
  bare: bool(r.bare),
});

export function notesRepo(db: Db): NotesRepo {
  const list = (): Note[] => all(db.raw, 'SELECT * FROM notes ORDER BY sort, id').map(toNote);
  const get = (id: number): Note | null => {
    const r = one(db.raw, 'SELECT * FROM notes WHERE id = ?', [id]);
    return r ? toNote(r) : null;
  };

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
      const current = get(id);
      if (!current) return null;
      db.raw.run(
        'UPDATE notes SET text = ?, colour = ?, x = ?, y = ?, scale = ?, bare = ?, updated_at = ? WHERE id = ?',
        [
          clipNoteText(patch.text ?? current.text),
          patch.colour ?? current.colour,
          patch.x === undefined ? current.x : clamp(patch.x, 0, 1, current.x),
          patch.y === undefined ? current.y : clamp(patch.y, 0, 1, current.y),
          patch.scale === undefined
            ? current.scale
            : clamp(patch.scale, NOTE_SCALE_MIN, NOTE_SCALE_MAX, current.scale),
          (patch.bare ?? current.bare) ? 1 : 0,
          now,
          id,
        ],
      );
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
    popOut(id, at) {
      const current = get(id);
      if (!current) return null;
      run(db.raw, 'UPDATE notes SET popped = 1, x = ?, y = ? WHERE id = ?', [
        clamp(at.x, 0, 1, current.x ?? 0.5),
        clamp(at.y, 0, 1, current.y ?? 0.5),
        id,
      ]);
      db.markDirty();
      return list();
    },
    dockBack(id) {
      if (!get(id)) return null;
      run(db.raw, 'UPDATE notes SET popped = 0 WHERE id = ?', [id]);
      db.markDirty();
      return list();
    },
    poppedCount: () => int(one(db.raw, 'SELECT count(*) AS n FROM notes WHERE popped = 1')!.n),
  };
}
