import { describe, expect, it } from 'vitest';
import { minimalPlannerTask } from '../test/mockApi';
import { boardTitle, estimateChip, monthTitle, plannerToday, rolledLabel, subtaskCount } from './format';

const MIN = 60_000;

describe('planner format', () => {
  it('estimateChip shows actual / estimate and flags going over', () => {
    expect(estimateChip(32 * MIN, 45)).toEqual({ text: '32m / 45m', over: false });
    expect(estimateChip(45 * MIN, 45).over).toBe(false);
    expect(estimateChip(50 * MIN, 45).over).toBe(true);
    expect(estimateChip(0, 90).text).toBe('0m / 1h 30m');
  });

  it('rolledLabel names the original day', () => {
    expect(rolledLabel('2026-11-10')).toBe('from Tue 10 Nov');
  });

  it('boardTitle is the month and ISO week of the Thursday', () => {
    expect(boardTitle('2026-11-11')).toBe('November 2026 W46');
    expect(boardTitle('2027-01-01')).toBe('December 2026 W53');
  });

  it('monthTitle names the month', () => {
    expect(monthTitle('2026-11')).toBe('November 2026');
  });

  it('plannerToday follows the rollover hour', () => {
    expect(plannerToday(4, new Date(2026, 10, 12, 2).getTime())).toBe('2026-11-11');
    expect(plannerToday(4, new Date(2026, 10, 12, 5).getTime())).toBe('2026-11-12');
  });

  it('subtaskCount is done/total, or null with none', () => {
    expect(subtaskCount(minimalPlannerTask())).toBeNull();
    const sub = (id: number, done: boolean) => ({ id, taskId: 1, text: 'x', done, sort: id });
    expect(subtaskCount(minimalPlannerTask({ subtasks: [sub(1, true), sub(2, false), sub(3, true)] }))).toBe(
      '2/3',
    );
  });
});
