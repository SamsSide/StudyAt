import { describe, expect, it } from 'vitest';
import { DEADLINE_DEFAULT_TIME, formatCountdown } from './deadlines';

const at = (y: number, mo: number, d: number, h = 0) => new Date(y, mo - 1, d, h).getTime();

describe('deadlines', () => {
  it('formatCountdown shows a dash for a non-numeric due time', () => {
    expect(formatCountdown(NaN, 1_000)).toBe('—');
  });
  it('formatCountdown at each boundary', () => {
    const now = at(2026, 11, 11, 12);
    const H = 3_600_000, M = 60_000;
    expect(formatCountdown(now + 23 * 24 * H + 4 * H, now)).toBe('23d 4h');
    expect(formatCountdown(now + 48 * H, now)).toBe('2d 0h');
    expect(formatCountdown(now + 48 * H - 1, now)).toBe('47h 59m');
    expect(formatCountdown(now + 31 * H + 12 * M, now)).toBe('31h 12m');
    expect(formatCountdown(now + H, now)).toBe('1h 0m');
    expect(formatCountdown(now + 42 * M + 8_000, now)).toBe('42m 08s');
    expect(formatCountdown(now + 1_000, now)).toBe('0m 01s');
    expect(formatCountdown(now, now)).toBe('Due');
    expect(formatCountdown(now - 5 * M, now)).toBe('Due');
  });
  it('has default times per kind', () => {
    expect(DEADLINE_DEFAULT_TIME).toEqual({ exam: '09:00', coursework: '12:00' });
  });
});
