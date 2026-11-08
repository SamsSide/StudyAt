import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { tasksRepo } from './tasks';

describe('tasksRepo', () => {
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

  it('creates, ticks off, reorders, clears done and round-trips', async () => {
    const repo = tasksRepo(db);
    const a = repo.create({ text: 'Read chapter 3', colour: 'yellow' }, NOW);
    const b = repo.create({ text: 'Lab sheet', colour: 'pink' }, NOW + 1);
    const c = repo.create({ text: 'Past paper', colour: 'blue' }, NOW + 2);
    expect(a).toEqual({ id: a.id, text: 'Read chapter 3', colour: 'yellow', done: false, sort: 0, createdAt: NOW, doneAt: null });
    expect([b.sort, c.sort]).toEqual([1, 2]);

    expect(repo.update(b.id, { done: true }, NOW + 10)).toMatchObject({ done: true, doneAt: NOW + 10 });
    expect(repo.update(b.id, { done: false }, NOW + 20)).toMatchObject({ done: false, doneAt: null });
    expect(repo.update(a.id, { text: 'Read chapter 4', colour: 'green' }, NOW)).toMatchObject({ text: 'Read chapter 4', colour: 'green' });
    expect(repo.update(9999, { text: 'x' }, NOW)).toBeNull();

    repo.reorder([c.id, a.id, b.id]);
    expect(repo.list().map((t) => t.id)).toEqual([c.id, a.id, b.id]);

    repo.update(a.id, { done: true }, NOW + 30);
    repo.clearDone();
    await db.close();
    db = await openTestDb(dir);
    expect(tasksRepo(db).list().map((t) => [t.id, t.sort])).toEqual([
      [c.id, 0],
      [b.id, 2],
    ]);
  });
});
