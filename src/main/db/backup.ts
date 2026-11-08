// Daily backups and the backups list (spec §3.3, study-dev rule 2). All dates are local calendar
// dates (not the study-day rollover): a backup is about the file, not about accounting.
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupInfo } from '../../shared/types';
import { nodeFs } from './db-fs';

export const DB_FILE = 'studyat.sqlite';
export const BACKUPS_DIR = 'backups';
/** Newest daily backups kept (spec §3.3). */
export const DAILY_KEEP = 14;

const DAILY = /^daily-(\d{4}-\d{2}-\d{2})\.sqlite$/;

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

/**
 * On the first call of a calendar day, copies `<dir>/studyat.sqlite` to
 * `<dir>/backups/daily-YYYY-MM-DD.sqlite`, then keeps only the newest 14 daily files. Other
 * backups (pre-migration) are never pruned. Does nothing if there is no database file yet.
 */
export async function dailyBackup(dir: string, now: number): Promise<void> {
  const source = join(dir, DB_FILE);
  if (!(await nodeFs.exists(source))) return;
  const backups = join(dir, BACKUPS_DIR);
  await mkdir(backups, { recursive: true });
  const today = join(backups, `daily-${localDateKey(now)}.sqlite`);
  if (!(await nodeFs.exists(today))) await copyFile(source, today);

  const dailies = (await readdir(backups)).filter((f) => DAILY.test(f)).sort();
  for (const old of dailies.slice(0, Math.max(0, dailies.length - DAILY_KEEP))) {
    await unlink(join(backups, old));
  }
}

/** Every `.sqlite` file in `<dir>/backups`, newest first. */
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
    if (s.isFile()) out.push({ name, size: s.size, createdAt: Math.round(s.mtimeMs) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}
