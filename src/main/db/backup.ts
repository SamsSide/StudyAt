// Daily backups and the backups list (spec §3.3, study-dev rule 2). All dates are local calendar
// dates (not the study-day rollover): a backup is about the file, not about accounting.
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupInfo } from '../../shared/types';
import { copyAtomic, nodeFs, type DbFs } from './db-fs';

export const DB_FILE = 'studyat.sqlite';
export const BACKUPS_DIR = 'backups';
/** Newest daily backups kept (spec §3.3). */
export const DAILY_KEEP = 14;

const DAILY = /^daily-(\d{4})-(\d{2})-(\d{2})\.sqlite$/;
const PRE_MIGRATION = /^pre-migration-v\d+-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/;

/**
 * When a backup was made, from the local stamp in its name (a daily counts from local midnight of
 * its date): the same on Windows, where a copy keeps its source's mtime, and Linux. Null for a
 * name that is neither a daily nor a pre-migration backup.
 */
function stampedAt(name: string): number | null {
  const m = DAILY.exec(name) ?? PRE_MIGRATION.exec(name);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1).map(Number);
  return new Date(y!, mo! - 1, d!, h, mi, sec).getTime();
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` in local time. */
export function localDateKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD-HHmmss` in local time: file-name safe on Windows and sorts by time. */
export function fileStamp(at: number): string {
  const d = new Date(at);
  return `${localDateKey(at)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export interface DailyBackupOptions {
  /**
   * Do nothing at all: no copy, no pruning. Pass `skip: db.recovered === 'corrupt'`: after a
   * corrupt launch the file on disk is a fresh, empty database, which must neither become today's
   * daily (and so "the latest backup") nor evict the oldest good one (R16).
   */
  skip?: boolean;
  /** For tests; defaults to the real disk. */
  fs?: DbFs;
}

/**
 * On the first call of a calendar day, copies `<dir>/studyat.sqlite` to
 * `<dir>/backups/daily-YYYY-MM-DD.sqlite` (through a `.tmp` and a rename, so a crash never leaves
 * a truncated daily), then keeps only the newest 14 daily files. Other backups (pre-migration)
 * are never pruned. Does nothing if there is no database file yet, or with `skip`.
 */
export async function dailyBackup(dir: string, now: number, opts: DailyBackupOptions = {}): Promise<void> {
  if (opts.skip) return;
  const fs = opts.fs ?? nodeFs;
  const source = join(dir, DB_FILE);
  if (!(await fs.exists(source))) return;
  const backups = join(dir, BACKUPS_DIR);
  await fs.mkdir(backups);
  const today = join(backups, `daily-${localDateKey(now)}.sqlite`);
  if (!(await fs.exists(today))) await copyAtomic(fs, source, today);

  const dailies = (await readdir(backups)).filter((f) => DAILY.test(f)).sort();
  for (const old of dailies.slice(0, Math.max(0, dailies.length - DAILY_KEEP))) {
    await unlink(join(backups, old));
  }
}

/**
 * Every `.sqlite` file in `<dir>/backups`, newest first. `createdAt` comes from the stamp in the
 * name; a file without one falls back to its mtime.
 */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const backups = join(dir, BACKUPS_DIR);
  let names: string[];
  try {
    names = await readdir(backups);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: BackupInfo[] = [];
  for (const name of names.filter((n) => n.endsWith('.sqlite'))) {
    const s = await stat(join(backups, name));
    if (s.isFile()) out.push({ name, size: s.size, createdAt: stampedAt(name) ?? Math.round(s.mtimeMs) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/**
 * The newest daily or pre-migration backup made before `ts`, or null. With `ts = db.corruptAt`
 * this is the backup the corrupt dialog's "Restore latest backup" restores (spec §3.3, R16):
 * anything made after the corruption was found is a copy of the fresh database.
 */
export async function latestBackupBefore(dir: string, ts: number): Promise<BackupInfo | null> {
  const list = await listBackups(dir);
  return list.find((b) => stampedAt(b.name) !== null && b.createdAt < ts) ?? null;
}
