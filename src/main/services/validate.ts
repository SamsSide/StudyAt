// Payload validation for IPC (spec §3.6): ids are integers, strings are bounded to 500 chars and
// enums are checked. Anything else throws `IpcValidationError`, which the renderer sees as a
// rejected promise. Main never trusts a renderer payload.

export const MAX_STRING = 500;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-negative safe integer (row ids, sort keys). */
export function assertInt(v: unknown, what = 'id'): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw new IpcValidationError(`${what} must be a whole number`);
  }
  return v;
}

export function assertIntOrNull(v: unknown, what = 'id'): number | null {
  return v === null ? null : assertInt(v, what);
}

/** A string of at most `max` chars; `nonEmpty` also rejects one that is blank after trimming. */
export function assertStr(v: unknown, what = 'text', opts: { max?: number; nonEmpty?: boolean } = {}): string {
  const max = opts.max ?? MAX_STRING;
  if (typeof v !== 'string') throw new IpcValidationError(`${what} must be text`);
  if (v.length > max) throw new IpcValidationError(`${what} is longer than ${max} characters`);
  if (opts.nonEmpty && v.trim() === '') throw new IpcValidationError(`${what} can't be empty`);
  return v;
}

export function assertEnum<T extends string>(v: unknown, allowed: readonly T[], what = 'value'): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new IpcValidationError(`${what} must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

export function assertBool(v: unknown, what = 'value'): boolean {
  if (typeof v !== 'boolean') throw new IpcValidationError(`${what} must be true or false`);
  return v;
}

/** A finite number, clamped into min..max (like the settings sanitiser). */
export function clampNum(v: unknown, min: number, max: number, what = 'value'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new IpcValidationError(`${what} must be a number`);
  return Math.min(max, Math.max(min, v));
}

export function assertRecord(v: unknown, what = 'value'): Record<string, unknown> {
  if (!isRecord(v)) throw new IpcValidationError(`${what} must be an object`);
  return v;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` day key. */
export function assertDayKey(v: unknown, what = 'date'): string {
  const s = assertStr(v, what, { max: 10 });
  if (!DAY_KEY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new IpcValidationError(`${what} must be a YYYY-MM-DD date`);
  }
  return s;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function assertColour(v: unknown, what = 'colour'): string {
  const s = assertStr(v, what, { max: 7 });
  if (!HEX_COLOUR.test(s)) throw new IpcValidationError(`${what} must be a #rrggbb colour`);
  return s;
}
