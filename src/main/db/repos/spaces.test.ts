import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { spacesRepo } from './spaces';

describe('spacesRepo', () => {
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

  it("reads 'auto' for an old space whose stored opts lack quality", () => {
    const repo = spacesRepo(db);
    const made = repo.create({ kind: 'video', name: 'old', source: 'C:\\a.mp4', thumb: null }, NOW);
    db.raw.run('UPDATE spaces SET opts = ? WHERE id = ?', [
      JSON.stringify({ audio: false, volume: 0.5, speed: 1, dim: 0.15, blur: 0 }),
      made.id,
    ]);
    expect(repo.list().find((s) => s.id === made.id)?.opts.quality).toBe('auto');
  });

  it('creates, updates (merging opts), removes and round-trips', async () => {
    const repo = spacesRepo(db);
    const made = repo.create(
      {
        kind: 'video',
        name: 'café rain',
        source: 'C:\\Users\\samue\\Videos\\café rain.mp4',
        thumb: 'data:image/jpeg;base64,AA==',
      },
      NOW,
    );
    expect(made).toEqual({
      id: made.id,
      kind: 'video',
      name: 'café rain',
      source: 'C:\\Users\\samue\\Videos\\café rain.mp4',
      thumb: 'data:image/jpeg;base64,AA==',
      favourite: false,
      builtin: false,
      opts: { audio: false, volume: 0.5, speed: 1, dim: 0.15, blur: 0, quality: 'auto' },
      createdAt: NOW,
      missing: false,
    });
    const updated = repo.update(made.id, {
      name: 'Rain',
      favourite: true,
      opts: { dim: 0.4 },
      source: 'D:\\rain.mp4',
    });
    expect(updated).toMatchObject({
      name: 'Rain',
      favourite: true,
      source: 'D:\\rain.mp4',
      opts: { audio: false, volume: 0.5, speed: 1, dim: 0.4, blur: 0, quality: 'auto' },
    });
    expect(repo.update(9999, { name: 'x' })).toBeNull();

    const builtinCount = repo.list().filter((s) => s.builtin).length;
    const other = repo.create(
      { kind: 'youtube', name: 'Lofi', source: 'abcdefghijk', thumb: null, opts: { audio: true } },
      NOW,
    );
    expect(other.opts.audio).toBe(true);
    expect(repo.remove(other.id)).toBe(true);
    expect(repo.remove(other.id)).toBe(false);

    await db.close();
    db = await openTestDb(dir);
    const list = spacesRepo(db).list();
    expect(list).toHaveLength(builtinCount + 1);
    expect(list[list.length - 1]).toEqual(updated);
  });
});
