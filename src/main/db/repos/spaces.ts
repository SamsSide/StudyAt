// Spaces (spec §3.8). `missing` is worked out by the caller (it needs the file system); the repo
// always returns false.
import type { SpacePatch } from '../../../shared/ipc';
import type { Space, SpaceOpts } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, json, one, run, text, textOrNull, type Row } from '../sql';

/** Per-space option defaults (spec §3.8). */
export const DEFAULT_SPACE_OPTS: SpaceOpts = {
  audio: false,
  volume: 0.5,
  speed: 1,
  dim: 0.15,
  blur: 0,
  quality: 'auto',
};

export const youTubeThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export interface SpaceInput {
  kind: Space['kind'];
  name: string;
  source: string;
  thumb: string | null;
  opts?: Partial<SpaceOpts>;
}

/** A renderer patch, plus what main changes itself: `source` on relocate, `thumb` on capture. */
export type MainSpacePatch = SpacePatch & { source?: string; thumb?: string | null };

export interface SpacesRepo {
  /** Oldest first (built-ins, then added spaces). */
  list(): Space[];
  create(input: SpaceInput, now: number): Space;
  /** `opts` is merged over the stored options. */
  update(id: number, patch: MainSpacePatch): Space | null;
  remove(id: number): boolean;
}

const toSpace = (r: Row): Space => ({
  id: int(r.id),
  kind: text(r.kind) as Space['kind'],
  name: text(r.name),
  source: text(r.source),
  thumb: textOrNull(r.thumb),
  favourite: bool(r.favourite),
  builtin: bool(r.builtin),
  opts: { ...DEFAULT_SPACE_OPTS, ...json<Partial<SpaceOpts>>(r.opts, {}) },
  createdAt: int(r.created_at),
  missing: false,
});

export function spacesRepo(db: Db): SpacesRepo {
  const byId = (id: number): Space | null => {
    const r = one(db.raw, 'SELECT * FROM spaces WHERE id = ?', [id]);
    return r ? toSpace(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM spaces ORDER BY id').map(toSpace),
    create(input, now) {
      const opts = { ...DEFAULT_SPACE_OPTS, ...input.opts };
      const id = insert(
        db.raw,
        `INSERT INTO spaces (kind, name, source, thumb, favourite, builtin, opts, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
        [input.kind, input.name, input.source, input.thumb, JSON.stringify(opts), now],
      );
      db.markDirty();
      return byId(id)!;
    },
    update(id, patch) {
      const current = byId(id);
      if (!current) return null;
      const opts = { ...current.opts, ...patch.opts };
      db.raw.run('UPDATE spaces SET name = ?, favourite = ?, source = ?, thumb = ?, opts = ? WHERE id = ?', [
        patch.name ?? current.name,
        (patch.favourite ?? current.favourite) ? 1 : 0,
        patch.source ?? current.source,
        patch.thumb !== undefined ? patch.thumb : current.thumb,
        JSON.stringify(opts),
        id,
      ]);
      db.markDirty();
      return byId(id);
    },
    remove(id) {
      const removed = run(db.raw, 'DELETE FROM spaces WHERE id = ?', [id]) > 0;
      if (removed) db.markDirty();
      return removed;
    },
  };
}
