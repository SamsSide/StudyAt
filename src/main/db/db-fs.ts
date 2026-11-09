// The file operations storage needs, behind a small interface so tests can inject a slow or
// failing disk (spec §3.3 atomic writes).
import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';

export interface DbFs {
  /** The file's bytes, or null if it does not exist. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Writes `data` to `path` and fsyncs it before resolving. */
  writeDurable(path: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Fsyncs an existing file's contents to disk, changing nothing. */
  syncFile(path: string): Promise<void>;
  /** Creates the directory and any parents; fine if it exists. */
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeFs: DbFs = {
  async readFile(path) {
    try {
      return await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  async writeDurable(path, data) {
    const handle = await open(path, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  copyFile: (from, to) => copyFile(from, to),
  async syncFile(path) {
    const handle = await open(path, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async exists(path) {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Waits between rename attempts, about 2 s in all. On Windows, Defender or the search indexer
 * briefly opening the file makes a rename fail with EPERM, EACCES or EBUSY; giving up at once
 * would lose a checkpoint of focus time at quit (study-dev rule 2).
 */
export const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 500, 750];

const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** `fs.rename`, retried with backoff while it fails with a transient Windows error. */
export async function renameWithRetry(fs: DbFs, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || code === undefined || !TRANSIENT_CODES.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Copies `from` to `<to>.tmp`, fsyncs it, then renames it to `to`, so neither a crash mid-copy nor
 * a power cut just after the rename leaves a truncated or empty file under the final name (a
 * backup that would be offered for restore, or a restored `studyat.sqlite`).
 */
export async function copyAtomic(fs: DbFs, from: string, to: string): Promise<void> {
  const tmp = `${to}.tmp`;
  await fs.copyFile(from, tmp);
  await fs.syncFile(tmp);
  await renameWithRetry(fs, tmp, to);
}
