import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskColour } from '../../shared/types';
import { idleTimerState, installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { TasksWidget } from './TasksWidget';

const task = (id: number, text: string, over: Partial<Task> = {}): Task => ({
  id,
  text,
  colour: 'yellow',
  done: false,
  sort: id,
  createdAt: id,
  doneAt: null,
  ...over,
});

/** A tiny in-memory tasks store behind the mocked bridge, so the widget sees real round trips. */
function setup(initial: Task[] = [], opts: { list?: () => Promise<Task[]> } = {}) {
  let rows = initial.map((t) => ({ ...t }));
  let nextId = 100;
  const snap = () => Promise.resolve(rows.map((t) => ({ ...t })));
  const api: MockApi = mockApi({
    tasks: {
      list: vi.fn(opts.list ?? snap),
      create: vi.fn(({ text, colour }: { text: string; colour: TaskColour }) => {
        rows = [...rows, task(nextId, text, { colour, sort: rows.length })];
        nextId += 1;
        return snap();
      }),
      update: vi.fn((id: number, patch: Partial<Task>) => {
        rows = rows.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                doneAt: patch.done === undefined ? t.doneAt : patch.done ? 1 : null,
              }
            : t,
        );
        return snap();
      }),
      reorder: vi.fn((ids: number[]) => {
        rows = rows.map((t) => (ids.includes(t.id) ? { ...t, sort: ids.indexOf(t.id) } : t));
        return snap();
      }),
      clearDone: vi.fn(() => {
        rows = rows.filter((t) => !t.done);
        return snap();
      }),
    },
  });
  installMockApi(api);
  render(<TasksWidget />);
  return api;
}

const noteTexts = () => within(screen.getByRole('list', { name: 'Tasks' })).getAllByRole('listitem');

describe('TasksWidget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a calm empty state', async () => {
    setup();
    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument();
  });

  it('Enter in "Add a task…" creates a yellow task', async () => {
    const api = setup();
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Read chapter 4{Enter}');
    expect(api.tasks.create).toHaveBeenCalledWith({
      text: 'Read chapter 4',
      colour: 'yellow',
    });
    expect(await screen.findByRole('button', { name: 'Read chapter 4' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add a task…')).toHaveValue('');
  });

  it('ignores a blank task', async () => {
    const api = setup();
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), '   {Enter}');
    expect(api.tasks.create).not.toHaveBeenCalled();
  });

  it('text over 500 chars is cut to 500', async () => {
    const api = setup();
    const input = screen.getByPlaceholderText('Add a task…');
    expect(input).toHaveAttribute('maxlength', '500');
    fireEvent.change(input, { target: { value: 'a'.repeat(620) } });
    fireEvent.submit(input);
    expect(api.tasks.create).toHaveBeenCalledWith({
      text: 'a'.repeat(500),
      colour: 'yellow',
    });
  });

  it('colour picker sets one of six colours', async () => {
    const api = setup([task(1, 'Essay')]);
    const picker = within(screen.getByRole('group', { name: 'New note colour' }));
    expect(picker.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Yellow',
      'Pink',
      'Blue',
      'Green',
      'Purple',
      'Grey',
    ]);
    await userEvent.click(picker.getByRole('button', { name: 'Purple' }));
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Flashcards{Enter}');
    expect(api.tasks.create).toHaveBeenCalledWith({
      text: 'Flashcards',
      colour: 'purple',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Change colour of "Essay"' }));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Note colour' })).getByRole('button', { name: 'Blue' }),
    );
    expect(api.tasks.update).toHaveBeenCalledWith(1, { colour: 'blue' });
  });

  it('ticking moves it to "Done (1)"', async () => {
    const api = setup([task(1, 'Essay'), task(2, 'Lab')]);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mark "Essay" as done' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { done: true });
    const toggle = await screen.findByRole('button', { name: /Done \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Done tasks' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(within(screen.getByRole('list', { name: 'Done tasks' })).getByText('Essay')).toBeInTheDocument();
  });

  it('Clear done is not shown when nothing is done', async () => {
    setup([task(1, 'Essay')]);
    await screen.findByRole('button', { name: 'Essay' });
    expect(screen.queryByRole('button', { name: 'Clear done' })).not.toBeInTheDocument();
  });

  it('clear done calls clearDone', async () => {
    const api = setup([task(1, 'Essay'), task(2, 'Lab', { done: true, doneAt: 5 })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Clear done' }));
    expect(api.tasks.clearDone).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear done' })).not.toBeInTheDocument());
  });

  it('Alt+ArrowUp reorders and calls reorder with new id order', async () => {
    const api = setup([task(1, 'One'), task(2, 'Two'), task(3, 'Three')]);
    await screen.findByText('Three');
    const third = noteTexts()[2]!;
    fireEvent.keyDown(within(third).getByRole('checkbox'), {
      key: 'ArrowUp',
      altKey: true,
    });
    expect(api.tasks.reorder).toHaveBeenCalledWith([1, 3, 2]);
    await waitFor(() => expect(noteTexts()[1]).toHaveTextContent('Three'));
  });

  it('Alt+ArrowDown on the last note does nothing', async () => {
    const api = setup([task(1, 'One'), task(2, 'Two')]);
    await screen.findByText('Two');
    fireEvent.keyDown(within(noteTexts()[1]!).getByRole('checkbox'), {
      key: 'ArrowDown',
      altKey: true,
    });
    expect(api.tasks.reorder).not.toHaveBeenCalled();
  });

  it('dragging a handle past another note reorders on release', async () => {
    const api = setup([task(1, 'One'), task(2, 'Two')]);
    await screen.findByText('Two');
    const [first, second] = noteTexts();
    first!.getBoundingClientRect = () => ({ top: 0, height: 40 }) as DOMRect;
    second!.getBoundingClientRect = () => ({ top: 50, height: 40 }) as DOMRect;
    const handle = within(first!).getByRole('button', {
      name: /Drag to reorder/,
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(api.tasks.reorder).toHaveBeenCalledWith([2, 1]);
  });

  it('click text to edit and Enter saves', async () => {
    const api = setup([task(1, 'Essay')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Essay' }));
    const input = screen.getByRole('textbox', { name: 'Edit task' });
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, 'Essay draft{Enter}');
    expect(api.tasks.update).toHaveBeenCalledWith(1, { text: 'Essay draft' });
    expect(await screen.findByRole('button', { name: 'Essay draft' })).toBeInTheDocument();
  });

  it('Esc cancels an edit and blur saves it', async () => {
    const api = setup([task(1, 'Essay')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Essay' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit task' }), ' x{Escape}');
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Essay' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Essay' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit task' }), ' two');
    await userEvent.tab();
    expect(api.tasks.update).toHaveBeenCalledWith(1, { text: 'Essay two' });
  });

  it('Alt+ArrowDown twice moves a note two places and keeps focus on it', async () => {
    const api = setup([task(1, 'One'), task(2, 'Two'), task(3, 'Three')]);
    await screen.findByText('Three');
    const box = within(noteTexts()[0]!).getByRole('checkbox');
    box.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(noteTexts()[1]).toHaveTextContent('One'));
    expect(within(noteTexts()[1]!).getByRole('checkbox')).toHaveFocus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(noteTexts()[2]).toHaveTextContent('One'));
    expect(api.tasks.reorder).toHaveBeenNthCalledWith(1, [2, 1, 3]);
    expect(api.tasks.reorder).toHaveBeenNthCalledWith(2, [2, 3, 1]);
    expect(within(noteTexts()[2]!).getByRole('checkbox')).toHaveFocus();
  });

  it('losing pointer capture ends a drag and commits the order', async () => {
    const api = setup([task(1, 'One'), task(2, 'Two')]);
    await screen.findByText('Two');
    const [first, second] = noteTexts();
    first!.getBoundingClientRect = () => ({ top: 0, height: 40 }) as DOMRect;
    second!.getBoundingClientRect = () => ({ top: 50, height: 40 }) as DOMRect;
    const handle = within(first!).getByRole('button', { name: /Drag to reorder/ });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 90, pointerId: 1 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    expect(api.tasks.reorder).toHaveBeenCalledWith([2, 1]);
    expect(first).not.toHaveClass(/dragging/);
  });

  it('a failed first load says so, with a retry and no empty state', async () => {
    let fail = true;
    const api = setup([task(1, 'Essay')], {
      list: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve([task(1, 'Essay')])),
    });
    expect(await screen.findByText("Couldn't load your tasks.")).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/refreshed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Essay' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your tasks.")).not.toBeInTheDocument();
    expect(api.tasks.list).toHaveBeenCalledTimes(2);
  });

  it('a failed save says the list was refreshed only when the reload worked, and clears on success', async () => {
    const api = setup([task(1, 'Essay')]);
    await screen.findByRole('button', { name: 'Essay' });
    vi.mocked(api.tasks.create).mockRejectedValueOnce(new Error('nope'));
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Lab{Enter}');
    expect(
      await screen.findByText("Couldn't save that just now. Your list has been refreshed."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet.')).not.toBeInTheDocument();
    // The text that didn't save is back in the box: Enter tries again.
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), '{Enter}');
    await screen.findByRole('button', { name: 'Lab' });
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
  });

  it('a failed add puts the typed text back in the add box', async () => {
    const api = setup([task(1, 'Essay')]);
    await screen.findByRole('button', { name: 'Essay' });
    vi.mocked(api.tasks.create).mockRejectedValueOnce(new Error('nope'));
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Revise chapter 3{Enter}');
    await screen.findByText("Couldn't save that just now. Your list has been refreshed.");
    expect(screen.getByPlaceholderText('Add a task…')).toHaveValue('Revise chapter 3');
  });

  it('a failed add never overwrites text typed since', async () => {
    const api = setup([task(1, 'Essay')]);
    await screen.findByRole('button', { name: 'Essay' });
    let reject: (e: Error) => void = () => undefined;
    vi.mocked(api.tasks.create).mockReturnValueOnce(new Promise<Task[]>((_, rej) => (reject = rej)));
    const box = screen.getByPlaceholderText('Add a task…');
    await userEvent.type(box, 'First{Enter}');
    await userEvent.type(box, 'Second');
    await act(async () => reject(new Error('nope')));
    await screen.findByText(/Couldn't save/);
    expect(box).toHaveValue('Second');
  });

  it('a failed edit reopens the note with the edited text', async () => {
    const api = setup([task(1, 'Essay')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Essay' }));
    vi.mocked(api.tasks.update).mockRejectedValueOnce(new Error('nope'));
    const input = screen.getByRole('textbox', { name: 'Edit task' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Essay final draft{Enter}');
    await screen.findByText("Couldn't save that just now. Your list has been refreshed.");
    const reopened = await screen.findByRole('textbox', { name: 'Edit task' });
    expect(reopened).toHaveValue('Essay final draft');
    expect(reopened).toHaveFocus();
    // Enter saves it this time.
    await userEvent.type(reopened, '{Enter}');
    expect(await screen.findByRole('button', { name: 'Essay final draft' })).toBeInTheDocument();
  });

  it('a failed save with a failed reload does not claim a refresh', async () => {
    const api = setup([task(1, 'Essay')]);
    await screen.findByRole('button', { name: 'Essay' });
    vi.mocked(api.tasks.create).mockRejectedValueOnce(new Error('nope'));
    vi.mocked(api.tasks.list).mockRejectedValueOnce(new Error('still nope'));
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Lab{Enter}');
    expect(await screen.findByText("Couldn't save that just now.")).toBeInTheDocument();
    expect(screen.queryByText(/refreshed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Essay' })).toBeInTheDocument();
  });

  it('Enter then blur of the removed input saves once', async () => {
    const api = setup([task(1, 'Essay')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Essay' }));
    const input = screen.getByRole('textbox', { name: 'Edit task' });
    await userEvent.type(input, ' two');
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    await waitFor(() => expect(api.tasks.update).toHaveBeenCalledTimes(1));
  });

  it('returns focus to the note text after an edit ends', async () => {
    setup([task(1, 'Essay')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Essay' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit task' }), ' two{Enter}');
    expect(await screen.findByRole('button', { name: 'Essay two' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Essay two' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Essay two' })).toHaveFocus();
  });

  it('returns focus to the colour button after picking, and Esc closes the swatch row', async () => {
    setup([task(1, 'Essay')]);
    const dot = await screen.findByRole('button', { name: 'Change colour of "Essay"' });
    await userEvent.click(dot);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Note colour' })).getByRole('button', { name: 'Blue' }),
    );
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Note colour' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Change colour of "Essay"' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Change colour of "Essay"' }));
    within(screen.getByRole('group', { name: 'Note colour' }))
      .getByRole('button', { name: 'Pink' })
      .focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Note colour' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change colour of "Essay"' })).toHaveFocus();
  });

  it('ticking a note moves focus to the next note, or the add box when it was last', async () => {
    setup([task(1, 'Essay'), task(2, 'Lab')]);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mark "Essay" as done' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark "Lab" as done' })).toHaveFocus());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark "Lab" as done' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Add a task…')).toHaveFocus());
  });

  it('a save whose fallback reload works also clears an earlier failed load', async () => {
    let fail = true;
    const api = setup([task(1, 'Essay')], {
      list: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve([task(1, 'Essay')])),
    });
    expect(await screen.findByText("Couldn't load your tasks.")).toBeInTheDocument();
    fail = false;
    vi.mocked(api.tasks.create).mockRejectedValueOnce(new Error('nope'));
    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Lab{Enter}');
    expect(
      await screen.findByText("Couldn't save that just now. Your list has been refreshed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your tasks.")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Essay' })).toBeInTheDocument();
  });

  it('a slow tick does not pull focus back from wherever it has gone since', async () => {
    const api = setup([task(1, 'Essay'), task(2, 'Lab')]);
    await screen.findByRole('button', { name: 'Essay' });
    let land: (list: Task[]) => void = () => undefined;
    vi.mocked(api.tasks.update).mockImplementationOnce(() => new Promise<Task[]>((r) => (land = r)));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark "Essay" as done' }));
    const add = screen.getByPlaceholderText('Add a task…');
    await userEvent.click(add);
    await act(async () => land([task(1, 'Essay', { done: true, doneAt: 1 }), task(2, 'Lab')]));
    expect(screen.queryByRole('checkbox', { name: 'Mark "Essay" as done' })).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });

  it('un-ticking keeps focus on the note, now back in the open list', async () => {
    setup([task(1, 'Old', { done: true, doneAt: 5 }), task(2, 'Two')]);
    await userEvent.click(await screen.findByRole('button', { name: /Done \(1\)/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark "Old" as not done' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark "Old" as done' })).toHaveFocus());
  });

  it('un-ticking puts the note at the end of the open list', async () => {
    const api = setup([task(1, 'Old', { done: true, doneAt: 5 }), task(2, 'Two'), task(3, 'Three')]);
    await userEvent.click(await screen.findByRole('button', { name: /Done \(1\)/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark "Old" as not done' }));
    expect(api.tasks.update).toHaveBeenCalledWith(1, { done: false });
    await waitFor(() => expect(api.tasks.reorder).toHaveBeenCalledWith([2, 3, 1]));
    await waitFor(() => expect(noteTexts()[2]).toHaveTextContent('Old'));
  });

  describe('▶ Start focus', () => {
    it('an open sticky shows ▶ labelled Start focus on "<text>" and it calls timer.startTask', async () => {
      const api = setup([task(5, 'Lab 7')]);
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      expect(api.timer.startTask).toHaveBeenCalledWith(5);
      // Let startTask's promise settle before asserting there is no notice.
      await act(async () => {
        await vi.mocked(api.timer.startTask).mock.results[0]!.value;
      });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('▶ resolving to a running focus shows no notice', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockResolvedValue({
        ...idleTimerState(),
        mode: 'focus',
        status: 'running',
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      await act(async () => {
        await vi.mocked(api.timer.startTask).mock.results[0]!.value;
      });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('▶ resolving to a paused break shows the notice', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockResolvedValue({
        ...idleTimerState(),
        mode: 'short',
        status: 'paused',
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Task set for your next focus.');
    });

    it('the notice clears on the next ▶ that resolves to a running focus', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockResolvedValueOnce({
        ...idleTimerState(),
        mode: 'short',
        status: 'running',
      });
      vi.mocked(api.timer.startTask).mockResolvedValueOnce({
        ...idleTimerState(),
        mode: 'focus',
        status: 'running',
      });
      const play = await screen.findByRole('button', { name: 'Start focus on "Lab 7"' });
      await userEvent.click(play);
      await screen.findByText('Task set for your next focus.');
      await userEvent.click(play);
      await waitFor(() => expect(api.timer.startTask).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    });

    it('Alt+ArrowDown on a note\'s ▶ moves the note and keeps focus on its ▶', async () => {
      const api = setup([task(1, 'One'), task(2, 'Two')]);
      await screen.findByText('Two');
      const play = within(noteTexts()[0]!).getByRole('button', { name: 'Start focus on "One"' });
      expect(play).toHaveAttribute('data-control', 'start');
      play.focus();
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
      await waitFor(() => expect(noteTexts()[1]).toHaveTextContent('One'));
      expect(api.tasks.reorder).toHaveBeenCalledWith([2, 1]);
      expect(within(noteTexts()[1]!).getByRole('button', { name: 'Start focus on "One"' })).toHaveFocus();
    });

    it('Tab reaches ▶ between the text and the colour button', async () => {
      setup([task(5, 'Lab 7')]);
      (await screen.findByRole('button', { name: 'Lab 7' })).focus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Start focus on "Lab 7"' })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Change colour of "Lab 7"' })).toHaveFocus();
    });

    it('a done sticky has no ▶', async () => {
      setup([task(1, 'Open'), task(2, 'Old', { done: true, doneAt: 5 })]);
      await userEvent.click(await screen.findByRole('button', { name: /Done \(1\)/ }));
      const done = within(screen.getByRole('list', { name: 'Done tasks' }));
      expect(done.queryByRole('button', { name: /^Start focus on/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Start focus on "Open"' })).toBeInTheDocument();
    });

    it('▶ during a running break shows "Task set for your next focus."', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockResolvedValue({
        ...idleTimerState(),
        mode: 'short',
        status: 'running',
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Task set for your next focus.');
    });

    it('the notice clears on the next add', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockResolvedValue({
        ...idleTimerState(),
        mode: 'long',
        status: 'paused',
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      await screen.findByText('Task set for your next focus.');
      await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'More{Enter}');
      expect(screen.queryByText('Task set for your next focus.')).toBeNull();
    });

    it('▶ on a task that is gone shows "That task no longer exists." and reloads', async () => {
      const api = setup([task(5, 'Lab 7')]);
      vi.mocked(api.timer.startTask).mockRejectedValue(new Error('That task no longer exists.'));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await userEvent.click(await screen.findByRole('button', { name: 'Start focus on "Lab 7"' }));
      expect(await screen.findByRole('status')).toHaveTextContent('That task no longer exists.');
      await waitFor(() => expect(api.tasks.list).toHaveBeenCalledTimes(2));
    });
  });
});
