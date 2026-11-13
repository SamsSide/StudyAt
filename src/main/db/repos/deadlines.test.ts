import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { deadlinesRepo } from './deadlines';

describe('deadlinesRepo', () => {
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

  it('creates and reads back, surviving a reopen', async () => {
    const repo = deadlinesRepo(db);
    const made = repo.create({ title: 'Analysis exam', kind: 'exam', subjectId: null, due: '2026-12-14T09:00', note: 'Hall 3' }, 1000);
    expect(made).toMatchObject({
      title: 'Analysis exam',
      kind: 'exam',
      subjectId: null,
      due: '2026-12-14T09:00',
      note: 'Hall 3',
      done: false,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(repo.get(made.id)).toEqual(made);
    expect(repo.get(9999)).toBeNull();
    await db.close();
    db = await openTestDb(dir);
    expect(deadlinesRepo(db).all()).toEqual([made]);
  });

  it('updates fields and stamps updatedAt when marked done', () => {
    const repo = deadlinesRepo(db);
    const made = repo.create({ title: 'Essay', kind: 'coursework', subjectId: null, due: '2026-12-01T12:00', note: '' }, 1000);
    const done = repo.update(made.id, { done: true }, 5000);
    expect(done).toMatchObject({ done: true, updatedAt: 5000, createdAt: 1000, title: 'Essay' });
    expect(repo.update(made.id, { title: 'Essay 2', due: '2026-12-02T12:00', kind: 'exam' }, 6000)).toMatchObject({
      title: 'Essay 2',
      due: '2026-12-02T12:00',
      kind: 'exam',
      done: true,
      updatedAt: 6000,
    });
    expect(repo.update(9999, { done: true }, 1)).toBeNull();
  });

  it('removes and returns the removed row', () => {
    const repo = deadlinesRepo(db);
    const made = repo.create({ title: 'x', kind: 'exam', subjectId: null, due: '2026-12-14T09:00', note: '' }, 1);
    expect(repo.remove(made.id)).toEqual(made);
    expect(repo.get(made.id)).toBeNull();
    expect(repo.remove(made.id)).toBeNull();
  });

  it('orders all() by due, then id', () => {
    const repo = deadlinesRepo(db);
    const mk = (title: string, due: string) => repo.create({ title, kind: 'exam', subjectId: null, due, note: '' }, 1);
    mk('late', '2026-12-20T09:00');
    mk('early', '2026-12-01T09:00');
    mk('tie', '2026-12-01T09:00');
    expect(repo.all().map((d) => d.title)).toEqual(['early', 'tie', 'late']);
  });
});
