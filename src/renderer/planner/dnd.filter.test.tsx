import type * as DndKit from '@dnd-kit/core';
import type { Announcements, DragEndEvent } from '@dnd-kit/core';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, weekStartOf } from '../../core/time';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects } from '../test/mockApi';
import { PlannerDnd } from './dnd';
import { FilterButton } from './FilterButton';
import { plannerToday } from './format';
import { PlannerWidget } from './PlannerWidget';
import { resetPlannerStore, usePlannerStore } from './plannerStore';
import { WeekView } from './WeekView';

// Capture PlannerDnd's drag-end handler so a test can drop a task without a real pointer.
let dragEnd: ((e: DragEndEvent) => void) | undefined;
let announce: Announcements | undefined;
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof DndKit>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dragEnd = props.onDragEnd as typeof dragEnd;
      announce = props.accessibility?.announcements;
      return <actual.DndContext {...props} />;
    },
  };
});

const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const today = () => plannerToday(DEFAULT_SETTINGS.rolloverHour);

const weekOf = (d: string) =>
  Promise.resolve({
    from: weekStartOf(d),
    to: addDays(weekStartOf(d), 6),
    tasks: [],
    deadlines: [],
    studiedMs: {},
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetPlannerStore();
  resetStudyStore();
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub, subjects: seedSubjects() });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a filter and drag and drop', () => {
  it('leaves the drop index counted in the unfiltered open order', async () => {
    const day = today();
    const tasks = [
      minimalPlannerTask({ id: 1, title: 'Alpha', day, sort: 0, effectiveSubjectId: 3 }),
      minimalPlannerTask({ id: 2, title: 'Hidden', day, sort: 1, effectiveSubjectId: 2 }),
      minimalPlannerTask({ id: 3, title: 'Gamma', day, sort: 2, effectiveSubjectId: 3 }),
    ];
    const api = mockApi({
      planner: {
        day: vi.fn((d: string) =>
          Promise.resolve({
            from: d,
            to: d,
            tasks: tasks.filter((t) => t.day === d),
            deadlines: [],
            studiedMs: {},
          }),
        ),
        week: vi.fn(weekOf),
      },
      tasks: { move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })) },
    });
    installMockApi(api);
    render(<PlannerWidget />);
    await screen.findByText('Hidden');
    act(() => usePlannerStore.getState().setFilter({ subjectId: 3, tag: null }));
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();

    act(() => {
      dragEnd?.({ active: { id: 'task:1' }, over: { id: 'task:3' } } as unknown as DragEndEvent);
    });
    // Alpha lands on Gamma's place: index 2 among all three open tasks, not 1 among the two shown.
    expect(api.tasks.move).toHaveBeenCalledWith(1, { day, index: 2 });
  });
});

describe('the drag-end announcement', () => {
  it('names the drop that was made, although the store has moved first', async () => {
    const day = today();
    const tomorrow = addDays(day, 1);
    const tasks = [
      minimalPlannerTask({ id: 1, title: 'Alpha', day, sort: 0 }),
      minimalPlannerTask({ id: 2, title: 'Beta', day: tomorrow, sort: 0 }),
    ];
    installMockApi(
      mockApi({
        planner: {
          day: vi.fn((d: string) =>
            Promise.resolve({
              from: d,
              to: d,
              tasks: tasks.filter((t) => t.day === d),
              deadlines: [],
              studiedMs: {},
            }),
          ),
          week: vi.fn(weekOf),
        },
        tasks: { move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })) },
      }),
    );
    render(<PlannerWidget />);
    await screen.findByText('Alpha');
    const ev = { active: { id: 'task:1' }, over: { id: `day:${tomorrow}` } } as unknown as DragEndEvent;
    let said: string | undefined;
    act(() => {
      dragEnd?.(ev); // dnd-kit runs the context's handler first ...
      expect(usePlannerStore.getState().tasks[1]?.day).toBe(tomorrow);
      said = announce?.onDragEnd?.(ev) as string | undefined; // ... then the announcement.
    });
    expect(said).toMatch(/^Moved "Alpha" to .+\.$/);
  });
});

describe('the filter popover', () => {
  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi({}));
    render(
      <div>
        <FilterButton />
        <p>elsewhere</p>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByRole('group', { name: 'Filter tasks' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Subject' }));
    expect(screen.getByRole('group', { name: 'Filter tasks' })).toBeInTheDocument();
    await user.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('group', { name: 'Filter tasks' })).not.toBeInTheDocument();
  });
});

describe('Week navigation', () => {
  it('clears the chosen day when the shown week holds today', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi({ planner: { week: vi.fn(weekOf) } }));
    render(
      <PlannerDnd>
        <WeekView />
      </PlannerDnd>,
    );
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(usePlannerStore.getState().day).toBe(addDays(weekStartOf(today()), 7));
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(usePlannerStore.getState().day).toBeNull();
  });
});
