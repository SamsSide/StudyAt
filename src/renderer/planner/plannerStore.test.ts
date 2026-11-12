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
import type { Deadline } from '../../shared/types';

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
  it('opens a task as the card by default, expands to full, and closing resets to card', () => {
    const s = usePlannerStore.getState();
    s.openDetail(5);
    expect(usePlannerStore.getState()).toMatchObject({ detailTaskId: 5, detailMode: 'card' });
    usePlannerStore.getState().expandDetail();
    expect(usePlannerStore.getState().detailMode).toBe('full');
    usePlannerStore.getState().closeDetail();
    expect(usePlannerStore.getState()).toMatchObject({ detailTaskId: null, detailMode: 'card' });
    usePlannerStore.getState().openDetail(6, 'full');
    expect(usePlannerStore.getState().detailMode).toBe('full');
  });

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

  describe('stale deadlines and mounted ranges', () => {
    const dl = (id: number, due: string, over: Partial<Deadline> = {}): Deadline => ({
      id,
      title: `D${id}`,
      kind: 'exam',
      subjectId: 1,
      due,
      note: '',
      done: false,
      createdAt: 0,
      updatedAt: 0,
      ...over,
    });
    const range = (from: string, to: string, deadlines: Deadline[]) => ({
      from,
      to,
      tasks: [],
      deadlines,
      studiedMs: {},
    });

    it('a range reply drops stored deadlines on its days that it no longer holds', async () => {
      const outside = dl(3, '2099-01-01T09:00');
      let reply = [dl(1, '1970-01-06T12:00'), dl(2, '1970-01-07T12:00'), outside];
      installMockApi(
        mockApi({
          planner: {
            week: vi.fn(() => Promise.resolve(range('1970-01-05', '1970-01-11', reply.slice(0, 2)))),
            lists: vi.fn(() => Promise.resolve({ lists: [], tasks: [], deadlines: [] })),
          },
        }),
      );
      store().apply({ tasks: [], removed: [] });
      usePlannerStore.setState({ deadlines: { 3: outside } });
      await store().loadRange('week', '1970-01-05');
      expect(Object.keys(store().deadlines).sort()).toEqual(['1', '2', '3']);
      reply = [dl(2, '1970-01-07T12:00')];
      installMockApi(
        mockApi({
          planner: { week: vi.fn(() => Promise.resolve(range('1970-01-05', '1970-01-11', reply))) },
        }),
      );
      await store().loadRange('week', '1970-01-05');
      expect(Object.keys(store().deadlines).sort()).toEqual(['2', '3']);
    });

    it('a lists reply rebuilds the upcoming deadlines', async () => {
      installMockApi(
        mockApi({
          planner: {
            lists: vi.fn(() =>
              Promise.resolve({ lists: [], tasks: [], deadlines: [dl(2, '2099-01-01T09:00')] }),
            ),
          },
        }),
      );
      usePlannerStore.setState({
        deadlines: { 1: dl(1, '2099-01-01T09:00'), 2: dl(2, '2099-01-01T09:00'), 5: dl(5, '1970-01-01T09:00') },
      });
      await store().loadLists();
      expect(Object.keys(store().deadlines).sort()).toEqual(['2', '5']);
    });

    it('reload refreshes every mounted key of a kind, until each view releases it', async () => {
      const day = vi.fn((d: string) => Promise.resolve(range(d, d, [])));
      installMockApi(mockApi({ planner: { day } }));
      const a = store().watchRange('day', '1970-01-05');
      const b = store().watchRange('day', '1970-01-06');
      const a2 = store().watchRange('day', '1970-01-05');
      await a.loaded;
      day.mockClear();
      await store().reload();
      expect(day.mock.calls.map((c) => c[0]).sort()).toEqual(['1970-01-05', '1970-01-06']);
      a.release();
      day.mockClear();
      await store().reload();
      expect(day).toHaveBeenCalledTimes(2); // the second view on the 5th still holds it
      a2.release();
      b.release();
      day.mockClear();
      await store().reload();
      expect(day.mock.calls.map((c) => c[0])).toEqual(['1970-01-06']); // none mounted: the last loaded
    });
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
    expect(store().notice).toBe("Couldn't move that task.");
  });

  it('move counts open peers only, leaving done tasks where they are', async () => {
    installMockApi(mockApi({ tasks: { move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })) } }));
    store().apply({
      tasks: [
        task({ id: 1 }),
        task({ id: 2, day: null, listId: 5, sort: 0, done: true }),
        task({ id: 3, day: null, listId: 5, sort: 1 }),
      ],
      removed: [],
    });
    await store().move(1, { listId: 5, index: 0 });
    expect(store().tasks[1]?.sort).toBe(0);
    expect(store().tasks[3]?.sort).toBe(1);
    expect(store().tasks[2]?.sort).toBe(0);
  });
});
