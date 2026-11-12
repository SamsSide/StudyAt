import type * as DndKit from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, weekStartOf } from '../../../core/time';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { Deadline, PlannerTask, PublicSettings, TaskList } from '../../../shared/types';
import { resetStudyStore, useStudyStore } from '../../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../../test/mockApi';
import { resetPlannerStore } from '../plannerStore';
import { shiftMonth } from './BoardMonth';
import { TasksBoard } from './TasksBoard';

// Capture PlannerDnd's drag-end handler so a test can drop a task without a real pointer.
let dragEnd: ((e: DragEndEvent) => void) | undefined;
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof DndKit>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dragEnd = props.onDragEnd as typeof dragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const MIN = 60_000;
// Wednesday 11 November 2026, midday.
const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const TODAY = '2026-11-11';

const list = (over: Partial<TaskList> = {}): TaskList => ({
  id: 10,
  name: 'Inbox',
  subjectId: null,
  sort: 0,
  createdAt: 0,
  ...over,
});

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
  id: 1,
  title: 'Networks CW',
  kind: 'coursework',
  subjectId: 2,
  due: '2026-11-20T12:00',
  note: '',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function publicSettings(): PublicSettings {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, onboarded: true };
}

interface Seed {
  tasks?: PlannerTask[];
  lists?: TaskList[];
  deadlines?: Deadline[];
  studiedMs?: Record<string, number>;
}

function apiFor(seed: Seed = {}): MockApi {
  const tasks = seed.tasks ?? [];
  const range = (from: string, to: string) =>
    Promise.resolve({
      from,
      to,
      tasks: tasks.filter((t) => t.day !== null && t.day >= from && t.day <= to),
      deadlines: seed.deadlines ?? [],
      studiedMs: seed.studiedMs ?? {},
    });
  return mockApi({
    settings: { get: vi.fn(() => Promise.resolve(publicSettings())) },
    planner: {
      week: vi.fn((day: string) => range(weekStartOf(day), addDays(weekStartOf(day), 6))),
      day: vi.fn((day: string) => range(day, day)),
      month: vi.fn((month: string) =>
        range(weekStartOf(`${month}-01`), addDays(weekStartOf(`${month}-30`), 6)),
      ),
      lists: vi.fn(() =>
        Promise.resolve({
          lists: seed.lists ?? [],
          tasks: tasks.filter((t) => t.listId !== null),
          deadlines: seed.deadlines ?? [],
        }),
      ),
    },
    tasks: { move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })) },
  });
}

async function renderBoard(seed: Seed = {}) {
  useStudyStore.setState({ settings: publicSettings(), subjects: seedSubjects() });
  const api = apiFor(seed);
  installMockApi(api);
  render(<TasksBoard />);
  await waitFor(() => expect(api.planner.lists).toHaveBeenCalled());
  return api;
}

const viewButton = (name: string) =>
  within(screen.getByRole('group', { name: 'Board view' })).getByRole('button', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetPlannerStore();
  resetStudyStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the board view switch', () => {
  it('offers Day · Week · Month, Week first pressed', async () => {
    await renderBoard();
    const names = within(screen.getByRole('group', { name: 'Board view' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Day', 'Week', 'Month']);
    expect(viewButton('Week')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Today button', () => {
  const today = () => screen.getByRole('button', { name: 'Today' });

  it('is disabled on the day, week or month that holds today, by view', async () => {
    await renderBoard();
    expect(today()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(viewButton('Day'));
    expect(today()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    // Thursday: same week and month, but not today.
    expect(today()).not.toHaveAttribute('aria-disabled');
    await userEvent.click(viewButton('Week'));
    expect(today()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(viewButton('Month'));
    expect(today()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(today()).not.toHaveAttribute('aria-disabled');
    await userEvent.click(today());
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });

  it('ignores clicks while disabled', async () => {
    await renderBoard();
    await userEvent.click(viewButton('Month'));
    // Back to November by the arrows: the board now sits on Sun 1 Nov, still today's month.
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(today()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(today());
    await userEvent.click(viewButton('Day'));
    expect(screen.getByRole('region', { name: 'Sun 1 Nov' })).toBeInTheDocument();
    await userEvent.click(today());
    expect(screen.getByRole('region', { name: 'Wed 11 Nov' })).toBeInTheDocument();
  });
});

describe('BoardDay', () => {
  const lab = minimalPlannerTask({
    id: 1,
    title: 'Lab 3: lambda calculus',
    day: TODAY,
    note: 'Chapter 4, then the exercises',
    estimateMin: 45,
    actualMs: 32 * MIN,
    subtasks: [
      { id: 1, taskId: 1, text: 'Read the handout', done: true, sort: 0 },
      { id: 2, taskId: 1, text: 'Exercises 1-5', done: false, sort: 1 },
    ],
  });

  it("shows the day's tasks with note, subtasks and estimate vs actual expanded, and the lists on the right", async () => {
    await renderBoard({ tasks: [lab], lists: [list()], deadlines: [deadline({ due: '2026-11-11T17:00' })] });
    await userEvent.click(viewButton('Day'));
    expect(viewButton('Day')).toHaveAttribute('aria-pressed', 'true');

    const day = screen.getByRole('region', { name: 'Wed 11 Nov' });
    await within(day).findByText('Lab 3: lambda calculus');
    expect(within(day).getByText('Chapter 4, then the exercises')).toBeInTheDocument();
    expect(within(day).getByText('32m / 45m')).toBeInTheDocument();
    expect(within(day).getByRole('checkbox', { name: 'Read the handout' })).toBeChecked();
    expect(within(day).getByRole('checkbox', { name: 'Exercises 1-5' })).not.toBeChecked();
    expect(within(day).getByText('Networks CW')).toBeInTheDocument();
    expect(within(day).getByRole('textbox', { name: 'Add to Wed 11 Nov' })).toBeInTheDocument();

    // The lists sit in one right-hand column, beside the day, ready to drag from.
    const column = document.querySelector('[data-day-lists]');
    expect(column).not.toBeNull();
    const lists = within(column as HTMLElement).getByRole('region', { name: 'Lists' });
    expect(within(lists).getByRole('textbox', { name: 'List name' })).toHaveValue('Inbox');
    expect(column?.querySelector('[style]')).toHaveStyle({
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
    });
    expect(day.compareDocumentPosition(column as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ticks a subtask through the store', async () => {
    const api = await renderBoard({ tasks: [lab] });
    await userEvent.click(viewButton('Day'));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Exercises 1-5' }));
    expect(api.subtasks.update).toHaveBeenCalledWith(2, { done: true });
  });

  it('moves a day with ‹ › and says so kindly when nothing is planned', async () => {
    const api = await renderBoard();
    await userEvent.click(viewButton('Day'));
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByRole('region', { name: 'Thu 12 Nov' })).toBeInTheDocument();
    expect(api.planner.day).toHaveBeenLastCalledWith('2026-11-12');
    expect(screen.getByText('Nothing planned for this day.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByRole('region', { name: 'Tue 10 Nov' })).toBeInTheDocument();
  });

  it('dropping a list task on the day moves it to the end of the day', async () => {
    const api = await renderBoard({
      lists: [list()],
      tasks: [lab, minimalPlannerTask({ id: 5, title: 'Lambda notes', day: null, listId: 10 })],
    });
    await userEvent.click(viewButton('Day'));
    await screen.findByText('Lambda notes');
    act(() =>
      dragEnd?.({ active: { id: 'task:5' }, over: { id: `day:${TODAY}` } } as unknown as DragEndEvent),
    );
    expect(api.tasks.move).toHaveBeenCalledWith(5, { day: TODAY, index: 1 });
  });
});

describe('BoardMonth', () => {
  const five = ['Lab 3', 'Quiz 2', 'Essay plan', 'Flashcards', 'Past paper'].map((title, i) =>
    minimalPlannerTask({ id: 20 + i, title, day: '2026-11-17', sort: i }),
  );

  async function openMonth(seed: Seed = {}) {
    const api = await renderBoard(seed);
    await userEvent.click(viewButton('Month'));
    return api;
  }

  const cell = (day: string) => document.querySelector(`[data-month-cell="${day}"]`) as HTMLElement;

  it('shifts months across a year end', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('heads "November 2026" and lays out 42 Monday-first cells from Mon 26 Oct', async () => {
    const api = await openMonth();
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(api.planner.month).toHaveBeenLastCalledWith('2026-11');
    const cells = document.querySelectorAll('[data-month-cell]');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toHaveAttribute('data-month-cell', '2026-10-26');
    expect(cells[41]).toHaveAttribute('data-month-cell', '2026-12-06');
    expect(cell('2026-10-26')).toHaveAttribute('data-outside', 'true');
    expect(cell('2026-11-01')).not.toHaveAttribute('data-outside');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  it('shows three titles and "+2 more" for a day with five tasks', async () => {
    await openMonth({ tasks: five });
    const c = cell('2026-11-17');
    await within(c).findByText('Lab 3');
    expect(within(c).getByText('Quiz 2')).toBeInTheDocument();
    expect(within(c).getByText('Essay plan')).toBeInTheDocument();
    expect(within(c).queryByText('Flashcards')).not.toBeInTheDocument();
    expect(within(c).getByText('+2 more')).toBeInTheDocument();
  });

  it("marks today's cell with aria-current, and shows studied time and deadline chips", async () => {
    await openMonth({
      studiedMs: { '2026-11-09': 45 * MIN },
      deadlines: [deadline(), deadline({ id: 2, title: 'Late CW', due: '2026-11-21T02:00' })],
    });
    expect(cell(TODAY)).toHaveAttribute('aria-current', 'date');
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(await within(cell('2026-11-09')).findByText('45m studied')).toBeInTheDocument();
    expect(within(cell('2026-11-10')).queryByText(/studied/)).not.toBeInTheDocument();
    expect(within(cell('2026-11-20')).getByText('Networks CW')).toBeInTheDocument();
    // Before the 04:00 rollover: the previous study day.
    expect(within(cell('2026-11-20')).getByText('Late CW')).toBeInTheDocument();
  });

  it('clicking 12 Nov opens the Day view on 2026-11-12', async () => {
    const api = await openMonth();
    await userEvent.click(screen.getByRole('button', { name: 'Open Thu 12 Nov' }));
    expect(viewButton('Day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Thu 12 Nov' })).toBeInTheDocument();
    expect(api.planner.day).toHaveBeenLastCalledWith('2026-11-12');
  });

  it('clicking the empty part of a cell opens its day too', async () => {
    await openMonth();
    await userEvent.click(cell('2026-11-12'));
    expect(screen.getByRole('region', { name: 'Thu 12 Nov' })).toBeInTheDocument();
  });

  it('moves a month with ‹ ›', async () => {
    const api = await openMonth();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    expect(api.planner.month).toHaveBeenLastCalledWith('2026-12');
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
  });

  it('dropping a task on a month cell moves it to the end of that day', async () => {
    const api = await openMonth({
      tasks: [
        ...five,
        minimalPlannerTask({ id: 40, title: 'Seminar prep', day: '2026-11-20' }),
        minimalPlannerTask({ id: 41, title: 'Old notes', day: '2026-11-20', done: true }),
      ],
    });
    await within(cell('2026-11-17')).findByText('Lab 3');
    act(() =>
      dragEnd?.({ active: { id: 'task:20' }, over: { id: 'day:2026-11-20' } } as unknown as DragEndEvent),
    );
    expect(api.tasks.move).toHaveBeenCalledWith(20, { day: '2026-11-20', index: 1 });
  });
});
