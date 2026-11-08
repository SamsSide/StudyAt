// Saved soundboard mixes (spec §3.9): a name and `{soundId: level}`.
import type { Mix } from '../../../shared/types';
import type { Db } from '../db';
import { all, insert, int, json, one, run, text, type Row } from '../sql';

export interface MixesRepo {
  list(): Mix[];
  /** Saving under an existing name replaces that mix's levels. */
  save(name: string, levels: Record<string, number>): Mix;
  remove(id: number): boolean;
}

const toMix = (r: Row): Mix => ({
  id: int(r.id),
  name: text(r.name),
  levels: json<Record<string, number>>(r.levels, {}),
});

export function mixesRepo(db: Db): MixesRepo {
  return {
    list: () => all(db.raw, 'SELECT * FROM mixes ORDER BY id').map(toMix),
    save(name, levels) {
      const existing = one(db.raw, 'SELECT id FROM mixes WHERE name = ?', [name]);
      let id: number;
      if (existing) {
        id = int(existing.id);
        db.raw.run('UPDATE mixes SET levels = ? WHERE id = ?', [JSON.stringify(levels), id]);
      } else {
        id = insert(db.raw, 'INSERT INTO mixes (name, levels) VALUES (?, ?)', [name, JSON.stringify(levels)]);
      }
      db.markDirty();
      return toMix(one(db.raw, 'SELECT * FROM mixes WHERE id = ?', [id])!);
    },
    remove(id) {
      const removed = run(db.raw, 'DELETE FROM mixes WHERE id = ?', [id]) > 0;
      if (removed) db.markDirty();
      return removed;
    },
  };
}
