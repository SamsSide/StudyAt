import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyBackup, fileStamp, listBackups, localDateKey } from './backup';
import { DB_FILE } from './db';
import { NOW, tempDir } from './test-helpers';

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
    const left = readdirSync(backups).filter((f) => f.startsWith('daily-')).sort();
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
});
