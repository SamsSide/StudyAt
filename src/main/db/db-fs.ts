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
