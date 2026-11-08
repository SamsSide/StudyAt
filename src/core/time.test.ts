import { describe, expect, it } from 'vitest';
import { addDays, dayKeyOf, daysBetween, weekStartOf } from './time';

const TZ = 'Europe/London';

describe('dayKeyOf', () => {
  it('03:59 belongs to previous day with rollover 4', () => {
    // 2026-11-08 is GMT, so local equals UTC.
    expect(dayKeyOf(Date.UTC(2026, 10, 8, 3, 59), 4, TZ)).toBe('2026-11-07');
  });

  it('04:00 belongs to same day', () => {
    expect(dayKeyOf(Date.UTC(2026, 10, 8, 4, 0), 4, TZ)).toBe('2026-11-08');
  });

  it('uses local wall-clock time, not UTC', () => {
    // 2026-07-01 03:30Z is 04:30 BST: already the 1st locally.
    expect(dayKeyOf(Date.UTC(2026, 6, 1, 3, 30), 4, TZ)).toBe('2026-07-01');
    // 2026-07-01 02:30Z is 03:30 BST: still the 30th.
    expect(dayKeyOf(Date.UTC(2026, 6, 1, 2, 30), 4, TZ)).toBe('2026-06-30');
  });

  it('rollover 0 means midnight', () => {
    expect(dayKeyOf(Date.UTC(2026, 10, 8, 0, 0), 0, TZ)).toBe('2026-11-08');
    expect(dayKeyOf(Date.UTC(2026, 10, 7, 23, 59), 0, TZ)).toBe('2026-11-07');
  });

  it('rolls back across a month and a year edge', () => {
    expect(dayKeyOf(Date.UTC(2026, 0, 1, 2, 0), 4, TZ)).toBe('2025-12-31');
    expect(dayKeyOf(Date.UTC(2026, 2, 1, 1, 0), 4, TZ)).toBe('2026-02-28');
  });

  it('dst spring-forward night stays on the previous day until 04:00 BST', () => {
    // 2026-03-29: 01:00 GMT jumps to 02:00 BST.
    expect(dayKeyOf(Date.UTC(2026, 2, 29, 0, 30), 4, TZ)).toBe('2026-03-28'); // 00:30 GMT
    expect(dayKeyOf(Date.UTC(2026, 2, 29, 1, 30), 4, TZ)).toBe('2026-03-28'); // 02:30 BST
    expect(dayKeyOf(Date.UTC(2026, 2, 29, 2, 59), 4, TZ)).toBe('2026-03-28'); // 03:59 BST
    expect(dayKeyOf(Date.UTC(2026, 2, 29, 3, 0), 4, TZ)).toBe('2026-03-29'); // 04:00 BST
  });

  it('dst fall-back: both 01:30s and 03:59 GMT belong to the previous day', () => {
    // 2026-10-25: 02:00 BST falls back to 01:00 GMT, so 01:30 happens twice.
    expect(dayKeyOf(Date.UTC(2026, 9, 25, 0, 30), 4, TZ)).toBe('2026-10-24'); // 01:30 BST
    expect(dayKeyOf(Date.UTC(2026, 9, 25, 1, 30), 4, TZ)).toBe('2026-10-24'); // 01:30 GMT
    expect(dayKeyOf(Date.UTC(2026, 9, 25, 3, 59), 4, TZ)).toBe('2026-10-24'); // 03:59 GMT
    expect(dayKeyOf(Date.UTC(2026, 9, 25, 4, 0), 4, TZ)).toBe('2026-10-25'); // 04:00 GMT
  });
});

describe('day-key arithmetic', () => {
  it('week starts Monday', () => {
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02'); // Monday
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29'); // across a year edge
  });

  it('addDays crosses months, years and DST changes', () => {
    expect(addDays('2026-11-08', 1)).toBe('2026-11-09');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('daysBetween counts whole days, signed, across DST', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-11-08', '2026-11-02')).toBe(-6);
    expect(daysBetween('2025-11-08', '2026-11-08')).toBe(365);
  });
});
