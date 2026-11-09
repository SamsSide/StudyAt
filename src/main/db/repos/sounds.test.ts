import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { soundsRepo } from './sounds';

describe('soundsRepo', () => {
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

  it('creates at the end, removes and round-trips', async () => {
    const repo = soundsRepo(db);
    const before = repo.list().length;
    const made = repo.create({
      name: 'Library hum',
      kind: 'file',
      source: 'C:\\Users\\samue\\Music\\hum.mp3',
    });
    expect(made).toEqual({
      id: made.id,
      name: 'Library hum',
      kind: 'file',
      source: 'C:\\Users\\samue\\Music\\hum.mp3',
      builtin: false,
      sort: before,
      missing: false,
    });
    const gone = repo.create({ name: 'Gone', kind: 'file', source: '/x.ogg' });
    expect(repo.remove(gone.id)).toBe(true);
    // A removed id is never handed out again (chime ids and mix levels refer to sound ids).
    const next = repo.create({ name: 'Next', kind: 'file', source: '/y.ogg' });
    expect(next.id).toBeGreaterThan(gone.id);
    await db.close();
    db = await openTestDb(dir);
    const list = soundsRepo(db).list();
    expect(list.map((s) => s.name).slice(-2)).toEqual(['Library hum', 'Next']);
  });
});
