import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PlannerTask, TaskChange } from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { plannerToday } from './format';
import { PlannerWidget } from './PlannerWidget';
import { resetPlannerStore, usePlannerStore } from './plannerStore';

const NOON = new Date(2026, 10, 11, 12, 0).getTime();
// The fixed clock's study day: the tasks below are built at import, before the fake clock is set.
const today = () => plannerToday(DEFAULT_SETTINGS.rolloverHour, NOON);

const task = (over: Partial<PlannerTask>): PlannerTask => minimalPlannerTask({ day: today(), ...over });

function setup(tasks: PlannerTask[]): MockApi {
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub, subjects: seedSubjects() });
  const api = mockApi({
    planner: {
      day: vi.fn((day: string) =>
        Promise.resolve({
          from: day,
          to: day,
          tasks: tasks.filter((t) => t.day === day),
          deadlines: [],
          studiedMs: {},
        }),
      ),
    },
    tasks: {
      update: vi.fn((id: number, patch: { done?: boolean }) =>
        Promise.resolve({
          tasks: tasks.filter((t) => t.id === id).map((t) => ({ ...t, ...patch })),
          removed: [],
        }),
      ),
    },
  });
  installMockApi(api);
  return api;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  resetPlannerStore();
  resetStudyStore();
});

afterEach(() => {
  vi.useRealTimers();
});

const lecture = task({ id: 1, title: 'Lecture 3', tags: ['lecture'] });
const plain = task({ id: 2, title: 'Tidy notes' });

const days = ['1 day', '3 days', '7 days', '21 days'];

const tick = async (title: string) =>
  userEvent.click(await screen.findByLabelText(`Mark "${title}" as done`));

describe('the revision offer', () => {
  it('offers the days when a lecture task is ticked; Add sends the days still on', async () => {
    const api = setup([lecture]);
    render(<PlannerWidget />);
    await tick('Lecture 3');
    const bar = await screen.findByRole('group', { name: 'Schedule revision' });
    expect(within(bar).getByText('Schedule revision?')).toBeInTheDocument();
    for (const d of days) {
      expect(within(bar).getByRole('button', { name: d })).toHaveAttribute('aria-pressed', 'true');
    }
    expect(bar).toHaveTextContent('1 · 3 · 7 · 21 days');
    await userEvent.click(within(bar).getByRole('button', { name: '21 days' }));
    expect(within(bar).getByRole('button', { name: '21 days' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(bar).getByRole('button', { name: 'Add' }));
    expect(api.tasks.scheduleRevision).toHaveBeenCalledWith(1, [1, 3, 7]);
    await waitFor(() => expect(screen.queryByText('Schedule revision?')).toBeNull());
  });

  it('two quick clicks on Add make one call', async () => {
    const api = setup([lecture]);
    let release: () => void = () => {};
    vi.mocked(api.tasks.scheduleRevision).mockImplementation(
      () =>
        new Promise<TaskChange>((resolve) => {
          release = () => resolve({ tasks: [], removed: [] });
        }),
    );
    render(<PlannerWidget />);
    await tick('Lecture 3');
    const add = await screen.findByRole('button', { name: 'Add' });
    await userEvent.dblClick(add);
    expect(api.tasks.scheduleRevision).toHaveBeenCalledTimes(1);
    expect(add).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByText('Schedule revision?')).toBeNull());
  });

  it('disables Add with no day on', async () => {
    setup([lecture]);
    render(<PlannerWidget />);
    await tick('Lecture 3');
    for (const d of days) await userEvent.click(await screen.findByRole('button', { name: d }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('Not now hides the bar without a call', async () => {
    const api = setup([lecture]);
    render(<PlannerWidget />);
    await tick('Lecture 3');
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Schedule revision?')).toBeNull();
    expect(api.tasks.scheduleRevision).not.toHaveBeenCalled();
  });

  it('ticking another task replaces the offer', async () => {
    setup([lecture, plain]);
    render(<PlannerWidget />);
    await tick('Lecture 3');
    await screen.findByText('Schedule revision?');
    await tick('Tidy notes');
    await waitFor(() => expect(screen.queryByText('Schedule revision?')).toBeNull());
  });

  it('closing the view dismisses the offer', async () => {
    setup([lecture]);
    const { unmount } = render(<PlannerWidget />);
    await tick('Lecture 3');
    await screen.findByText('Schedule revision?');
    unmount();
    expect(usePlannerStore.getState().revisionOffer).toBeNull();
  });
});

describe('the task menu', () => {
  async function openMenu(t: PlannerTask): Promise<MockApi> {
    const api = setup([t]);
    usePlannerStore.setState({ tasks: { [t.id]: t } });
    usePlannerStore.getState().openDetail(t.id);
    render(<PlannerWidget />);
    await userEvent.click(await screen.findByRole('button', { name: 'Task menu' }));
    return api;
  }

  it('Schedule revision… opens the bar for an untagged task', async () => {
    await openMenu(plain);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule revision…' }));
    expect(await screen.findByText('Schedule revision?')).toBeInTheDocument();
    expect(usePlannerStore.getState().revisionOffer?.taskId).toBe(2);
  });

  it('has no Schedule revision… for a revision task', async () => {
    await openMenu(task({ id: 3, title: 'Revise: Lecture 3', kind: 'revision' }));
    expect(screen.getByRole('button', { name: 'Start focus' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule revision…' })).toBeNull();
  });

  it('Start focus starts the task on the timer', async () => {
    const api = await openMenu(plain);
    await userEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    expect(api.timer.startTask).toHaveBeenCalledWith(2);
  });

  it('Duplicate duplicates the task', async () => {
    const api = await openMenu(plain);
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(api.tasks.duplicate).toHaveBeenCalledWith(2);
  });

  it('Delete asks first and only the confirming Delete removes the task', async () => {
    const api = await openMenu(plain);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this task?')).toBeInTheDocument();
    expect(api.tasks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.tasks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.tasks.remove).toHaveBeenCalledWith(2);
  });

  it('is a disclosure, not an ARIA menu', async () => {
    await openMenu(plain);
    const trigger = screen.getByRole('button', { name: 'Task menu' });
    expect(trigger).not.toHaveAttribute('aria-haspopup');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('group', { name: 'Task actions' }).id);
  });

  it('closes on an outside pointer-down', async () => {
    await openMenu(plain);
    await userEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('group', { name: 'Task actions' })).toBeNull();
  });

  it('closes when focus leaves the menu', async () => {
    await openMenu(plain);
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('group', { name: 'Task actions' })).toBeNull();
  });

  it('Esc closes the menu but not the dialog', async () => {
    await openMenu(plain);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Task actions' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
