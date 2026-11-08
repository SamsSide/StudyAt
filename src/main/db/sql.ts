// Small synchronous query helpers over a sql.js database, shared by the repositories.
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';

export type Row = Record<string, SqlValue>;
/** A cell read from a `Row`: undefined if the column is absent. */
export type Cell = SqlValue | undefined;

/** Every row of a query, as column-name objects. */
export function all(raw: SqlJsDatabase, sql: string, params: SqlValue[] = []): Row[] {
  const stmt = raw.prepare(sql);
  try {
    stmt.bind(params);
    const out: Row[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

export function one(raw: SqlJsDatabase, sql: string, params: SqlValue[] = []): Row | null {
  return all(raw, sql, params)[0] ?? null;
}

/** Runs a statement; returns the number of rows changed. */
export function run(raw: SqlJsDatabase, sql: string, params: SqlValue[] = []): number {
  raw.run(sql, params);
  return raw.getRowsModified();
}

/** Runs an INSERT; returns the new row id. */
export function insert(raw: SqlJsDatabase, sql: string, params: SqlValue[] = []): number {
  raw.run(sql, params);
  return Number(one(raw, 'SELECT last_insert_rowid() AS id')!.id);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(raw: SqlJsDatabase, fn: () => T): T {
  raw.exec('BEGIN');
  try {
    const result = fn();
    raw.exec('COMMIT');
    return result;
  } catch (err) {
    raw.exec('ROLLBACK');
    throw err;
  }
}

export const bool = (v: Cell): boolean => v === 1;
export const int = (v: Cell): number => Number(v);
export const intOrNull = (v: Cell): number | null => (v === null || v === undefined ? null : Number(v));
export const text = (v: Cell): string => String(v);
export const textOrNull = (v: Cell): string | null => (v === null || v === undefined ? null : String(v));

/** Parses a JSON column, falling back when the stored text is unreadable. */
export function json<T>(v: Cell, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
