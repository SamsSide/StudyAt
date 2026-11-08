import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { mixesRepo } from './mixes';

describe('mixesRepo', () => {
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

  it('saves, replaces by name, removes and round-trips', async () => {
    const repo = mixesRepo(db);
    const rainy = repo.save('Rainy café', { '4': 0.6, '6': 0.3 });
    expect(rainy).toEqual({ id: rainy.id, name: 'Rainy café', levels: { '4': 0.6, '6': 0.3 } });
    const again = repo.save('Rainy café', { '4': 0.2 });
    expect(again.id).toBe(rainy.id);
    const night = repo.save('Night', { '1': 1 });
    expect(repo.remove(night.id)).toBe(true);
    await db.close();
    db = await openTestDb(dir);
    expect(mixesRepo(db).list()).toEqual([{ id: rainy.id, name: 'Rainy café', levels: { '4': 0.2 } }]);
  });
});
