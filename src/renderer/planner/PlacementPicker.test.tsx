import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { plannerToday } from './format';
import { PlacementPicker } from './PlacementPicker';
import { resetPlannerStore, usePlannerStore } from './plannerStore';

function setup(): MockApi {
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub, subjects: seedSubjects() });
  const task = minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' });
  const api = mockApi({
    planner: {
      day: vi.fn((day: string) =>
        Promise.resolve({ from: day, to: day, tasks: [], deadlines: [], studiedMs: {} }),
      ),
      lists: vi.fn(() =>
        Promise.resolve({
          lists: [{ id: 10, name: 'Someday', subjectId: null, sort: 0, createdAt: 0 }],
          tasks: [],
          deadlines: [],
        }),
      ),
    },
  });
  installMockApi(api);
  usePlannerStore.setState({ tasks: { [task.id]: task } });
  render(<PlacementPicker task={task} />);
  return api;
}

beforeEach(() => {
  // Frozen at 2026-11-11 noon, so the planner's "today" never follows the real clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0));
  resetPlannerStore();
  resetStudyStore();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const openAndType = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
  await user.click(screen.getByRole('button', { name: /^Placement/ }));
  const day = screen.getByLabelText('Day');
  day.focus();
  fireEvent.change(day, { target: { value } });
  return day;
};

describe('PlacementPicker date draft', () => {
  it('throws the draft away on Esc without moving', async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAndType(user, '2026-11-20');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Move task' })).not.toBeInTheDocument();
    expect(api.tasks.move).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    expect(screen.getByLabelText('Day')).toHaveValue('2026-11-11');
  });

  it('lets Today win over a pending date draft', async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAndType(user, '2026-11-20');
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledTimes(1));
    expect(api.tasks.move).toHaveBeenCalledWith(1, {
      day: plannerToday(DEFAULT_SETTINGS.rolloverHour),
      index: 0,
    });
  });

  it('lets a list win over a pending date draft', async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAndType(user, '2026-11-20');
    await user.click(await screen.findByRole('button', { name: 'Someday' }));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledTimes(1));
    expect(api.tasks.move).toHaveBeenCalledWith(1, { listId: 10, index: 0 });
  });

  it.each(['{Enter}', ' '])('moves to the typed date from the Move button with %j', async (key) => {
    const user = userEvent.setup();
    const api = setup();
    await openAndType(user, '2026-11-20');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Move' })).toHaveFocus();
    expect(api.tasks.move).not.toHaveBeenCalled();
    await user.keyboard(key);
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { day: '2026-11-20', index: 0 }));
  });

  it('does not move when the field is left alone', async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAndType(user, '2026-11-20');
    await user.tab();
    await user.tab();
    expect(api.tasks.move).not.toHaveBeenCalled();
  });
});
