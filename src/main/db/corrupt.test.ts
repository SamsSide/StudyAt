import { copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corruptState, markCorruptRestoreAttempt, resolveCorrupt } from './corrupt';
import { DB_FILE, type Db } from './db';
import { NOW, openTestDb, tempDir } from './test-helpers';

const corruptFiles = (dir: string): string[] => readdirSync(dir).filter((f) => /^studyat\.corrupt-.+\.sqlite$/.test(f));

// R32: "corrupt, unresolved" survives a relaunch, a kill or a failed restore until Sam chooses.
describe('corrupt state in meta', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db | null = null;

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(async () => {
    await db?.close();
    db = null;
    cleanup();
  });

  async function openCorrupt(at = NOW + 5000): Promise<Db> {
    writeFileSync(join(dir, DB_FILE), Buffer.from('not sqlite'.repeat(500)));
    return openTestDb(dir, at);
  }

  it('a normal database has no corrupt state', async () => {
    db = await openTestDb(dir);
    expect(corruptState(db.raw)).toEqual({ pendingAt: null, restoreFailed: false });
  });

  it('the corrupt path records corrupt_pending, written to disk', async () => {
    db = await openCorrupt();
    expect(corruptState(db.raw)).toEqual({ pendingAt: NOW + 5000, restoreFailed: false });
    await db.close();
    // Killed while the dialog was open: the next launch is corrupt again, with the same stamp.
    db = await openTestDb(dir, NOW + 60_000);
    expect(db.recovered).toBe('corrupt');
    expect(db.corruptAt).toBe(NOW + 5000);
    // The fresh file is valid, so nothing more is set aside.
    expect(corruptFiles(dir)).toHaveLength(1);
  });

  it('resolveCorrupt (Start fresh) clears the flags so the next launch is ok', async () => {
    db = await openCorrupt();
    await markCorruptRestoreAttempt(db);
    await resolveCorrupt(db);
    expect(corruptState(db.raw)).toEqual({ pendingAt: null, restoreFailed: false });
    await db.close();
    db = await openTestDb(dir, NOW + 60_000);
    expect(db.recovered).toBe('ok');
    expect(db.corruptAt).toBeNull();
  });

  it('a restore attempt is recorded on disk before the restore runs', async () => {
    db = await openCorrupt();
    await markCorruptRestoreAttempt(db);
    // No close: the restore's copy failed and the app relaunched onto the fresh file.
    const reopened = await openTestDb(dir, NOW + 60_000);
    expect(reopened.recovered).toBe('corrupt');
    expect(corruptState(reopened.raw)).toEqual({ pendingAt: NOW + 5000, restoreFailed: true });
    await reopened.close();
  });

  it('a good database copied in by a restore opens ok', async () => {
    db = await openTestDb(dir);
    await db.close();
    const good = join(dir, 'good.sqlite');
    copyFileSync(join(dir, DB_FILE), good);
    db = await openCorrupt();
    await markCorruptRestoreAttempt(db);
    await db.close();
    copyFileSync(good, join(dir, DB_FILE));
    db = await openTestDb(dir, NOW + 60_000);
    expect(db.recovered).toBe('ok');
    expect(corruptState(db.raw)).toEqual({ pendingAt: null, restoreFailed: false });
  });
});
