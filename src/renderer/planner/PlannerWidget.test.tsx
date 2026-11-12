import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../core/time';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Deadline, PlannerTask } from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { plannerToday } from './format';
import { PlannerWidget } from './PlannerWidget';
import { resetPlannerStore, usePlannerStore } from './plannerStore';
import { usePlannerEvents } from './usePlannerEvents';

const MIN = 60_000;
const today = () => plannerToday(DEFAULT_SETTINGS.rolloverHour);

function Harness() {
  usePlannerEvents();
  return <PlannerWidget />;
}

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
  id: 1,
  title: 'Networks',
  kind: 'exam',
  subjectId: 2,
  due: '2030-01-01T09:00',
  note: '',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function setup(opts: { tasks?: PlannerTask[]; deadlines?: Deadline[]; lists?: boolean } = {}) {
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub, subjects: seedSubjects() });
  const tasks = opts.tasks ?? [];
  const api: MockApi = mockApi({
    planner: {
      day: vi.fn((day: string) =>
        Promise.resolve({
          from: day,
          to: day,
          tasks: tasks.filter((t) => t.day === day),
          deadlines: day === today() ? (opts.deadlines ?? []) : [],
          studiedMs: {},
        }),
      ),
      lists: vi.fn(() =>
        Promise.resolve({
          lists: [
            { id: 10, name: 'Networks', subjectId: 2, sort: 0, createdAt: 0 },
            { id: 11, name: 'Someday', subjectId: null, sort: 1, createdAt: 0 },
          ],
          tasks: tasks.filter((t) => t.listId !== null),
          deadlines: opts.deadlines ?? [],
        }),
      ),
    },
    tasks: {
      create: vi.fn(() =>
        Promise.resolve({ tasks: [minimalPlannerTask({ id: 99, title: 'made' })], removed: [] }),
      ),
      update: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
    },
  });
  installMockApi(api);
  return api;
}

beforeEach(() => {
  resetPlannerStore();
  resetStudyStore();
});

describe('PlannerWidget', () => {
  it('has Day and Lists tabs', async () => {
    setup();
    render(<PlannerWidget />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Day', 'Lists']);
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it("Day shows today's tasks open then done, with their chips, and deadlines on top", async () => {
    const day = today();
    setup({
      tasks: [
        minimalPlannerTask({ id: 1, title: 'Done one', day, done: true, sort: 0 }),
        minimalPlannerTask({
          id: 2,
          title: 'Write up',
          day,
          sort: 1,
          estimateMin: 45,
          actualMs: 50 * MIN,
          tags: ['lecture'],
          effectiveSubjectId: 3,
          repeat: { kind: 'daily' },
          reminder: '09:30',
          rolledFrom: '2026-11-10',
          subtasks: [
            { id: 1, taskId: 2, text: 'a', done: true, sort: 0 },
            { id: 2, taskId: 2, text: 'b', done: false, sort: 1 },
          ],
        }),
      ],
      deadlines: [deadline()],
    });
    render(<PlannerWidget />);
    expect(await screen.findByText('Write up')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-task-id'))).toEqual(['2', '1']);
    const row = rows[0] as HTMLElement;
    expect(within(row).getByText('50m / 45m')).toHaveAttribute('data-over', 'true');
    expect(within(row).getByText('1/2')).toBeInTheDocument();
    expect(within(row).getByText('#lecture')).toBeInTheDocument();
    expect(within(row).getByLabelText('Repeats')).toBeInTheDocument();
    expect(within(row).getByLabelText('Reminder 09:30')).toBeInTheDocument();
    expect(within(row).getByText('from Tue 10 Nov')).toBeInTheDocument();
    expect(within(row).getByTitle(seedSubjects()[2]?.name ?? '')).toBeInTheDocument();
    expect(within(row).getByRole('checkbox', { name: 'Mark "Write up" as done' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark "Done one" as not done' })).toBeChecked();
    expect(screen.getByText('Exam')).toBeInTheDocument();
    expect(screen.getByText(/Networks/)).toBeInTheDocument();
  });

  it('a task under its estimate is not amber', async () => {
    setup({
      tasks: [minimalPlannerTask({ id: 1, title: 'A', day: today(), estimateMin: 45, actualMs: 32 * MIN })],
    });
    render(<PlannerWidget />);
    expect(await screen.findByText('32m / 45m')).not.toHaveAttribute('data-over');
  });

  it('‹ › move a day and Today comes back', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<PlannerWidget />);
    await screen.findByText(/Today ·/);
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    await waitFor(() => expect(api.planner.day).toHaveBeenCalledWith(addDays(today(), 1)));
    expect(screen.queryByText(/Today ·/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(api.planner.day).toHaveBeenCalledWith(addDays(today(), -1)));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText(/Today ·/)).toBeInTheDocument();
  });

  it('quick add parses #tag ~estimate @subject into tasks.create', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<PlannerWidget />);
    await user.type(
      screen.getByRole('textbox', { name: 'Add a task' }),
      'Lecture 5 notes #lecture ~1h @2221{Enter}',
    );
    await waitFor(() =>
      expect(api.tasks.create).toHaveBeenCalledWith({
        title: 'Lecture 5 notes',
        tags: ['lecture'],
        estimateMin: 60,
        subjectId: 3,
        day: today(),
      }),
    );
  });

  it('▶ starts the timer on the task', async () => {
    const user = userEvent.setup();
    const api = setup({ tasks: [minimalPlannerTask({ id: 7, title: 'Read', day: today() })] });
    render(<PlannerWidget />);
    await user.click(await screen.findByRole('button', { name: 'Start focus on "Read"' }));
    expect(api.timer.startTask).toHaveBeenCalledWith(7);
  });

  it('ticking sends done to tasks.update', async () => {
    const user = userEvent.setup();
    const api = setup({ tasks: [minimalPlannerTask({ id: 7, title: 'Read', day: today() })] });
    render(<PlannerWidget />);
    await user.click(await screen.findByRole('checkbox', { name: 'Mark "Read" as done' }));
    expect(api.tasks.update).toHaveBeenCalledWith(7, { done: true });
  });

  it('clicking a row opens its detail', async () => {
    const user = userEvent.setup();
    setup({ tasks: [minimalPlannerTask({ id: 7, title: 'Read', day: today() })] });
    render(<PlannerWidget />);
    await user.click(await screen.findByRole('button', { name: 'Read' }));
    expect(usePlannerStore.getState().detailTaskId).toBe(7);
  });

  it('Lists shows a picker, the list tasks and the exam line', async () => {
    const user = userEvent.setup();
    const exam = deadline({ due: `${addDays(today(), 23)}T12:00` });
    setup({
      tasks: [minimalPlannerTask({ id: 5, title: 'Past papers', day: null, listId: 10 })],
      deadlines: [exam],
    });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Lists' }));
    expect(await screen.findByRole('combobox', { name: 'List' })).toBeInTheDocument();
    expect(await screen.findByText('Past papers')).toBeInTheDocument();
    expect(screen.getByText('Exam in 23 days')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'List' }), 'Someday');
    expect(screen.queryByText('Past papers')).not.toBeInTheDocument();
    expect(screen.queryByText(/Exam in/)).not.toBeInTheDocument();
  });

  it('a list quick add places the task in the list', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Lists' }));
    await user.type(await screen.findByRole('textbox', { name: 'Add a task' }), 'Flashcards{Enter}');
    await waitFor(() => expect(api.tasks.create).toHaveBeenCalledWith({ title: 'Flashcards', listId: 10 }));
  });

  it('a reminder click opens the widget and the task detail; main changes reload', async () => {
    const api = setup();
    useStudyStore.setState((s) =>
      s.settings
        ? {
            settings: {
              ...s.settings,
              widgets: { ...s.settings.widgets, tasks: { ...s.settings.widgets.tasks, open: false } },
            },
          }
        : s,
    );
    render(<Harness />);
    await waitFor(() => expect(api.planner.day).toHaveBeenCalledTimes(1));
    act(() => api.emitOpenTask(42));
    expect(usePlannerStore.getState().detailTaskId).toBe(42);
    await waitFor(() => expect(useStudyStore.getState().settings?.widgets.tasks.open).toBe(true));
    const calls = vi.mocked(api.planner.day).mock.calls.length;
    act(() => api.emitPlannerChanged());
    await waitFor(() => expect(vi.mocked(api.planner.day).mock.calls.length).toBeGreaterThan(calls));
  });
});
