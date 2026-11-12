import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXT_FOCUS_NOTE, TASK_GONE } from '../../shared/planner';
import { idleTimerState, installMockApi, minimalPlannerTask as task, mockApi } from '../test/mockApi';
import { resetStudyStore, useStudyStore } from '../shell/store';
import {
  deadlinesOn,
  matchesFilter,
  resetPlannerStore,
  tasksInList,
  tasksOnDay,
  usePlannerStore,
} from './plannerStore';
import { DEFAULT_SETTINGS } from '../../shared/settings';

const store = () => usePlannerStore.getState();
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  resetPlannerStore();
  resetStudyStore();
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub });
});

describe('plannerStore', () => {
  it('apply merges changed tasks and drops removed ids', () => {
    store().apply({ tasks: [task({ id: 1 }), task({ id: 2 })], removed: [] });
    store().apply({ tasks: [task({ id: 2, title: 'Two' })], removed: [1] });
    expect(Object.keys(store().tasks)).toEqual(['2']);
    expect(store().tasks[2]?.title).toBe('Two');
  });

  it('tasksOnDay orders open tasks by sort, then done tasks', () => {
    store().apply({
      tasks: [
        task({ id: 1, sort: 0, done: true }),
        task({ id: 2, sort: 2 }),
        task({ id: 3, sort: 1 }),
        task({ id: 4, day: '1970-01-06' }),
        task({ id: 5, day: null, listId: 9 }),
      ],
      removed: [],
    });
    expect(tasksOnDay(store(), '1970-01-05').map((t) => t.id)).toEqual([3, 2, 1]);
    expect(tasksInList(store(), 9).map((t) => t.id)).toEqual([5]);
  });

  it('matchesFilter checks the effective subject and the tag; null means any', () => {
    const t = task({ effectiveSubjectId: 3, tags: ['lecture'] });
    expect(matchesFilter(t, { subjectId: null, tag: null })).toBe(true);
    expect(matchesFilter(t, { subjectId: 3, tag: 'lecture' })).toBe(true);
    expect(matchesFilter(t, { subjectId: 2, tag: null })).toBe(false);
    expect(matchesFilter(t, { subjectId: null, tag: 'exam' })).toBe(false);
  });

  it('keeps the deadlines main reported for a single day', async () => {
    const d = {
      id: 7,
      title: 'Algorithms',
      kind: 'exam' as const,
      subjectId: null,
      due: '1970-01-05T09:00',
      note: '',
      done: false,
      createdAt: 0,
      updatedAt: 0,
    };
    installMockApi(
      mockApi({
        planner: {
          day: vi.fn(() =>
            Promise.resolve({
              from: '1970-01-05',
              to: '1970-01-05',
              tasks: [],
              deadlines: [d],
              studiedMs: {},
            }),
          ),
        },
      }),
    );
    await store().loadRange('day', '1970-01-05');
    expect(deadlinesOn(store(), '1970-01-05')).toEqual([d]);
    expect(deadlinesOn(store(), '1970-01-06')).toEqual([]);
  });

  describe('revision offer', () => {
    const tick = async (t: ReturnType<typeof task>) => {
      installMockApi(
        mockApi({
          tasks: { update: vi.fn(() => Promise.resolve({ tasks: [{ ...t, done: true }], removed: [] })) },
        }),
      );
      store().apply({ tasks: [t], removed: [] });
      await store().update(t.id, { done: true });
    };

    it('ticking a task tagged lecture offers 1 · 3 · 7 · 21', async () => {
      await tick(task({ id: 1, tags: ['lecture'] }));
      expect(store().revisionOffer).toEqual({ taskId: 1, days: [1, 3, 7, 21] });
    });

    it('a revision task or one without the tag does not', async () => {
      await tick(task({ id: 1, tags: ['lecture'], kind: 'revision' }));
      expect(store().revisionOffer).toBeNull();
      await tick(task({ id: 2, tags: ['reading'] }));
      expect(store().revisionOffer).toBeNull();
    });

    it('ticking another task replaces the offer', async () => {
      await tick(task({ id: 1, tags: ['lecture'] }));
      await tick(task({ id: 2, tags: ['lecture'] }));
      expect(store().revisionOffer?.taskId).toBe(2);
      await tick(task({ id: 3 }));
      expect(store().revisionOffer).toBeNull();
    });
  });

  describe('startTask', () => {
    it('a running break sets the next-focus notice', async () => {
      installMockApi(
        mockApi({
          timer: {
            startTask: vi.fn(() =>
              Promise.resolve({ ...idleTimerState(), mode: 'short' as const, status: 'running' as const }),
            ),
          },
        }),
      );
      await store().startTask(4);
      expect(store().notice).toBe(NEXT_FOCUS_NOTE);
      expect(NEXT_FOCUS_NOTE).toBe('Task set for your next focus.');
    });

    it('a paused break also sets the notice (main holds the task the same way)', async () => {
      installMockApi(
        mockApi({
          timer: {
            startTask: vi.fn(() =>
              Promise.resolve({ ...idleTimerState(), mode: 'long' as const, status: 'paused' as const }),
            ),
          },
        }),
      );
      await store().startTask(4);
      expect(store().notice).toBe(NEXT_FOCUS_NOTE);
    });

    it.each([
      ['idle', 'short', 'idle'],
      ['a running focus', 'focus', 'running'],
      ['a paused focus', 'focus', 'paused'],
      ['a running countdown', 'countdown', 'running'],
    ] as const)('%s shows no notice', async (_name, mode, status) => {
      installMockApi(
        mockApi({
          timer: { startTask: vi.fn(() => Promise.resolve({ ...idleTimerState(), mode, status })) },
        }),
      );
      await store().startTask(4);
      expect(store().notice).toBeNull();
    });

    it('a rejection says the task is gone and reloads the day', async () => {
      const api = mockApi({ timer: { startTask: vi.fn(() => Promise.reject(new Error('nope'))) } });
      installMockApi(api);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await store().loadRange('day', '1970-01-05');
      await store().startTask(4);
      await flush();
      expect(store().notice).toBe(TASK_GONE);
      expect(TASK_GONE).toBe('That task no longer exists.');
      expect(api.planner.day).toHaveBeenCalledTimes(2);
    });
  });

  it('move is optimistic and is undone when main refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installMockApi(mockApi({ tasks: { move: vi.fn(() => Promise.reject(new Error('no'))) } }));
    store().apply({ tasks: [task({ id: 1 }), task({ id: 2, day: null, listId: 5 })], removed: [] });
    const pending = store().move(1, { listId: 5, index: 0 });
    expect(store().tasks[1]?.listId).toBe(5);
    expect(store().tasks[1]?.day).toBeNull();
    await pending;
    expect(store().tasks[1]?.day).toBe('1970-01-05');
  });
});
