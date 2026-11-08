import { describe, expect, it } from 'vitest';
import { formatClock } from './clock';

describe('formatClock', () => {
  it('shows MM:SS under an hour and H:MM:SS from an hour up', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_599_000)).toBe('59:59');
  });

  it('rounds up to the next whole second, so 00:00 only shows when no time is left', () => {
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });

  it('treats negative time as none left', () => {
    expect(formatClock(-5)).toBe('00:00');
  });
});
