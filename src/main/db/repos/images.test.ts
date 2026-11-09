import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { imagesRepo, type ImageRow } from './images';

describe('imagesRepo', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir);
  });
  afterEach(async () => {
    await db.close();
    cleanup();
  });

  const input = (over: Partial<Omit<ImageRow, 'id' | 'scale' | 'bare'>> = {}) => ({
    ext: 'gif' as const,
    width: 480,
    height: 270,
    sourceUrl: 'https://i.giphy.com/abc.gif',
    x: 0.25,
    y: 0.75,
    createdAt: NOW,
    ...over,
  });

  it('create returns the row with scale 1 and bare false', () => {
    const markDirty = vi.spyOn(db, 'markDirty');
    const row = imagesRepo(db).create(input());
    expect(row).toEqual({
      id: row.id,
      ext: 'gif',
      width: 480,
      height: 270,
      sourceUrl: 'https://i.giphy.com/abc.gif',
      x: 0.25,
      y: 0.75,
      scale: 1,
      bare: false,
      createdAt: NOW,
    });
    expect(markDirty).toHaveBeenCalled();
    expect(imagesRepo(db).create(input({ ext: 'png', sourceUrl: null })).sourceUrl).toBeNull();
  });

  it('update clamps scale to 0.5..2 and x, y to 0..1', () => {
    const repo = imagesRepo(db);
    const { id } = repo.create(input());
    expect(repo.update(id, { scale: 5, x: -1 })).toMatchObject({ scale: 2, x: 0, y: 0.75 });
    expect(repo.update(id, { scale: 0.1, y: 3, bare: true })).toMatchObject({
      scale: 0.5,
      x: 0,
      y: 1,
      bare: true,
    });
    expect(repo.update(id, { bare: false })).toMatchObject({ scale: 0.5, bare: false });
    expect(repo.list()[0]).toMatchObject({ scale: 0.5, x: 0, y: 1, bare: false });
  });

  it('update on a missing id returns null', () => {
    expect(imagesRepo(db).update(999, { x: 0.5 })).toBeNull();
  });

  it('counts, lists by id and removes, returning the removed row', () => {
    const repo = imagesRepo(db);
    const a = repo.create(input());
    const b = repo.create(input({ ext: 'webp' }));
    expect(repo.count()).toBe(2);
    expect(repo.list().map((r) => r.id)).toEqual([a.id, b.id]);
    expect(repo.remove(a.id)).toEqual(a);
    expect(repo.list()).toEqual([b]);
    expect(repo.count()).toBe(1);
    expect(repo.remove(a.id)).toBeNull();
  });
});
