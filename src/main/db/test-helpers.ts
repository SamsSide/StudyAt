// Shared fixtures for the storage tests: a temp data folder and a Db opened on it with a fixed clock.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeFs, openDatabase, type Db, type DbFs } from './db';

export const WASM_PATH = resolve(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm');
export const BUILTIN_PATH = resolve(__dirname, '../../../assets/builtin.json');

/** 2026-11-08 12:00 local time. */
export const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime();

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'studyat-db-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function openTestDb(dir: string, now = NOW, fs?: DbFs): Promise<Db> {
  return openDatabase({ dir, now: () => now, wasmPath: WASM_PATH, builtinPath: BUILTIN_PATH, fs });
}

/**
 * The real disk, with every write-side call logged in order as `op path` (or `op from -> to`), so a
 * test can check that a copy reaches the disk before the rename that publishes it.
 */
export function recordingFs(): { fs: DbFs; log: string[] } {
  const log: string[] = [];
  const fs: DbFs = {
    ...nodeFs,
    async writeDurable(path, data) {
      log.push(`writeDurable ${path}`);
      await nodeFs.writeDurable(path, data);
    },
    async copyFile(from, to) {
      log.push(`copyFile ${from} -> ${to}`);
      await nodeFs.copyFile(from, to);
    },
    async syncFile(path) {
      log.push(`syncFile ${path}`);
      await nodeFs.syncFile(path);
    },
    async rename(from, to) {
      log.push(`rename ${from} -> ${to}`);
      await nodeFs.rename(from, to);
    },
  };
  return { fs, log };
}
