// Pin the zone before any date maths (this file only) so DST cases are real and absolute.
// `process` has no types in the core tsconfig, so reach it through globalThis.
(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = 'Europe/London';

import { describe, expect, it } from 'vitest';
import { calendarDate, parseDue, wallMs, wallStamp } from './wallclock';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('wallclock', () => {
  it('wall stamps round-trip', () => {
    expect(parseDue('2026-12-14T09:00')).toBe(at(2026, 12, 14, 9));
    expect(wallStamp(at(2026, 12, 14, 9, 5))).toBe('2026-12-14T09:05');
    expect(calendarDate(at(2026, 12, 14, 1))).toBe('2026-12-14');
  });
  it('wallMs reads local wall time', () => {
    expect(wallMs('2026-10-25', '09:00')).toBe(at(2026, 10, 25, 9, 0));
  });
  it('wallMs, wallStamp and calendarDate agree with absolute instants in BST', () => {
    expect(wallMs('2026-07-01', '09:00')).toBe(Date.UTC(2026, 6, 1, 8, 0));
    expect(parseDue('2026-03-29T09:00')).toBe(Date.UTC(2026, 2, 29, 8, 0));
    expect(wallStamp(Date.UTC(2026, 6, 1, 8, 5))).toBe('2026-07-01T09:05');
    expect(calendarDate(Date.UTC(2026, 5, 30, 23, 30))).toBe('2026-07-01');
    expect(wallStamp(wallMs('2026-07-01', '09:05'))).toBe('2026-07-01T09:05');
  });
});
