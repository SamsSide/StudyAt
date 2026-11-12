import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { taskListsRepo } from './taskLists';

describe('taskListsRepo', () => {
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

  it('has the seeded lists on a fresh database, the Inbox then one per subject', () => {
    const repo = taskListsRepo(db);
    expect(repo.count()).toBe(7);
    expect(repo.list().map((l) => l.sort)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(repo.list()[0]).toMatchObject({ name: 'Inbox', subjectId: null });
    expect(repo.list().slice(1).every((l) => l.subjectId !== null)).toBe(true);
  });

  it('creates at the end, updates name and subject, reorders and removes', () => {
    const repo = taskListsRepo(db);
    const a = repo.create({ name: 'Reading', subjectId: null }, NOW);
    expect(a).toMatchObject({ name: 'Reading', subjectId: null, sort: 7, createdAt: NOW });
    const b = repo.create({ name: 'Labs', subjectId: 1 }, NOW + 1);
    expect(b.sort).toBe(8);
    expect(repo.count()).toBe(9);

    expect(repo.update(a.id, { name: 'Papers' })).toMatchObject({ name: 'Papers', subjectId: null });
    expect(repo.update(a.id, { subjectId: 2 })).toMatchObject({ name: 'Papers', subjectId: 2 });
    expect(repo.update(a.id, { subjectId: null })).toMatchObject({ subjectId: null });
    expect(repo.update(9999, { name: 'x' })).toBeNull();

    repo.reorder([b.id, a.id]);
    expect([repo.get(b.id)!.sort, repo.get(a.id)!.sort]).toEqual([0, 1]);

    expect(repo.remove(a.id)).toMatchObject({ id: a.id, name: 'Papers' });
    expect(repo.get(a.id)).toBeNull();
    expect(repo.remove(a.id)).toBeNull();
    expect(repo.count()).toBe(8);
  });
});
