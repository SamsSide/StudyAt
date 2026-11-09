import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { subjectsRepo } from './subjects';

describe('subjectsRepo', () => {
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

  it('creates at the end, updates, archives and round-trips', async () => {
    const repo = subjectsRepo(db);
    const made = repo.create({ name: 'MATH2011 Analysis', colour: '#ffffff' });
    expect(made).toMatchObject({ name: 'MATH2011 Analysis', colour: '#ffffff', archived: false, sort: 6 });
    expect(repo.update(made.id, { name: 'Analysis', sort: 0 })).toMatchObject({ name: 'Analysis', sort: 0 });
    expect(repo.update(9999, { name: 'x' })).toBeNull();
    expect(repo.archive(made.id)).toMatchObject({ archived: true });
    await db.close();
    db = await openTestDb(dir);
    const all = subjectsRepo(db).list();
    expect(all).toHaveLength(7);
    expect(all.find((s) => s.id === made.id)).toEqual({
      id: made.id,
      name: 'Analysis',
      colour: '#ffffff',
      archived: true,
      sort: 0,
    });
  });
});
