// Stats widgets (v1.2 spec §3.12): a stat card pinned on the study space, positioned as 0..1
// fractions of the stage. `"range"` is quoted in every statement: RANGE is an SQL keyword.
import type { StatCard, StatRange, StatWidget, StatWidgetPatch } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, one, run, text, type Row } from '../sql';

export interface StatWidgetsRepo {
  /** By id. */
  list(): StatWidget[];
  count(): number;
  /** Scale 1, not bare. */
  create(input: { card: StatCard; range: StatRange; x: number; y: number }, now: number): StatWidget;
  /** x, y clamped to 0..1, scale to 0.5..2; null if missing. */
  update(id: number, patch: StatWidgetPatch): StatWidget | null;
  remove(id: number): StatWidget | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const toWidget = (r: Row): StatWidget => ({
  id: int(r.id),
  card: text(r.card) as StatCard,
  range: text(r.range) as StatRange,
  x: Number(r.x),
  y: Number(r.y),
  scale: Number(r.scale),
  bare: bool(r.bare),
});

export function statWidgetsRepo(db: Db): StatWidgetsRepo {
  const byId = (id: number): StatWidget | null => {
    const r = one(db.raw, 'SELECT * FROM stat_widgets WHERE id = ?', [id]);
    return r ? toWidget(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM stat_widgets ORDER BY id').map(toWidget),
    count: () => int(one(db.raw, 'SELECT COUNT(*) AS n FROM stat_widgets')!.n),
    create(input, now) {
      const id = insert(
        db.raw,
        'INSERT INTO stat_widgets (card, "range", x, y, scale, bare, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)',
        [input.card, input.range, clamp(input.x, 0, 1), clamp(input.y, 0, 1), now],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch) {
      const current = byId(id);
      if (!current) return null;
      db.raw.run('UPDATE stat_widgets SET card = ?, "range" = ?, x = ?, y = ?, scale = ?, bare = ? WHERE id = ?', [
        patch.card ?? current.card,
        patch.range ?? current.range,
        clamp(patch.x ?? current.x, 0, 1),
        clamp(patch.y ?? current.y, 0, 1),
        clamp(patch.scale ?? current.scale, 0.5, 2),
        (patch.bare ?? current.bare) ? 1 : 0,
        id,
      ]);
      db.markDirty();
      return byId(id);
    },
    remove(id) {
      const current = byId(id);
      if (!current) return null;
      run(db.raw, 'DELETE FROM stat_widgets WHERE id = ?', [id]);
      db.markDirty();
      return current;
    },
  };
}
