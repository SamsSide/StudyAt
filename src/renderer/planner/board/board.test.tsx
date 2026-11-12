import type * as DndKit from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, weekStartOf } from '../../../core/time';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { Deadline, PlannerTask, PublicSettings, TaskList } from '../../../shared/types';
import { Shell } from '../../shell/Shell';
import { resetStudyStore, useStudyStore } from '../../shell/store';
import { testRegistry } from '../../shell/testRegistry';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../../test/mockApi';
import { PlannerWidget } from '../PlannerWidget';
import { resetPlannerStore, usePlannerStore } from '../plannerStore';
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
    // A test can pose a drag in progress for the board's insertion line.
    useDndContext: () => {
      const real = actual.useDndContext();
      return posedDrag ? { ...real, ...posedDrag } : real;
    },
  };
});
let posedDrag: { active: { id: string }; over: { id: string } } | null = null;

const MIN = 60_000;
// Wednesday 11 November 2026, midday: the board opens on W46, Monday 9 November.
const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const MON = '2026-11-09';

const list = (over: Partial<TaskList> = {}): TaskList => ({
  id: 10,
  name: 'COMP2221 Programming Paradigms',
  subjectId: 2,
  sort: 0,
  createdAt: 0,
  ...over,
});

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
  id: 1,
  title: 'Networks CW',
  kind: 'coursework',
  subjectId: 2,
  due: '2026-11-10T12:00',
  note: '',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function publicSettings(open = false): PublicSettings {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  const settings = { ...rest, onboarded: true };
  settings.widgets.tasks.open = open;
  return settings;
}

interface Seed {
  tasks?: PlannerTask[];
  lists?: TaskList[];
  deadlines?: Deadline[];
  studiedMs?: Record<string, number>;
}

function apiFor(seed: Seed = {}, settings = publicSettings()): MockApi {
  const tasks = seed.tasks ?? [];
  return mockApi({
    settings: { get: vi.fn(() => Promise.resolve(settings)) },
    planner: {
      week: vi.fn((day: string) => {
        const from = weekStartOf(day);
        const to = addDays(from, 6);
        return Promise.resolve({
          from,
          to,
          tasks: tasks.filter((t) => t.day !== null && t.day >= from && t.day <= to),
          deadlines: seed.deadlines ?? [],
          studiedMs: seed.studiedMs ?? {},
        });
      }),
      day: vi.fn((day: string) =>
        Promise.resolve({
          from: day,
          to: day,
          tasks: tasks.filter((t) => t.day === day),
          deadlines: [],
          studiedMs: {},
        }),
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

/** The board on its own, as the overlay renders it. */
async function renderBoard(seed: Seed = {}) {
  useStudyStore.setState({ settings: publicSettings(), subjects: seedSubjects() });
  const api = apiFor(seed);
  installMockApi(api);
  render(<TasksBoard />);
  await waitFor(() => expect(api.planner.lists).toHaveBeenCalled());
  return api;
}

beforeEach(() => {
  posedDrag = null;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetPlannerStore();
  resetStudyStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Tasks board overlay', () => {
  async function renderShell(settings: PublicSettings) {
    const api = apiFor(
      { tasks: [minimalPlannerTask({ id: 3, title: 'Read ch. 4', day: '2026-11-11' })] },
      settings,
    );
    installMockApi(api);
    const registry = testRegistry();
    registry.widgets.tasks = PlannerWidget;
    registry.overlays.tasks = TasksBoard;
    render(<Shell registry={registry} />);
    await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
    useStudyStore.setState({ subjects: seedSubjects() });
    return api;
  }

  it("opens full size from the widget's Expand, closes on Esc, and Stats keeps its size", async () => {
    await renderShell(publicSettings(true));
    const shell = screen.getByTestId('shell');
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(shell).toHaveAttribute('data-overlay', 'tasks');
    const dialog = screen.getByRole('dialog', { name: 'Tasks' });
    expect(dialog.className).toMatch(/dialogFull/);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shell).toHaveAttribute('data-overlay', 'none');

    act(() => useStudyStore.getState().setOverlay('stats'));
    expect(screen.getByRole('dialog', { name: 'Stats' }).className).not.toMatch(/dialogFull/);
  });

  it('keeps exactly one task detail, in the widget while it is open and in the board when it is not', async () => {
    await renderShell(publicSettings(true));
    act(() => useStudyStore.getState().setOverlay('tasks'));
    act(() => usePlannerStore.getState().openDetail(3));
    await waitFor(() => expect(screen.getAllByRole('dialog', { name: /^Task: / })).toHaveLength(1));

    act(() => usePlannerStore.getState().closeDetail());
    act(() => {
      const s = useStudyStore.getState().settings!;
      useStudyStore.setState({
        settings: { ...s, widgets: { ...s.widgets, tasks: { ...s.widgets.tasks, open: false } } },
      });
    });
    expect(screen.queryByTestId('tasks-widget')).not.toBeInTheDocument();
    act(() => usePlannerStore.getState().openDetail(3));
    await waitFor(() => expect(screen.getAllByRole('dialog', { name: /^Task: / })).toHaveLength(1));
  });
});

describe('TasksBoard header', () => {
  it('shows "November 2026 W46", moves a week with ‹ ›, and Today comes back', async () => {
    const api = await renderBoard();
    expect(screen.getByRole('heading', { name: 'November 2026 W46' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Board view' })).getByRole('button', { name: 'Week' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('heading', { name: 'November 2026 W47' })).toBeInTheDocument();
    expect(api.planner.week).toHaveBeenLastCalledWith('2026-11-16');

    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { name: 'November 2026 W45' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'November 2026 W46' })).toBeInTheDocument();
  });

  it('"+ New task" adds to today and opens its detail', async () => {
    const api = await renderBoard();
    vi.mocked(api.tasks.create).mockResolvedValue({
      tasks: [minimalPlannerTask({ id: 77, title: 'Plan essay', day: '2026-11-11' })],
      removed: [],
    });
    await userEvent.click(screen.getByRole('button', { name: '+ New task' }));
    const input = screen.getByRole('textbox', { name: 'New task for today' });
    expect(input).toHaveFocus();
    await userEvent.type(input, 'Plan essay{Enter}');
    expect(api.tasks.create).toHaveBeenCalledWith({ title: 'Plan essay', day: '2026-11-11' });
    await waitFor(() => expect(usePlannerStore.getState().detailTaskId).toBe(77));
  });
});

describe('TasksBoard week', () => {
  it('has six columns, Sat and Sun stacked in the sixth', async () => {
    await renderBoard();
    const columns = document.querySelectorAll('[data-board-column]');
    expect(columns).toHaveLength(6);
    const labels = [...columns].map((c) =>
      [...c.querySelectorAll('section')].map((s) => s.getAttribute('aria-label')),
    );
    expect(labels).toEqual([
      ['Mon 9 Nov'],
      ['Tue 10 Nov'],
      ['Wed 11 Nov'],
      ['Thu 12 Nov'],
      ['Fri 13 Nov'],
      ['Sat 14 Nov', 'Sun 15 Nov'],
    ]);
  });

  it('heads each day with planned and studied time, puts deadlines under it, and the quick-add on the first empty row', async () => {
    await renderBoard({
      tasks: [
        minimalPlannerTask({ id: 1, title: 'Lab 3', day: MON, estimateMin: 60 }),
        minimalPlannerTask({ id: 2, title: 'Quiz', day: MON, estimateMin: 30, done: true }),
      ],
      studiedMs: { [MON]: 45 * MIN },
      deadlines: [deadline()],
    });
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    await within(mon).findByText('1h 30m planned · 45m studied');
    expect(
      within(screen.getByRole('region', { name: 'Wed 11 Nov' })).getByText('0m planned · 0m studied'),
    ).toBeInTheDocument();

    const tue = screen.getByRole('region', { name: 'Tue 10 Nov' });
    const chip = within(tue).getByText('Networks CW');
    expect(tue.querySelector('header')).toContainElement(chip);
    expect(within(mon).queryByText('Networks CW')).not.toBeInTheDocument();

    // Two tasks, then the add row, then blank rules up to ten.
    const add = within(mon).getByRole('textbox', { name: 'Add to Mon 9 Nov' });
    const addRule = add.closest('[data-rule="add"]');
    expect(addRule?.previousElementSibling?.tagName).toBe('UL');
    expect(within(mon).getAllByRole('listitem')).toHaveLength(2);
    const ruled = addRule?.parentElement;
    expect(ruled?.children).toHaveLength(1 + 1 + 7);
  });

  it('a deadline whose due time is before the rollover hour sits on the previous study day', async () => {
    await renderBoard({ deadlines: [deadline({ due: '2026-11-11T02:00', title: 'Late CW' })] });
    const tue = screen.getByRole('region', { name: 'Tue 10 Nov' });
    expect(await within(tue).findByText('Late CW')).toBeInTheDocument();
  });

  it('dropping a list task on a day moves it to the top of that day; a drop on nothing moves nothing', async () => {
    const api = await renderBoard({
      lists: [list()],
      tasks: [minimalPlannerTask({ id: 5, title: 'Lambda notes', day: null, listId: 10 })],
    });
    await screen.findByText('Lambda notes');
    act(() => dragEnd?.({ active: { id: 'task:5' }, over: null } as unknown as DragEndEvent));
    expect(api.tasks.move).not.toHaveBeenCalled();
    act(() =>
      dragEnd?.({ active: { id: 'task:5' }, over: { id: 'day:2026-11-12' } } as unknown as DragEndEvent),
    );
    expect(api.tasks.move).toHaveBeenCalledWith(5, { day: '2026-11-12', index: 0 });
  });
});

describe('TasksBoard lists', () => {
  const twoTasks = [
    minimalPlannerTask({ id: 5, title: 'Lambda notes', day: null, listId: 10 }),
    minimalPlannerTask({ id: 6, title: 'Monads', day: null, listId: 10, done: true }),
  ];

  it('lays the lists in one row, each with its subject, tasks and quick-add', async () => {
    await renderBoard({
      lists: [list(), list({ id: 11, name: 'Someday', subjectId: null })],
      tasks: twoTasks,
    });
    const card = await screen.findByRole('region', { name: 'COMP2221 Programming Paradigms' });
    expect(card.closest('[data-list-row]')).toHaveAttribute('data-layout', 'row');
    // Named apart from its subject (id 2), so the subject chip shows.
    expect(within(card).getByText(seedSubjects()[1]!.name)).toBeInTheDocument();
    expect(within(card).getByText('Lambda notes')).toBeInTheDocument();
    expect(
      within(card).getByRole('textbox', { name: 'Add to COMP2221 Programming Paradigms' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Someday' })).toBeInTheDocument();
  });

  it('renames a list in place', async () => {
    const api = await renderBoard({ lists: [list()] });
    const name = await screen.findByRole('textbox', { name: 'List name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Paradigms{Enter}');
    expect(api.lists.update).toHaveBeenCalledWith(10, { name: 'Paradigms' });
  });

  it('Esc in the name puts it back and saves nothing', async () => {
    const api = await renderBoard({ lists: [list()] });
    const name = await screen.findByRole('textbox', { name: 'List name' });
    await userEvent.type(name, ' x{Escape}');
    await waitFor(() => expect(name).toHaveValue('COMP2221 Programming Paradigms'));
    expect(api.lists.update).not.toHaveBeenCalled();
  });

  it("the menu's Delete asks with the task count, then removes the list", async () => {
    const api = await renderBoard({ lists: [list()], tasks: twoTasks });
    await screen.findByText('Lambda notes');
    await userEvent.click(screen.getByRole('button', { name: 'COMP2221 Programming Paradigms menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete COMP2221 Programming Paradigms and its 2 tasks?')).toBeInTheDocument();
    expect(api.lists.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.lists.remove).toHaveBeenCalledWith(10);
  });

  it('Clear done and Link subject → None', async () => {
    const api = await renderBoard({ lists: [list()] });
    const menu = await screen.findByRole('button', { name: 'COMP2221 Programming Paradigms menu' });
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('button', { name: 'Clear done' }));
    expect(api.lists.clearDone).toHaveBeenCalledWith(10);

    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('button', { name: 'Link subject' }));
    expect(screen.getByRole('button', { name: seedSubjects()[1]!.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(api.lists.update).toHaveBeenCalledWith(10, { subjectId: null });
  });

  it('"+ New list" is disabled at 20 lists with "Up to 20 lists"', async () => {
    const lists = Array.from({ length: 20 }, (_, i) =>
      list({ id: 100 + i, name: `List ${i + 1}`, subjectId: null }),
    );
    const api = await renderBoard({ lists });
    await screen.findByRole('region', { name: 'List 20' });
    const add = screen.getByRole('button', { name: '+ New list' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAttribute('title', 'Up to 20 lists');
    expect(add).toHaveAccessibleDescription('Up to 20 lists');
    await userEvent.click(add);
    expect(api.lists.create).not.toHaveBeenCalled();
  });

  it('"+ New list" adds one and puts its name up for editing', async () => {
    const api = await renderBoard({ lists: [list()] });
    vi.mocked(api.lists.create).mockResolvedValue([
      list(),
      list({ id: 12, name: 'New list', subjectId: null }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: '+ New list' }));
    expect(api.lists.create).toHaveBeenCalledWith({ name: 'New list' });
    const fresh = await screen.findByRole('region', { name: 'New list' });
    await waitFor(() => expect(within(fresh).getByRole('textbox', { name: 'List name' })).toHaveFocus());
  });

  it('a list whose subject has an exam 23 days out says so', async () => {
    await renderBoard({
      lists: [list()],
      deadlines: [deadline({ id: 4, kind: 'exam', title: 'Paradigms exam', due: '2026-12-04T09:00' })],
    });
    const card = await screen.findByRole('region', { name: 'COMP2221 Programming Paradigms' });
    expect(await within(card).findByText('Exam in 23 days')).toBeInTheDocument();
  });
});

describe('TasksBoard deadlines', () => {
  it('a deleted or completed deadline leaves its chip and the exam line after a reload', async () => {
    const seed: Seed = {
      lists: [list()],
      deadlines: [
        deadline({ id: 1, title: 'Networks CW', due: '2026-11-10T12:00' }),
        deadline({ id: 4, kind: 'exam', title: 'Paradigms exam', due: '2026-12-04T09:00' }),
      ],
    };
    await renderBoard(seed);
    const card = await screen.findByRole('region', { name: 'COMP2221 Programming Paradigms' });
    expect(await screen.findByText(/Networks CW/)).toBeInTheDocument();
    expect(await within(card).findByText('Exam in 23 days')).toBeInTheDocument();
    // Main no longer reports either: one was deleted, the other ticked done.
    seed.deadlines = [];
    await act(() => usePlannerStore.getState().reload());
    await waitFor(() => expect(screen.queryByText(/Networks CW/)).not.toBeInTheDocument());
    expect(within(card).queryByText('Exam in 23 days')).not.toBeInTheDocument();
  });
});

describe('TasksBoard drag feel', () => {
  const seed = {
    lists: [list()],
    tasks: [
      minimalPlannerTask({ id: 5, title: 'Lambda notes', day: null, listId: 10 }),
      minimalPlannerTask({ id: 1, title: 'Lab 3', day: MON }),
      minimalPlannerTask({ id: 2, title: 'Quiz', day: MON, sort: 1 }),
    ],
  };
  const insertLines = (el: HTMLElement) => el.querySelectorAll('li[aria-hidden="true"]');

  it('a task from a list over a day row shows the insertion line before that row, and only there', async () => {
    posedDrag = { active: { id: 'task:5' }, over: { id: 'task:2' } };
    await renderBoard(seed);
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    await within(mon).findByText('Quiz');
    const lines = insertLines(mon);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.nextElementSibling).toHaveAttribute('data-task-id', '2');
    expect(insertLines(screen.getByRole('region', { name: 'COMP2221 Programming Paradigms' }))).toHaveLength(
      0,
    );
  });

  it('over the day itself the line goes after its last open task', async () => {
    posedDrag = { active: { id: 'task:5' }, over: { id: `day:${MON}` } };
    await renderBoard(seed);
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    await within(mon).findByText('Quiz');
    const lines = insertLines(mon);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.previousElementSibling).toHaveAttribute('data-task-id', '2');
  });
});

describe('TasksBoard, the Tweek look', () => {
  const busy = minimalPlannerTask({
    id: 7,
    title: 'Revise lecture 7: informed search and A*',
    day: MON,
    subjectId: 2,
    effectiveSubjectId: 2,
    estimateMin: 45,
    actualMs: 50 * MIN,
    tags: ['ai', 'revision'],
    subtasks: [{ id: 1, taskId: 7, text: 'Read', done: true, sort: 0 }],
    repeat: { kind: 'weekly' },
    reminder: '18:30',
    rolledFrom: '2026-11-08',
  });

  it('a week row is compact: the subject dot, the title and the estimate chip only, amber when over', async () => {
    await renderBoard({
      tasks: [busy, minimalPlannerTask({ id: 8, title: 'No estimate', day: MON, sort: 1 })],
    });
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    const row = (await within(mon).findByText(busy.title)).closest('li') as HTMLElement;
    expect(row).toHaveAttribute('data-variant', 'compact');
    expect(within(row).getByRole('button', { name: busy.title })).toBeInTheDocument();
    expect(row.querySelector('[data-subject-dot]')).not.toBeNull();
    expect(within(row).getByText('50m / 45m')).toHaveAttribute('data-over', 'true');
    for (const gone of ['#ai', '#revision', '1/1', '↻', 'from Sun 8 Nov']) {
      expect(within(row).queryByText(gone)).not.toBeInTheDocument();
    }
    expect(within(row).queryByLabelText('Reminder 18:30')).not.toBeInTheDocument();
    // No estimate, no chip.
    const plain = within(mon).getByText('No estimate').closest('li') as HTMLElement;
    expect(within(plain).queryByText(/ \/ /)).not.toBeInTheDocument();
    // Still a checkbox, ▶ and a grip.
    expect(within(row).getByRole('checkbox', { name: `Mark "${busy.title}" as done` })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: `Move "${busy.title}"` })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: `Start focus on "${busy.title}"` })).toBeInTheDocument();
  });

  it('a compact row marks title focus so the hover tools hide under its ring', async () => {
    await renderBoard({ tasks: [busy] });
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    const row = (await within(mon).findByText(busy.title)).closest('li') as HTMLElement;
    expect(row).not.toHaveAttribute('data-title-focus');
    const title = within(row).getByRole('button', { name: busy.title });
    const play = within(row).getByRole('button', { name: `Start focus on "${busy.title}"` });
    act(() => title.focus());
    expect(row).toHaveAttribute('data-title-focus', 'true');
    act(() => play.focus());
    expect(row).not.toHaveAttribute('data-title-focus');
  });

  it('a compact title focused by the mouse keeps the hover tools working', async () => {
    await renderBoard({ tasks: [busy] });
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    const row = (await within(mon).findByText(busy.title)).closest('li') as HTMLElement;
    const title = within(row).getByRole('button', { name: busy.title });
    // A click, or focus handed back after one, is not :focus-visible in Chromium.
    const matches = Element.prototype.matches;
    const spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
      return sel === ':focus-visible' ? false : matches.call(this, sel);
    });
    try {
      act(() => title.focus());
      expect(title).toHaveFocus();
      expect(row).not.toHaveAttribute('data-title-focus');
    } finally {
      spy.mockRestore();
    }
  });

  it('Enter or Space on a compact title opens its detail', async () => {
    await renderBoard({ tasks: [busy] });
    const title = await screen.findByRole('button', { name: busy.title });
    expect(title).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(usePlannerStore.getState().detailTaskId).toBe(7);
    act(() => usePlannerStore.setState({ detailTaskId: null }));
    fireEvent.keyDown(title, { key: ' ' });
    expect(usePlannerStore.getState().detailTaskId).toBe(7);
  });

  it('the widget keeps its full rows: tags, subtasks, repeat, reminder', async () => {
    const api = apiFor({ tasks: [{ ...busy, day: '2026-11-11' }] });
    useStudyStore.setState({ settings: publicSettings(true), subjects: seedSubjects() });
    installMockApi(api);
    render(<PlannerWidget />);
    const row = (await screen.findByText(busy.title)).closest('li') as HTMLElement;
    expect(row).not.toHaveAttribute('data-variant', 'compact');
    expect(within(row).getByText('#ai')).toBeInTheDocument();
    expect(within(row).getByText('1/1')).toBeInTheDocument();
    expect(within(row).getByLabelText('Repeats')).toBeInTheDocument();
    expect(within(row).getByLabelText('Reminder 18:30')).toBeInTheDocument();
  });

  it('a column quick-add says just "Add…" and keeps its "Add to <day or list>" name', async () => {
    await renderBoard({ lists: [list()] });
    const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
    expect(within(mon).getByRole('textbox', { name: 'Add to Mon 9 Nov' })).toHaveAttribute(
      'placeholder',
      'Add…',
    );
    const card = await screen.findByRole('region', { name: 'COMP2221 Programming Paradigms' });
    expect(
      within(card).getByRole('textbox', { name: 'Add to COMP2221 Programming Paradigms' }),
    ).toHaveAttribute('placeholder', 'Add…');
  });

  it('the lists sit in one row under the week, in sort order, with "+ New list" at its end', async () => {
    await renderBoard({
      lists: [
        list({ id: 1, name: 'Inbox', subjectId: null, sort: 0 }),
        list({ sort: 1 }),
        list({ id: 11, name: 'Someday', subjectId: null, sort: 2 }),
      ],
    });
    const lists = await screen.findByRole('region', { name: 'Lists' });
    await within(lists).findByRole('region', { name: 'Someday' });
    const row = lists.querySelector('[data-list-row]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-layout', 'row');
    const names = within(row)
      .getAllByRole('textbox', { name: 'List name' })
      .map((i) => (i as HTMLInputElement).value);
    expect(names).toEqual(['Inbox', 'COMP2221 Programming Paradigms', 'Someday']);
    const add = within(row).getByRole('button', { name: '+ New list' });
    expect(row.lastElementChild).toContainElement(add);
    // The week comes first; the lists follow it.
    const week = screen.getByRole('group', { name: 'Week' });
    expect(week.compareDocumentPosition(lists) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a list named after its subject shows a dot, not the subject chip again; a different name keeps the chip', async () => {
    const subjects = seedSubjects();
    await renderBoard({
      lists: [list({ name: subjects[1]!.name }), list({ id: 11, name: 'Reading', subjectId: 3 })],
    });
    const same = await screen.findByRole('region', { name: subjects[1]!.name });
    expect(same.querySelector('[data-subject-dot]')).not.toBeNull();
    expect(within(same).queryByText(subjects[1]!.name)).not.toBeInTheDocument();
    const other = screen.getByRole('region', { name: 'Reading' });
    expect(within(other).getByText(subjects[2]!.name)).toBeInTheDocument();
  });
});
