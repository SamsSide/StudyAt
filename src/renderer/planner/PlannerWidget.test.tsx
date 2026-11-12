import type * as DndKit from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, weekStartOf } from '../../core/time';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Deadline, PlannerTask } from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import {
  idleTimerState,
  installMockApi,
  minimalPlannerTask,
  mockApi,
  seedSubjects,
  type MockApi,
} from '../test/mockApi';
import { plannerToday } from './format';
import { PlannerWidget } from './PlannerWidget';
import { resetPlannerStore, usePlannerStore } from './plannerStore';
import { usePlannerEvents } from './usePlannerEvents';

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
      week: vi.fn((day: string) =>
        Promise.resolve({
          from: weekStartOf(day),
          to: addDays(weekStartOf(day), 6),
          tasks: tasks.filter(
            (t) => t.day !== null && t.day >= weekStartOf(day) && t.day <= addDays(weekStartOf(day), 6),
          ),
          deadlines: [],
          studiedMs: {},
        }),
      ),
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
      move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
    },
  });
  installMockApi(api);
  return api;
}

// Midday on a fixed date, so "today" never depends on when the suite runs. Only Date is faked:
// Testing Library's waitFor needs the real timers.
const NOON = new Date(2026, 10, 11, 12, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetPlannerStore();
  resetStudyStore();
});

// jsdom has no scrollIntoView; a test that stubs it gets the original (absent) back after it.
const scrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe('PlannerWidget', () => {
  it('has Day, Week and Lists tabs', async () => {
    setup();
    render(<PlannerWidget />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Day', 'Week', 'Lists']);
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status', { name: 'Task notice' })).toBeInTheDocument();
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

  it("Day's deadline chips say how long is left, without seconds", async () => {
    setup({
      deadlines: [
        deadline({ id: 1, title: 'Problem sheet 6', kind: 'coursework', due: '2026-11-11T12:42' }),
        deadline({ id: 2, title: 'Lab report', kind: 'coursework', due: '2026-11-11T23:30' }),
      ],
    });
    render(<PlannerWidget />);
    expect(await screen.findByText('· 42m')).toBeInTheDocument();
    expect(screen.getByText('· 11h 30m')).toBeInTheDocument();
  });

  it('a double Enter makes one task', async () => {
    const api = setup();
    let finish: (() => void) | undefined;
    vi.mocked(api.tasks.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ tasks: [minimalPlannerTask({ id: 99, title: 'made' })], removed: [] });
        }),
    );
    render(<PlannerWidget />);
    const box = screen.getByRole('textbox', { name: 'Add a task' });
    fireEvent.change(box, { target: { value: 'Once' } });
    fireEvent.submit(box);
    fireEvent.submit(box);
    await waitFor(() => expect(api.tasks.create).toHaveBeenCalledTimes(1));
    await act(async () => finish?.());
    await waitFor(() => expect(box).toHaveValue(''));
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
  });

  it('Week shows Mon-Sun sections with open counts, which collapse', async () => {
    const user = userEvent.setup();
    setup({
      tasks: [
        minimalPlannerTask({ id: 1, title: 'One', day: '2026-11-09', sort: 0 }),
        minimalPlannerTask({ id: 2, title: 'Two', day: '2026-11-09', sort: 1 }),
        minimalPlannerTask({ id: 3, title: 'Done', day: '2026-11-09', sort: 2, done: true }),
      ],
    });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    const heads = await screen.findAllByRole('button', { name: /open$/ });
    expect(heads.map((h) => h.textContent?.replace('›', ''))).toEqual([
      'Mon 9 Nov · 2 open',
      'Tue 10 Nov · 0 open',
      'Wed 11 Nov · 0 open',
      'Thu 12 Nov · 0 open',
      'Fri 13 Nov · 0 open',
      'Sat 14 Nov · 0 open',
      'Sun 15 Nov · 0 open',
    ]);
    const mon = heads[0] as HTMLElement;
    expect(mon).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('One')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add to Mon 9 Nov' })).toBeInTheDocument();
    await user.click(mon);
    expect(mon).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add to Mon 9 Nov' })).not.toBeInTheDocument();
  });

  it("Week opens with today expanded, scrolled to the top of the week's own scroller only", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    // The scroller's top at 100, today's section at 340: today sits 240 px down its content.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.matches('section[data-today]') ? 340 : 100;
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
    const set = vi.fn();
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      set(this, v);
    });
    setup({ tasks: [] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    const head = (await screen.findAllByRole('button', { name: /open$/ })).find((h) =>
      h.closest('section')?.hasAttribute('data-today'),
    );
    expect(head).toHaveAttribute('aria-expanded', 'true');
    const today = head?.closest('section');
    const scroller = today?.closest('[class*="weekDays"]');
    expect(set).toHaveBeenCalledWith(scroller, 240);
    // Never scrollIntoView, which would scroll the board page and the window around it too.
    expect(scroll).not.toHaveBeenCalled();
  });

  it('Week pads after Sunday so the content after today fills the scroller, and scrolls to the exact offset', async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.matches('section[data-today]') ? 340 : this.matches('[class*="weekSpacer"]') ? 700 : 100;
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
    // The scroller shows 380 px; today's top is at 340 and the spacer's at 700, so only 360 px of
    // content follows today: 20 px short.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(380);
    const set = vi.fn();
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      set(this, v);
    });
    setup({ tasks: [] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    const today = (await screen.findAllByRole('button', { name: /open$/ }))
      .find((h) => h.closest('section')?.hasAttribute('data-today'))
      ?.closest('section');
    const scroller = today?.closest('[class*="weekDays"]');
    const pad = scroller?.querySelector<HTMLElement>('[class*="weekSpacer"]');
    expect(pad?.style.height).toBe('20px');
    expect(set).toHaveBeenCalledWith(scroller, 240);
  });

  it("Week scrolls to today again once the week's tasks arrive and push it down", async () => {
    const user = userEvent.setup();
    // Today's section sits 240 px down the scroller, 300 px once Monday's task row is drawn.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const pushed = document.body.textContent?.includes('Early') ? 60 : 0;
      const top = this.matches('section[data-today]') ? 340 + pushed : 100;
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
    const set = vi.fn();
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      set(this, v);
    });
    setup({ tasks: [minimalPlannerTask({ id: 1, title: 'Early', day: '2026-11-09' })] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await screen.findByText('Early');
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.anything(), 300));
  });

  // A ResizeObserver stand-in: every live observer's callback, so a test can report a size change.
  function fakeResizeObserver(): { fire: () => void } {
    const live = new Set<(entries: ResizeObserverEntry[]) => void>();
    class Fake {
      constructor(private readonly cb: (entries: ResizeObserverEntry[]) => void) {
        live.add(cb);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        live.delete(this.cb);
      }
    }
    vi.stubGlobal('ResizeObserver', Fake);
    return { fire: () => act(() => live.forEach((cb) => cb([]))) };
  }

  // Today's section 240 px down the scroller, plus `pushed.by` once the days above it have grown.
  function todayAt(pushed: { by: number }): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.matches('section[data-today]') ? 340 + pushed.by : 100;
      return { top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) };
    });
  }

  it('Week scrolls to today again when the content grows late, after the load has settled', async () => {
    const user = userEvent.setup();
    const observer = fakeResizeObserver();
    const pushed = { by: 0 };
    todayAt(pushed);
    const set = vi.fn();
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      set(this, v);
    });
    setup({ tasks: [] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.anything(), 240));
    pushed.by = 46;
    observer.fire();
    expect(set).toHaveBeenLastCalledWith(expect.anything(), 286);
  });

  it('Week stops following today once the user scrolls by hand', async () => {
    const user = userEvent.setup();
    const observer = fakeResizeObserver();
    const pushed = { by: 0 };
    todayAt(pushed);
    const set = vi.fn();
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      set(this, v);
    });
    setup({ tasks: [] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(expect.anything(), 240));
    const scroller = document.querySelector('[class*="weekDays"]') as HTMLElement;
    fireEvent.wheel(scroller, { deltaY: 120 });
    set.mockClear();
    pushed.by = 46;
    observer.fire();
    expect(set).not.toHaveBeenCalled();
  });

  it('Week resets the spacer to nothing on a week without today', async () => {
    const user = userEvent.setup();
    todayAt({ by: 0 });
    // Every spacer top reads 100, above today's 340, so this week's spacer is padded.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(380);
    setup({ tasks: [] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await screen.findAllByRole('button', { name: /open$/ });
    const pad = document.querySelector<HTMLElement>('[class*="weekSpacer"]') as HTMLElement;
    await waitFor(() => expect(pad.style.height).toBe('620px'));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(pad.style.height).toBe('0px'));
  });

  it('a Week quick add places the task on that day', async () => {
    const user = userEvent.setup();
    const api = setup();
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await user.type(await screen.findByRole('textbox', { name: 'Add to Tue 10 Nov' }), 'Read{Enter}');
    await waitFor(() =>
      expect(api.tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Read', day: '2026-11-10' }),
      ),
    );
  });

  it('dropping a task on another day calls tasks.move; dropping outside moves nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ tasks: [minimalPlannerTask({ id: 1, title: 'One', day: '2026-11-09' })] });
    render(<PlannerWidget />);
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await screen.findByText('One');
    expect(screen.getByRole('button', { name: 'Move "One"' })).toBeInTheDocument();
    act(() => dragEnd?.({ active: { id: 'task:1' }, over: { id: 'day:2026-11-12' } } as DragEndEvent));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { day: '2026-11-12', index: 0 }));
    act(() => dragEnd?.({ active: { id: 'task:1' }, over: null } as DragEndEvent));
    expect(api.tasks.move).toHaveBeenCalledTimes(1);
  });

  it('the filter hides other subjects and the button reads as pressed', async () => {
    const user = userEvent.setup();
    const day = today();
    setup({
      tasks: [
        minimalPlannerTask({ id: 1, title: 'Maths', day, effectiveSubjectId: 3, tags: ['lecture'] }),
        minimalPlannerTask({ id: 2, title: 'Chem', day, effectiveSubjectId: 2 }),
      ],
    });
    render(<PlannerWidget />);
    await screen.findByText('Chem');
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(screen.getByRole('option', { name: 'All subjects' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All tags' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), '3');
    expect(screen.queryByText('Chem')).not.toBeInTheDocument();
    expect(screen.getByText('Maths')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tag' }), 'lecture');
    expect(screen.queryByText('Chem')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
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

  it('a break-time start shows the next-focus copy in the status line', async () => {
    const user = userEvent.setup();
    const api = setup({ tasks: [minimalPlannerTask({ id: 7, title: 'Read', day: today() })] });
    vi.mocked(api.timer.startTask).mockResolvedValue({
      ...idleTimerState(),
      mode: 'short',
      status: 'paused',
    });
    render(<PlannerWidget />);
    await user.click(await screen.findByRole('button', { name: 'Start focus on "Read"' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Task notice' })).toHaveTextContent(
        'Task set for your next focus.',
      ),
    );
  });

  it('a failed quick add keeps what was typed', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = setup();
    vi.mocked(api.tasks.create).mockRejectedValue(new Error('no'));
    render(<PlannerWidget />);
    const box = screen.getByRole('textbox', { name: 'Add a task' });
    await user.type(box, 'Keep me{Enter}');
    await waitFor(() => expect(api.tasks.create).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(box).toHaveValue('Keep me');
  });

  it('left open past the rollover, the label, the loaded day and quick add move to the new day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 23, 50).getTime());
    const api = setup();
    render(<PlannerWidget />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/^Today · /)).toHaveTextContent('11');
    expect(api.planner.day).toHaveBeenLastCalledWith('2026-11-11');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    });
    expect(api.planner.day).toHaveBeenLastCalledWith('2026-11-12');
    expect(screen.getByText(/^Today · /)).toHaveTextContent('12');
    const box = screen.getByRole('textbox', { name: 'Add a task' });
    fireEvent.change(box, { target: { value: 'Fresh' } });
    fireEvent.submit(box);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.tasks.create).toHaveBeenCalledWith({ title: 'Fresh', day: '2026-11-12' });
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
