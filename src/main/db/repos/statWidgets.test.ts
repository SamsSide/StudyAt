import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { statWidgetsRepo } from './statWidgets';

describe('statWidgetsRepo', () => {
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

  it('creates at scale 1, not bare, and counts', async () => {
    const repo = statWidgetsRepo(db);
    expect(repo.count()).toBe(0);
    const made = repo.create({ card: 'total', range: 'week', x: 0.3, y: 0.4 }, 1000);
    expect(made).toMatchObject({ card: 'total', range: 'week', x: 0.3, y: 0.4, scale: 1, bare: false });
    expect(repo.count()).toBe(1);
    await db.close();
    db = await openTestDb(dir);
    expect(statWidgetsRepo(db).list()).toEqual([made]);
  });

  it('clamps position and scale on update and changes card and range', () => {
    const repo = statWidgetsRepo(db);
    const made = repo.create({ card: 'total', range: 'week', x: 0.5, y: 0.5 }, 1);
    expect(repo.update(made.id, { x: -1, scale: 5, range: 'month', card: 'goal' })).toMatchObject({
      x: 0,
      y: 0.5,
      scale: 2,
      range: 'month',
      card: 'goal',
    });
    expect(repo.update(made.id, { y: 3, scale: 0.1, bare: true })).toMatchObject({ y: 1, scale: 0.5, bare: true });
  });

  it('lists by id, removes, and returns null for a missing id', () => {
    const repo = statWidgetsRepo(db);
    const a = repo.create({ card: 'total', range: 'today', x: 0, y: 0 }, 1);
    const b = repo.create({ card: 'subjects', range: 'month', x: 1, y: 1 }, 2);
    expect(repo.list().map((w) => w.id)).toEqual([a.id, b.id]);
    expect(repo.remove(a.id)).toEqual(a);
    expect(repo.remove(a.id)).toBeNull();
    expect(repo.count()).toBe(1);
    expect(repo.update(9999, { x: 0.1 })).toBeNull();
  });
});
