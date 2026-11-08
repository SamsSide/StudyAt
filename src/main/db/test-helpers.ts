// Shared fixtures for the storage tests: a temp data folder and a Db opened on it with a fixed clock.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, type Db, type DbFs } from './db';

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
