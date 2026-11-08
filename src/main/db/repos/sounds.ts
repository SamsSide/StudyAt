// Soundboard channels (spec §3.9). `missing` is worked out by the caller; the repo returns false.
import type { Sound } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, one, run, text, type Row } from '../sql';

export interface SoundsRepo {
  /** By `sort` then id. */
  list(): Sound[];
  /** Added at the end. */
  create(input: { name: string; kind: Sound['kind']; source: string }): Sound;
  remove(id: number): boolean;
}

const toSound = (r: Row): Sound => ({
  id: int(r.id),
  name: text(r.name),
  kind: text(r.kind) as Sound['kind'],
  source: text(r.source),
  builtin: bool(r.builtin),
  sort: int(r.sort),
  missing: false,
});

export function soundsRepo(db: Db): SoundsRepo {
  return {
    list: () => all(db.raw, 'SELECT * FROM sounds ORDER BY sort, id').map(toSound),
    create({ name, kind, source }) {
      const id = insert(
        db.raw,
        'INSERT INTO sounds (name, kind, source, builtin, sort) VALUES (?, ?, ?, 0, (SELECT coalesce(max(sort) + 1, 0) FROM sounds))',
        [name, kind, source],
      );
      db.markDirty();
      return toSound(one(db.raw, 'SELECT * FROM sounds WHERE id = ?', [id])!);
    },
    remove(id) {
      const removed = run(db.raw, 'DELETE FROM sounds WHERE id = ?', [id]) > 0;
      if (removed) db.markDirty();
      return removed;
    },
  };
}
