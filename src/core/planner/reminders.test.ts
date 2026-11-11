// Pin the zone before any date maths (this file only) so DST cases are real and absolute.
// `process` has no types in the core tsconfig, so reach it through globalThis.
(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = 'Europe/London';

import { describe, expect, it } from 'vitest';
import { dueReminders, reminderAt } from './reminders';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('reminders', () => {
  it('reminderAt uses the study day, and the next calendar date before the rollover hour', () => {
    expect(reminderAt('2026-11-11', '18:30', 4)).toBe(at(2026, 11, 11, 18, 30));
    expect(reminderAt('2026-11-11', '02:15', 4)).toBe(at(2026, 11, 12, 2, 15));
    expect(reminderAt('2026-11-11', '04:00', 4)).toBe(at(2026, 11, 11, 4, 0));
  });
  it('reminderAt resolves local wall time on a DST day', () => {
    expect(reminderAt('2026-10-25', '09:00', 4)).toBe(at(2026, 10, 25, 9, 0));
  });
  it('the zone is pinned: BST is UTC+1 on 2026-06-01', () => {
    expect(new Date(Date.UTC(2026, 5, 1, 12)).getHours()).toBe(13);
  });
  it('reminderAt in BST lands on the absolute instant', () => {
    expect(reminderAt('2026-03-29', '09:00', 4)).toBe(Date.UTC(2026, 2, 29, 8, 0));
    expect(reminderAt('2026-07-01', '18:30', 4)).toBe(Date.UTC(2026, 6, 1, 17, 30));
  });
  it('a before-rollover reminder on the spring-forward night resolves to a finite instant', () => {
    // 2026-03-29 01:30 does not exist in London; the platform shifts it forward to 02:30 BST (01:30 UTC).
    const ms = reminderAt('2026-03-28', '01:30', 4);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });
  it('dueReminders skips a malformed reminder without firing or dropping it', () => {
    expect(dueReminders([
      { id: 1, day: '2026-11-11', reminder: 'xx:yy', remindedDay: null, done: false },
      { id: 2, day: '2026-11-11', reminder: '', remindedDay: null, done: false },
    ], at(2026, 11, 12, 12), 4)).toEqual({ fire: [], drop: [] });
  });
  it('dueReminders fires on time and up to 60 min late, drops later, once per task-day', () => {
    const t = (id: number, reminder: string, extra = {}) => ({ id, day: '2026-11-11', reminder, remindedDay: null, done: false, ...extra });
    const now = at(2026, 11, 11, 18, 30);
    expect(dueReminders([
      t(1, '18:30'), t(2, '17:30'), t(3, '17:29'), t(4, '18:31'),
      t(5, '18:00', { done: true }), t(6, '18:00', { remindedDay: '2026-11-11' }),
      { id: 7, day: null, reminder: '18:00', remindedDay: null, done: false },
    ], now, 4)).toEqual({ fire: [1, 2], drop: [3] });
  });
  it('a reminder dated yesterday-before-rollover still fires on the next calendar date', () => {
    expect(dueReminders([{ id: 1, day: '2026-11-10', reminder: '01:00', remindedDay: null, done: false }],
      at(2026, 11, 11, 1, 10), 4)).toEqual({ fire: [1], drop: [] });
  });
});
