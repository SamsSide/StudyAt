import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PlannerTask } from '../../shared/types';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, minimalPlannerTask, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { resetPlannerStore, usePlannerStore } from './plannerStore';
import { TaskDetail } from './TaskDetail';

const DAY = '2026-11-11'; // a Wednesday

function setup(over: Partial<PlannerTask> = {}): { api: MockApi; task: PlannerTask } {
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

describe('TaskCard', () => {
  it('opens as the small card: placement, Expand, title, done, note, chips and the icon bar', () => {
    setup({ estimateMin: 60, tags: ['lecture'], actualMs: 32 * 60_000 });
    const card = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
    expect(within(card).getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(within(card).getByRole('textbox', { name: 'Title' })).toHaveValue('Read chapter 4');
    expect(within(card).getByRole('checkbox', { name: 'Mark as done' })).toBeInTheDocument();
    expect(within(card).getByRole('textbox', { name: 'Note' })).toHaveAttribute(
      'placeholder',
      'Add some extra notes here…',
    );
    const chips = within(card).getByRole('group', { name: 'Details' });
    expect(within(chips).getByRole('combobox', { name: 'Subject' })).toBeInTheDocument();
    expect(within(chips).getByRole('combobox', { name: 'Estimate' })).toHaveValue('60');
    expect(within(chips).getByText('#lecture')).toBeInTheDocument();
    expect(within(chips).getByText('Focused 32m')).toBeInTheDocument();
    for (const name of ['Add subtask', 'Repeat', 'Colour', 'Reminder', 'Start focus', 'Task menu']) {
      expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    }
    // Full-only fields are not on the card.
    expect(within(card).queryByRole('group', { name: 'Colour' })).toBeNull();
  });

  it('saves a note and a tag from the card', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'pages 40-60');
    await user.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'pages 40-60' });
    await user.type(screen.getByRole('textbox', { name: 'Add a tag' }), 'Lecture{Enter}');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { tags: ['lecture'] });
  });

  it('saves subject and estimate from the chips', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Estimate' }), '45');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { estimateMin: 45 });
    const subject = seedSubjects()[0]!;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), String(subject.id));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { subjectId: subject.id });
  });

  it('offers "No estimate", the presets and a custom value already set', () => {
    setup({ estimateMin: 50 });
    const estimate = screen.getByRole('combobox', { name: 'Estimate' });
    expect(estimate).toHaveValue('50');
    const labels = within(estimate)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['No estimate', '15m', '30m', '45m', '1h', '1h 30m', '2h', '3h', '50m']);
    expect(
      within(screen.getByRole('combobox', { name: 'Subject' })).getAllByRole('option')[0],
    ).toHaveTextContent('No subject');
  });

  it('shows no Focused chip before any focus time', () => {
    setup();
    expect(screen.queryByText(/^Focused/)).toBeNull();
  });

  it('repeat, colour and reminder menus save; Esc closes a menu, not the card', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Weekdays' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { repeat: { kind: 'weekdays' } });
    await user.click(screen.getByRole('button', { name: 'Colour' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Task: Read chapter 4' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reminder' }));
    const time = screen.getByLabelText('Reminder time');
    await user.type(time, '18:30');
    await user.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { reminder: '18:30' });
  });

  it('lists the repeat choices, closes on a choice, and Every N days… expands', async () => {
    setup({ repeat: { kind: 'daily' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    const menu = screen.getByRole('menu', { name: 'Repeat' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual(['None', 'Daily', 'Weekdays', 'Weekly', 'Every N days…']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Daily' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'Daily' })).toHaveFocus();
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Every N days…' }));
    expect(usePlannerStore.getState().detailMode).toBe('full');
  });

  it('saves a colour from its menu and closes the menu', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Colour' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Blue' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { colour: 'blue' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes a menu on a press elsewhere in the card', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Colour' }));
    await user.click(screen.getByRole('textbox', { name: 'Title' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clears a reminder', async () => {
    const { api } = setup({ reminder: '09:00' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reminder' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { reminder: null });
  });

  it('disables Repeat and Reminder for a list task, with the reason', () => {
    setup({ day: null, listId: 10 });
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Repeat' })).toHaveAttribute(
      'title',
      'Repeat is for tasks on a day',
    );
    expect(screen.getByRole('button', { name: 'Reminder' })).toHaveAttribute(
      'title',
      'Reminders are for tasks on a day',
    );
  });

  it('Add subtask shows the subtask list and focuses its input', async () => {
    setup();
    expect(screen.queryByRole('textbox', { name: 'Add a subtask' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add subtask' }));
    expect(screen.getByRole('textbox', { name: 'Add a subtask' })).toHaveFocus();
  });

  it('Start focus starts the task and closes the card', async () => {
    const { api } = setup();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start focus' }));
    expect(api.timer.startTask).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Expand keeps a half-typed note and shows the full detail of the same task', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'draft');
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'draft' });
    const full = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
    expect(within(full).getByRole('group', { name: 'Colour' })).toBeInTheDocument();
  });

  it('a press on the backdrop closes the card and saves what was typed', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'x');
    fireEvent.pointerDown(document.querySelector('[data-detail-backdrop]')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'x' });
  });

  it('Esc closes an open menu first, then the card', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'kept');
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Repeat' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.tasks.update).toHaveBeenCalledTimes(1);
    expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'kept' });
  });

  it('keeps Tab inside the card', async () => {
    setup();
    const user = userEvent.setup();
    const card = screen.getByRole('dialog');
    expect(card).toHaveAttribute('aria-modal', 'true');
    screen.getByRole('button', { name: 'Task menu' }).focus();
    await user.tab();
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to what had it when the card closes, after an Expand too', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('says so on the card when a save comes back unchanged', async () => {
    const user = userEvent.setup();
    setup();
    const card = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
    const note = within(card).getByRole('textbox', { name: 'Note' });
    await user.type(note, 'Kept');
    await user.tab();
    expect(await within(card).findByRole('alert')).toHaveTextContent("Couldn't save that. Try again.");
    expect(note).toHaveValue('Kept');
  });
});
