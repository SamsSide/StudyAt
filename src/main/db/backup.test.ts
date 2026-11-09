import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyBackup, fileStamp, latestBackupBefore, listBackups, localDateKey } from './backup';
import { DB_FILE, isReadableDatabase, nodeFs, type DbFs } from './db';
import { NOW, WASM_PATH, openTestDb, tempDir } from './test-helpers';

describe('backups', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    writeFileSync(join(dir, DB_FILE), 'today');
  });
  afterEach(() => cleanup());

  it('formats local dates and stamps', () => {
    expect(localDateKey(NOW)).toBe('2026-11-08');
    expect(fileStamp(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02-030405');
  });

  it("copies today's file once", async () => {
    await dailyBackup(dir, NOW);
    const file = join(dir, 'backups', 'daily-2026-11-08.sqlite');
    expect(readFileSync(file, 'utf8')).toBe('today');
    writeFileSync(join(dir, DB_FILE), 'later');
    await dailyBackup(dir, NOW + 60_000);
    expect(readFileSync(file, 'utf8')).toBe('today');
  });

  it('dailyBackup keeps newest 14', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    // 16 older dailies: 2026-10-20 .. 2026-11-04.
    for (let d = 0; d < 16; d++) {
      const key = localDateKey(new Date(2026, 9, 20 + d, 12).getTime());
      writeFileSync(join(backups, `daily-${key}.sqlite`), key);
    }
    writeFileSync(join(backups, 'pre-migration-v0-2026-01-01-000000.sqlite'), 'keep me');
    // Today's file already exists, so nothing is copied and only pruning runs.
    writeFileSync(join(backups, 'daily-2026-11-08.sqlite'), 'x');
    await dailyBackup(dir, NOW);
    const left = readdirSync(backups)
      .filter((f) => f.startsWith('daily-'))
      .sort();
    expect(left).toHaveLength(14);
    expect(left).not.toContain('daily-2026-10-20.sqlite');
    expect(left).not.toContain('daily-2026-10-21.sqlite');
    expect(left).not.toContain('daily-2026-10-22.sqlite');
    expect(left[left.length - 1]).toBe('daily-2026-11-08.sqlite');
    // Pre-migration backups are never pruned.
    expect(readdirSync(backups)).toContain('pre-migration-v0-2026-01-01-000000.sqlite');
  });

  it('prunes to 14 including the copy just made', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (let d = 0; d < 16; d++) {
      const key = localDateKey(new Date(2026, 9, 20 + d, 12).getTime());
      writeFileSync(join(backups, `daily-${key}.sqlite`), key);
    }
    await dailyBackup(dir, NOW);
    const left = readdirSync(backups).sort();
    expect(left).toHaveLength(14);
    expect(left[0]).toBe('daily-2026-10-23.sqlite');
    expect(left[13]).toBe('daily-2026-11-08.sqlite');
  });

  it('does nothing without a database file', async () => {
    const { dir: empty, cleanup: done } = tempDir();
    await dailyBackup(empty, NOW);
    expect(readdirSync(empty)).toEqual([]);
    done();
  });

  it('lists backups newest first with size', async () => {
    await dailyBackup(dir, NOW);
    expect(await listBackups(join(dir, 'nowhere'))).toEqual([]);
    const list = await listBackups(dir);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'daily-2026-11-08.sqlite', size: 5 });
    expect(typeof list[0]!.createdAt).toBe('number');
  });
  // R16: on a corrupt launch the file on disk is a fresh, empty database; it must not become a
  // daily backup nor evict an old good one.
  it('skip: copies nothing and prunes nothing', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (let d = 0; d < 14; d++) {
      writeFileSync(
        join(backups, `daily-${localDateKey(new Date(2026, 9, 20 + d, 12).getTime())}.sqlite`),
        'good',
      );
    }
    const before = readdirSync(backups).sort();
    await dailyBackup(dir, NOW, { skip: true });
    expect(readdirSync(backups).sort()).toEqual(before);
  });

  // Finding 4: a crash mid-copy must not leave a truncated daily under its final name.
  it('a daily copy that fails part-way leaves no daily file, and a later call copies it', async () => {
    const failingFs: DbFs = {
      ...nodeFs,
      async copyFile(_from, to) {
        writeFileSync(to, 'tod');
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      },
    };
    await expect(dailyBackup(dir, NOW, { fs: failingFs })).rejects.toThrow('ENOSPC');
    const file = join(dir, 'backups', 'daily-2026-11-08.sqlite');
    expect(existsSync(file)).toBe(false);
    expect(await listBackups(dir)).toEqual([]);
    await dailyBackup(dir, NOW);
    expect(readFileSync(file, 'utf8')).toBe('today');
  });

  // Finding 5: the time comes from the name, so it is the same on Windows and Linux.
  it('createdAt comes from the stamp in the file name, not the mtime', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    const daily = join(backups, 'daily-2026-11-06.sqlite');
    const pre = join(backups, 'pre-migration-v1-2026-11-07-093015.sqlite');
    writeFileSync(daily, 'a');
    writeFileSync(pre, 'b');
    const jan = new Date(2020, 0, 1);
    utimesSync(daily, jan, jan);
    utimesSync(pre, jan, jan);
    const list = await listBackups(dir);
    expect(list.map((b) => [b.name, b.createdAt])).toEqual([
      ['pre-migration-v1-2026-11-07-093015.sqlite', new Date(2026, 10, 7, 9, 30, 15).getTime()],
      ['daily-2026-11-06.sqlite', new Date(2026, 10, 6).getTime()],
    ]);
  });

  // R16: "Restore latest backup" on the corrupt dialog restores the newest backup made before
  // the corruption was found.
  it('latestBackupBefore returns the newest daily or pre-migration backup before a time', async () => {
    expect(await latestBackupBefore(dir, NOW)).toBeNull();
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (const name of [
      'daily-2026-11-06.sqlite',
      'daily-2026-11-08.sqlite',
      'pre-migration-v1-2026-11-08-110000.sqlite',
      'daily-2026-11-09.sqlite',
      'daily-2026-11-07.sqlite.tmp',
      'notes.txt',
    ]) {
      writeFileSync(join(backups, name), 'x');
    }
    expect((await latestBackupBefore(dir, NOW))?.name).toBe('pre-migration-v1-2026-11-08-110000.sqlite');
    expect((await latestBackupBefore(dir, new Date(2026, 10, 8, 10).getTime()))?.name).toBe(
      'daily-2026-11-08.sqlite',
    );
    expect((await latestBackupBefore(dir, new Date(2026, 10, 8).getTime()))?.name).toBe(
      'daily-2026-11-06.sqlite',
    );
    expect(await latestBackupBefore(dir, new Date(2026, 10, 6).getTime())).toBeNull();
  });

  // Corrupt, then a restore of a backup that is itself corrupt, so the relaunch is corrupt again.
  // The pre-restore copy made then is the empty fresh database: never "the latest backup".
  it('latestBackupBefore never offers a pre-restore copy', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'daily-2026-11-07.sqlite'), 'x');
    writeFileSync(join(backups, `pre-restore-${fileStamp(NOW + 1000)}.sqlite`), 'fresh');
    expect((await latestBackupBefore(dir, NOW + 60_000))?.name).toBe('daily-2026-11-07.sqlite');
  });

  // Corrupt, Sam restores daily-11-07, and it is itself corrupt: the next corrupt launch offers the
  // older good daily, not the damaged one again.
  it('latestBackupBefore skips a backup that fails the check', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'daily-2026-11-06.sqlite'), 'good');
    writeFileSync(join(backups, 'daily-2026-11-07.sqlite'), 'bad');
    const checked: string[] = [];
    const isReadable = async (path: string): Promise<boolean> => {
      checked.push(path);
      return readFileSync(path, 'utf8') === 'good';
    };
    expect((await latestBackupBefore(dir, NOW, isReadable))?.name).toBe('daily-2026-11-06.sqlite');
    expect(checked).toEqual([
      join(backups, 'daily-2026-11-07.sqlite'),
      join(backups, 'daily-2026-11-06.sqlite'),
    ]);
    expect(await latestBackupBefore(dir, NOW, () => Promise.resolve(false))).toBeNull();
  });

  it('latestBackupBefore with the sql.js check skips a damaged daily for an older good one', async () => {
    const good = await openTestDb(join(dir, 'good'));
    await good.close();
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    copyFileSync(join(dir, 'good', DB_FILE), join(backups, 'daily-2026-11-06.sqlite'));
    writeFileSync(join(backups, 'daily-2026-11-07.sqlite'), Buffer.from('not sqlite'.repeat(500)));
    const isReadable = (path: string) => isReadableDatabase(path, WASM_PATH);
    expect((await latestBackupBefore(dir, NOW, isReadable))?.name).toBe('daily-2026-11-06.sqlite');
  });

  it('isReadableDatabase passes a real database and fails a damaged or missing file', async () => {
    const good = await openTestDb(join(dir, 'good'));
    await good.close();
    expect(await isReadableDatabase(join(dir, 'good', DB_FILE), WASM_PATH)).toBe(true);
    writeFileSync(join(dir, 'bad.sqlite'), Buffer.from('not sqlite'.repeat(500)));
    expect(await isReadableDatabase(join(dir, 'bad.sqlite'), WASM_PATH)).toBe(false);
    expect(await isReadableDatabase(join(dir, 'missing.sqlite'), WASM_PATH)).toBe(false);
  });
});
