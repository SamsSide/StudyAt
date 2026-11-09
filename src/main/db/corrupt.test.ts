import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corruptState, markCorruptRestoreAttempt, resolveCorrupt } from './corrupt';
import { DB_FILE, nodeFs, type Db, type DbFs } from './db';
import { NOW, openTestDb, recordingFs, tempDir } from './test-helpers';

const corruptFiles = (dir: string): string[] =>
  readdirSync(dir).filter((f) => /^studyat\.corrupt-.+\.sqlite$/.test(f));

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

  // A kill (or a failed write) between setting the damaged file aside and the fresh database's
  // first flush must not relaunch as a first run with no dialog.
  it('a kill before the fresh database is first written still relaunches corrupt', async () => {
    const damaged = Buffer.from('not sqlite'.repeat(500));
    writeFileSync(join(dir, DB_FILE), damaged);
    const killed: DbFs = {
      ...nodeFs,
      writeDurable: (path, data) =>
        path.endsWith(`${DB_FILE}.tmp`)
          ? Promise.reject(new Error('killed'))
          : nodeFs.writeDurable(path, data),
    };
    await expect(openTestDb(dir, NOW + 5000, killed)).rejects.toThrow('killed');
    // Nothing is lost: the damaged bytes are still on disk.
    expect(existsSync(join(dir, DB_FILE))).toBe(true);
    db = await openTestDb(dir, NOW + 60_000);
    expect(db.recovered).toBe('corrupt');
    expect(db.corruptAt).not.toBeNull();
    expect(corruptState(db.raw).pendingAt).toBe(db.corruptAt);
    for (const f of corruptFiles(dir)) expect(readFileSync(join(dir, f))).toEqual(damaged);
  });

  // The corrupt copy is the only copy of Sam's history once the fresh database replaces
  // studyat.sqlite, so its bytes are fsynced (from memory, not re-read) before that rename.
  it('the corrupt copy is written durably before the fresh database replaces studyat.sqlite', async () => {
    const damaged = Buffer.from('not sqlite'.repeat(500));
    const file = join(dir, DB_FILE);
    writeFileSync(file, damaged);
    const { fs, log } = recordingFs();
    db = await openTestDb(dir, NOW + 5000, fs);
    const kept = join(dir, 'studyat.corrupt-2026-11-08-120005.sqlite');
    const writeAside = log.indexOf(`writeDurable ${kept}.tmp`);
    const publishAside = log.indexOf(`rename ${kept}.tmp -> ${kept}`);
    const replaceDb = log.indexOf(`rename ${file}.tmp -> ${file}`);
    expect(writeAside).toBeGreaterThanOrEqual(0);
    expect(publishAside).toBeGreaterThan(writeAside);
    expect(replaceDb).toBeGreaterThan(publishAside);
    expect(log.some((l) => l.startsWith(`copyFile ${file} `))).toBe(false);
    expect(readFileSync(kept)).toEqual(damaged);
  });

  it('the damaged file is never taken as a pre-migration backup', async () => {
    db = await openCorrupt();
    const backups = existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')) : [];
    expect(backups.filter((f) => f.startsWith('pre-migration-'))).toEqual([]);
  });

  it('a corrupt file from an earlier, resolved incident does not make a later first run corrupt', async () => {
    db = await openCorrupt();
    await resolveCorrupt(db);
    await db.close();
    unlinkSync(join(dir, DB_FILE));
    db = await openTestDb(dir, NOW + 60_000);
    expect(db.recovered).toBe('ok');
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
