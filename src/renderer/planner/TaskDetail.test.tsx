import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PlannerTask } from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { resetPlannerStore, usePlannerStore } from './plannerStore';
import { useShortcuts } from '../shell/useShortcuts';
import { TaskDetail } from './TaskDetail';

const MIN = 60_000;
const DAY = '2026-11-11'; // a Wednesday

const sub = (id: number, text: string, done = false) => ({ id, taskId: 1, text, done, sort: id });

function setup(
  over: Partial<PlannerTask> = {},
  tasks: PlannerTask[] = [],
): { api: MockApi; task: PlannerTask } {
  const {
    spotifyTokens: _t,
    calendarUrls: _c,
    calendarCache: _a,
    weatherCache: _w,
    ...pub
  } = structuredClone(DEFAULT_SETTINGS);
  useStudyStore.setState({ settings: pub, subjects: seedSubjects() });
  const task = minimalPlannerTask({ id: 1, title: 'Read chapter 4', day: DAY, ...over });
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
      lists: vi.fn(() =>
        Promise.resolve({
          lists: [{ id: 10, name: 'Someday', subjectId: null, sort: 0, createdAt: 0 }],
          tasks: tasks.filter((t) => t.listId !== null),
          deadlines: [],
        }),
      ),
    },
  });
  installMockApi(api);
  usePlannerStore.setState({
    tasks: { [task.id]: task, ...Object.fromEntries(tasks.map((t) => [t.id, t])) },
  });
  usePlannerStore.getState().openDetail(task.id);
  render(<TaskDetail />);
  return { api, task };
}

beforeEach(() => {
  resetPlannerStore();
  resetStudyStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskDetail', () => {
  it('is a dialog named for the task and shows every field with its values', () => {
    setup({
      note: 'Pages 10 to 20',
      subjectId: 2,
      estimateMin: 45,
      tags: ['lecture'],
      colour: 'blue',
      repeat: { kind: 'weekly' },
      reminder: '18:30',
      subtasks: [sub(5, 'Summarise')],
      actualMs: 32 * MIN,
    });
    const dialog = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
    expect(within(dialog).getByRole('button', { name: 'Placement: Wed 11 Nov' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Read chapter 4');
    expect(within(dialog).getByRole('checkbox', { name: 'Mark as done' })).not.toBeChecked();
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Pages 10 to 20');
    expect(within(dialog).getByLabelText('Subtask Summarise')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Add a subtask')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('2');
    expect(within(dialog).getByLabelText('Estimate')).toHaveValue('45');
    expect(within(dialog).getByText('#lecture')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('Repeat')).toHaveValue('weekly');
    expect(within(dialog).getByLabelText('Reminder')).toHaveValue('18:30');
    expect(within(dialog).getByText('Focused: 32m')).toBeInTheDocument();
  });

  it('lists only non-archived subjects, and "No subject" first', () => {
    setup();
    act(() =>
      useStudyStore.setState({
        subjects: seedSubjects().map((s, i) => (i === 0 ? { ...s, archived: true } : s)),
      }),
    );
    const options = within(screen.getByLabelText('Subject')).getAllByRole('option');
    expect(options[0]).toHaveTextContent('No subject');
    expect(options.map((o) => o.textContent)).not.toContain(seedSubjects()[0]?.name);
  });

  it('saves an edited title on blur, and never a blank one', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Read chapter 5');
    await user.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { title: 'Read chapter 5' });

    vi.mocked(api.tasks.update).mockClear();
    await user.clear(screen.getByLabelText('Title'));
    await user.tab();
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveValue('Read chapter 4');
  });

  it('keeps the wrapping title one line: Enter saves, a line break becomes a space', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Read chapter 5{Enter}');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { title: 'Read chapter 5' });
    expect(title).toHaveValue('Read chapter 5');
    fireEvent.change(title, { target: { value: 'Read\nchapter 6' } });
    expect(title).toHaveValue('Read chapter 6');
  });

  it('saves a note on blur', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.type(screen.getByLabelText('Note'), 'Hello');
    await user.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'Hello' });
  });

  it('ticks the task done', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Mark as done' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { done: true });
  });

  it('offers the presets plus Custom, and saves a preset', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const select = screen.getByLabelText('Estimate');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', '15m', '30m', '45m', '1h', '1h 30m', '2h', '3h', 'Custom…']);
    await user.selectOptions(select, '45m');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { estimateMin: 45 });
  });

  it('saves a custom estimate of 600 and refuses 601', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.selectOptions(screen.getByLabelText('Estimate'), 'Custom…');
    const field = screen.getByLabelText('Custom estimate (minutes)');
    await user.type(field, '601');
    await user.tab();
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('5 to 600 minutes');

    await user.clear(field);
    await user.type(field, '600');
    await user.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { estimateMin: 600 });
  });

  it('saves a tag as lower case', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.type(screen.getByLabelText('Add a tag'), 'Lecture{Enter}');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { tags: ['lecture'] });
  });

  it('rejects a bad tag and removes one with its button', async () => {
    const user = userEvent.setup();
    const { api } = setup({ tags: ['a', 'b'] });
    await user.type(screen.getByLabelText('Add a tag'), 'no spaces{Enter}');
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove tag a' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { tags: ['b'] });
  });

  it('aria-disables the tag field at 8 tags, described by the limit, and keeps focus there', async () => {
    const user = userEvent.setup();
    setup({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    const field = screen.getByLabelText('Add a tag');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(field).toHaveAccessibleDescription('Up to 8 tags');
    await user.type(field, 'extra{Enter}');
    expect(screen.queryByText('#extra')).not.toBeInTheDocument();
  });

  it('does not drop focus to the page when the 8th tag is added', async () => {
    const user = userEvent.setup();
    const { api } = setup({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    vi.mocked(api.tasks.update).mockImplementation((_id, patch) => {
      const t = { ...(usePlannerStore.getState().tasks[1] as PlannerTask), ...patch } as PlannerTask;
      return Promise.resolve({ tasks: [t], removed: [] });
    });
    const field = screen.getByLabelText('Add a tag');
    await user.type(field, 'h{Enter}');
    await waitFor(() => expect(field).toHaveAttribute('aria-disabled', 'true'));
    expect(field).toHaveFocus();
  });

  it('words the tag hint with "characters"', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Add a tag'), '!!!{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tags use letters, numbers and hyphens, up to 24 characters.',
    );
  });

  it('saves a colour, and none', async () => {
    const user = userEvent.setup();
    const { api } = setup({ colour: 'blue' });
    await user.click(screen.getByRole('button', { name: 'Pink' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { colour: 'pink' });
    await user.click(screen.getByRole('button', { name: 'No colour' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { colour: null });
  });

  it('saves a subject', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.selectOptions(screen.getByLabelText('Subject'), String(seedSubjects()[0]?.id));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { subjectId: seedSubjects()[0]?.id });
  });

  it('shows no repeat or reminder for a list task', () => {
    setup({ day: null, listId: 10 });
    expect(screen.queryByLabelText('Repeat')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reminder')).not.toBeInTheDocument();
  });

  it('saves "Every N days" with the number entered', async () => {
    const user = userEvent.setup();
    const { api, task } = setup();
    await user.selectOptions(screen.getByLabelText('Repeat'), 'Every N days');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { repeat: { kind: 'every', days: 2 } });
    // The mock does not echo the write; the store now holds the rule main would have saved.
    act(() => {
      usePlannerStore.getState().apply({
        tasks: [{ ...task, repeat: { kind: 'every', days: 2 } }],
        removed: [],
      });
    });
    const days = screen.getByLabelText('Every N days', { selector: 'input' });
    await user.clear(days);
    await user.type(days, '3');
    await user.tab();
    expect(api.tasks.update).toHaveBeenLastCalledWith(1, { repeat: { kind: 'every', days: 3 } });
  });

  it('refuses an every-N outside 2 to 30', async () => {
    const user = userEvent.setup();
    const { api } = setup({ repeat: { kind: 'every', days: 2 } });
    const days = screen.getByLabelText('Every N days', { selector: 'input' });
    await user.clear(days);
    await user.type(days, '31');
    await user.tab();
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('2 to 30 days');
  });

  it('saves a named repeat and clears it', async () => {
    const user = userEvent.setup();
    const { api } = setup({ repeat: { kind: 'daily' } });
    await user.selectOptions(screen.getByLabelText('Repeat'), 'Weekdays');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { repeat: { kind: 'weekdays' } });
    await user.selectOptions(screen.getByLabelText('Repeat'), 'None');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { repeat: null });
  });

  it('saves the reminder time on blur', async () => {
    const { api } = setup();
    const time = screen.getByLabelText('Reminder');
    fireEvent.change(time, { target: { value: '18:30' } });
    fireEvent.blur(time);
    expect(api.tasks.update).toHaveBeenCalledWith(1, { reminder: '18:30' });
  });

  it('moves to the end of the chosen day from the placement picker', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-11-12' } });
    expect(api.tasks.move).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { day: '2026-11-12', index: 0 }));
  });

  it('does not move on intermediate date changes, nor to a year like 0002', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    const day = screen.getByLabelText('Day');
    fireEvent.change(day, { target: { value: '2026-11-12' } });
    fireEvent.change(day, { target: { value: '2026-11-13' } });
    fireEvent.change(day, { target: { value: '0002-11-13' } });
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled();
    fireEvent.keyDown(day, { key: 'Enter' });
    fireEvent.blur(day);
    expect(api.tasks.move).not.toHaveBeenCalled();
  });

  it('moves on Enter in the date field', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-11-14' } });
    fireEvent.keyDown(screen.getByLabelText('Day'), { key: 'Enter' });
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { day: '2026-11-14', index: 0 }));
  });

  it('puts the move after the tasks already on that day', async () => {
    const user = userEvent.setup();
    const other = minimalPlannerTask({ id: 2, day: '2026-11-12' });
    const { api } = setup({}, [other]);
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-11-12' } });
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { day: '2026-11-12', index: 1 }));
  });

  it('moves into a list from the placement picker', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    await user.click(await screen.findByRole('button', { name: 'Someday' }));
    await waitFor(() => expect(api.tasks.move).toHaveBeenCalledWith(1, { listId: 10, index: 0 }));
  });

  it('names a list task by its list', () => {
    setup({ day: null, listId: 10 });
    act(() =>
      usePlannerStore.setState({
        lists: [{ id: 10, name: 'Someday', subjectId: null, sort: 0, createdAt: 0 }],
      }),
    );
    expect(screen.getByRole('button', { name: 'Placement: Someday' })).toBeInTheDocument();
  });

  it('adds, ticks, moves up and deletes subtasks through the subtasks channels', async () => {
    const user = userEvent.setup();
    const { api } = setup({ subtasks: [sub(5, 'First'), sub(6, 'Second')] });
    // Main answers every subtask write with the whole task; keep the store's.
    for (const channel of [
      api.subtasks.add,
      api.subtasks.update,
      api.subtasks.remove,
      api.subtasks.reorder,
    ]) {
      vi.mocked(channel).mockImplementation(() =>
        Promise.resolve(usePlannerStore.getState().tasks[1] as PlannerTask),
      );
    }
    await user.type(screen.getByLabelText('Add a subtask'), 'Third{Enter}');
    expect(api.subtasks.add).toHaveBeenCalledWith(1, 'Third');
    await user.click(screen.getByRole('checkbox', { name: 'Tick "First"' }));
    expect(api.subtasks.update).toHaveBeenCalledWith(5, { done: true });
    await user.click(screen.getByRole('button', { name: 'Move "Second" up' }));
    expect(api.subtasks.reorder).toHaveBeenCalledWith(1, [6, 5]);
    await user.click(screen.getByRole('button', { name: 'Delete "First"' }));
    expect(api.subtasks.remove).toHaveBeenCalledWith(5);
  });

  it('renames a subtask on blur', async () => {
    const user = userEvent.setup();
    const { api } = setup({ subtasks: [sub(5, 'First')] });
    const field = screen.getByLabelText('Subtask First');
    await user.clear(field);
    await user.type(field, 'Renamed');
    await user.tab();
    expect(api.subtasks.update).toHaveBeenCalledWith(5, { text: 'Renamed' });
  });

  it('aria-disables the subtask field at 30, described by the limit', () => {
    setup({ subtasks: Array.from({ length: 30 }, (_, i) => sub(i + 5, `s${i}`)) });
    const field = screen.getByLabelText('Add a subtask');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(field).toHaveAccessibleDescription('Up to 30 subtasks');
  });

  it('caps the title at 500 characters by code points', async () => {
    setup();
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: '😀'.repeat(501) } });
    expect([...(title as HTMLInputElement).value]).toHaveLength(500);
  });

  it('closes on Escape and says nothing else about it', async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
  });

  it('closes its placement picker on Escape before the popover', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /^Placement/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Move task' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens a task that is not in the store through planner.task', async () => {
    const hidden = minimalPlannerTask({ id: 77, title: 'On another day', day: '2026-12-01' });
    const { api } = setup();
    vi.mocked(api.planner.task).mockResolvedValue(hidden);
    act(() => usePlannerStore.getState().openDetail(77));
    expect(await screen.findByRole('dialog', { name: 'Task: On another day' })).toBeInTheDocument();
    expect(api.planner.task).toHaveBeenCalledWith(77);
    expect(usePlannerStore.getState().tasks[77]).toEqual(hidden);
  });

  it('closes with a gentle note when the task no longer exists', async () => {
    setup();
    act(() => usePlannerStore.getState().openDetail(404));
    await waitFor(() => expect(usePlannerStore.getState().detailTaskId).toBeNull());
    expect(usePlannerStore.getState().notice).toBe('That task no longer exists.');
  });

  it('closes both times when a missing task is opened twice', async () => {
    const { api } = setup();
    for (let i = 1; i <= 2; i++) {
      act(() => usePlannerStore.getState().openDetail(404));
      await waitFor(() => expect(usePlannerStore.getState().detailTaskId).toBeNull());
      expect(api.planner.task).toHaveBeenCalledTimes(i);
    }
  });

  it('keeps Tab inside the dialog, and aria-modal says so', async () => {
    const user = userEvent.setup();
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const items = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea',
      ),
    ];
    items[items.length - 1]?.focus();
    await user.tab();
    expect(items[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(items[items.length - 1]).toHaveFocus();
  });

  it('keeps shell shortcuts from firing while the dialog has focus', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    function Keys() {
      useShortcuts();
      return null;
    }
    render(<Keys />);
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('rn1');
    expect(api.timer.reset).not.toHaveBeenCalled();
    expect(api.timer.skip).not.toHaveBeenCalled();
    expect(api.timer.setMode).not.toHaveBeenCalled();
  });

  it('saves a note being typed when Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.type(screen.getByLabelText('Note'), 'Half a thought');
    await user.keyboard('{Escape}');
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
    expect(api.tasks.update).toHaveBeenCalledTimes(1);
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'Half a thought' });
  });

  it('closes on a press outside the dialog, saving a draft first, and not on a press inside', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const outside = document.createElement('button');
    outside.textContent = 'Behind';
    document.body.append(outside);
    await user.type(screen.getByLabelText('Note'), 'Half a thought');
    await user.click(screen.getByLabelText('Title'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(outside);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
    expect(api.tasks.update).toHaveBeenCalledTimes(1);
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'Half a thought' });
    outside.remove();
  });

  it('saves a title being typed when Close is clicked, once', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(api.tasks.update).toHaveBeenCalledTimes(1);
    expect(api.tasks.update).toHaveBeenCalledWith(1, { title: 'Renamed' });
  });

  it('saves a subtask rename when the dialog closes', async () => {
    const user = userEvent.setup();
    const { api } = setup({ subtasks: [sub(5, 'Old')] });
    const field = screen.getByLabelText('Subtask Old');
    await user.clear(field);
    await user.type(field, 'New');
    await user.keyboard('{Escape}');
    expect(api.subtasks.update).toHaveBeenCalledWith(5, { text: 'New' });
  });

  it('keeps the typed text and says so when a save is refused', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    vi.mocked(api.tasks.update).mockRejectedValue(new Error('no'));
    const note = screen.getByLabelText('Note');
    await user.type(note, 'Kept');
    await user.tab();
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeInTheDocument();
    expect(note).toHaveValue('Kept');
  });
});
