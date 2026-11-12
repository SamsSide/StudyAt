import { describe, expect, it } from 'vitest';
import { minimalPlannerTask } from '../test/mockApi';
import { dayZone, listZone, resolveDrop, taskDrag } from './dnd';

const t = (id: number, over: Parameters<typeof minimalPlannerTask>[0] = {}) =>
  minimalPlannerTask({ id, ...over });

const tasks = {
  1: t(1, { day: '2026-11-11' }),
  4: t(4, { day: null, listId: 2 }),
  5: t(5, { day: null, listId: 2 }),
  6: t(6, { day: null, listId: 2, done: true }),
  7: t(7, { day: '2026-11-12' }),
};
const order = (zone: string): number[] =>
  ({ 'day:2026-11-11': [1], 'day:2026-11-12': [7], 'list:2': [4, 5] })[zone] ?? [];

describe('zone ids', () => {
  it('are prefixed', () => {
    expect(dayZone('2026-11-12')).toBe('day:2026-11-12');
    expect(listZone(2)).toBe('list:2');
    expect(taskDrag(1)).toBe('task:1');
  });
});

describe('resolveDrop', () => {
  it('moves nothing when dropped outside every target', () => {
    expect(resolveDrop('task:1', null, tasks, order)).toBeNull();
  });
  it('drops onto a day at the end of its open tasks', () => {
    expect(resolveDrop('task:1', 'day:2026-11-12', tasks, order)).toEqual({
      id: 1,
      to: { day: '2026-11-12', index: 1 },
    });
  });
  it('drops onto an empty day at index 0', () => {
    expect(resolveDrop('task:1', 'day:2026-11-13', tasks, order)).toEqual({
      id: 1,
      to: { day: '2026-11-13', index: 0 },
    });
  });
  it('drops onto another task, taking its place in its container', () => {
    expect(resolveDrop('task:1', 'task:5', tasks, order)).toEqual({ id: 1, to: { listId: 2, index: 1 } });
  });
  it('drops onto a done task at the end of the open ones', () => {
    expect(resolveDrop('task:1', 'task:6', tasks, order)).toEqual({ id: 1, to: { listId: 2, index: 2 } });
  });
  it('reorders within a list', () => {
    expect(resolveDrop('task:4', 'task:5', tasks, order)).toEqual({ id: 4, to: { listId: 2, index: 1 } });
  });
  it('is null onto itself, onto its own place, or onto the end of its own day', () => {
    expect(resolveDrop('task:1', 'task:1', tasks, order)).toBeNull();
    expect(resolveDrop('task:1', 'day:2026-11-11', tasks, order)).toBeNull();
    expect(resolveDrop('task:5', 'list:2', tasks, order)).toBeNull();
  });
  it('ignores a missing task or an unknown target', () => {
    expect(resolveDrop('task:99', 'day:2026-11-12', tasks, order)).toBeNull();
    expect(resolveDrop('task:1', 'nonsense', tasks, order)).toBeNull();
  });
});
