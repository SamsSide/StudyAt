// Image and GIF widgets (v1.1 spec §3.6, appplan §4.10). A row is the widget's place and look; the
// file itself is `<userData>/images/<id>.<ext>`, written and deleted by the image service, which
// also enforces the limit of 12 (it reads `count()`).
import type { ImagePatch } from '../../../shared/types';
import type { Db } from '../db';
import { all, bool, insert, int, one, run, text, textOrNull, type Row } from '../sql';

export interface ImageRow {
  id: number;
  ext: 'gif' | 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  sourceUrl: string | null;
  /** Position as fractions of the window, 0..1. */
  x: number;
  y: number;
  /** 0.5..2, default 1 (v1.1 spec §3.5). */
  scale: number;
  /** Background off; default false. */
  bare: boolean;
  createdAt: number;
}

export interface ImagesRepo {
  /** By id. */
  list(): ImageRow[];
  count(): number;
  /** A new row with scale 1 and bare false. */
  create(input: Omit<ImageRow, 'id' | 'scale' | 'bare'>): ImageRow;
  /** x, y clamped to 0..1, scale to 0.5..2; null if there is no such image. */
  update(id: number, patch: ImagePatch): ImageRow | null;
  /** Deletes the row and returns it (the caller deletes its file); null if there was none. */
  remove(id: number): ImageRow | null;
}

export const IMAGE_SCALE_MIN = 0.5;
export const IMAGE_SCALE_MAX = 2;

/** `v` within lo..hi; `fallback` when it isn't a finite number. */
const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const toImage = (r: Row): ImageRow => ({
  id: int(r.id),
  ext: text(r.ext) as ImageRow['ext'],
  width: int(r.width),
  height: int(r.height),
  sourceUrl: textOrNull(r.source_url),
  x: Number(r.x),
  y: Number(r.y),
  scale: Number(r.scale),
  bare: bool(r.bare),
  createdAt: int(r.created_at),
});

export function imagesRepo(db: Db): ImagesRepo {
  const get = (id: number): ImageRow | null => {
    const r = one(db.raw, 'SELECT * FROM images WHERE id = ?', [id]);
    return r ? toImage(r) : null;
  };

  return {
    list: () => all(db.raw, 'SELECT * FROM images ORDER BY id').map(toImage),
    count: () => int(one(db.raw, 'SELECT count(*) AS n FROM images')!.n),
    create({ ext, width, height, sourceUrl, x, y, createdAt }) {
      const id = insert(
        db.raw,
        `INSERT INTO images (ext, width, height, source_url, x, y, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ext, width, height, sourceUrl, clamp(x, 0, 1, 0.5), clamp(y, 0, 1, 0.5), createdAt],
      );
      db.markDirty();
      return get(id)!;
    },
    update(id, patch) {
      const current = get(id);
      if (!current) return null;
      run(db.raw, 'UPDATE images SET x = ?, y = ?, scale = ?, bare = ? WHERE id = ?', [
        patch.x === undefined ? current.x : clamp(patch.x, 0, 1, current.x),
        patch.y === undefined ? current.y : clamp(patch.y, 0, 1, current.y),
        patch.scale === undefined
          ? current.scale
          : clamp(patch.scale, IMAGE_SCALE_MIN, IMAGE_SCALE_MAX, current.scale),
        (patch.bare ?? current.bare) ? 1 : 0,
        id,
      ]);
      db.markDirty();
      return get(id);
    },
    remove(id) {
      const current = get(id);
      if (!current) return null;
      run(db.raw, 'DELETE FROM images WHERE id = ?', [id]);
      db.markDirty();
      return current;
    },
  };
}
