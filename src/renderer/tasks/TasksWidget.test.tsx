import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskColour } from '../../shared/types';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
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
function setup(initial: Task[] = []) {
  let rows = initial.map((t) => ({ ...t }));
  let nextId = 100;
  const snap = () => Promise.resolve(rows.map((t) => ({ ...t })));
  const api: MockApi = mockApi({
    tasks: {
      list: vi.fn(snap),
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

  it('clear done calls clearDone, and is only shown when something is done', async () => {
    const api = setup([task(1, 'Essay'), task(2, 'Lab', { done: true, doneAt: 5 })]);
    expect(screen.queryByRole('button', { name: 'Clear done' })).not.toBeInTheDocument();
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
});
