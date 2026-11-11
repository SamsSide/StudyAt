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
});
