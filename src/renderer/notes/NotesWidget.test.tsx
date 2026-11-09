import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotePatch } from '../../shared/ipc';
import type { Note, TaskColour } from '../../shared/types';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { NotesWidget } from './NotesWidget';

const note = (id: number, text: string, over: Partial<Note> = {}): Note => ({
  id,
  text,
  colour: 'yellow',
  sort: id,
  createdAt: id,
  updatedAt: id,
  ...over,
});

/** A tiny in-memory notes store behind the mocked bridge, so the widget sees real round trips. */
function setup(initial: Note[] = [], overrides: Partial<MockApi['notes']> = {}) {
  let rows = initial.map((n) => ({ ...n }));
  let nextId = 100;
  const snap = () => Promise.resolve(rows.map((n) => ({ ...n })));
  const api: MockApi = mockApi({
    notes: {
      list: vi.fn(snap),
      create: vi.fn((input?: { colour?: TaskColour }) => {
        rows = [...rows, note(nextId, '', { colour: input?.colour ?? 'yellow', sort: rows.length + 10 })];
        nextId += 1;
        return snap();
      }),
      update: vi.fn((id: number, patch: NotePatch) => {
        rows = rows.map((n) => (n.id === id ? { ...n, ...patch } : n));
        return snap();
      }),
      remove: vi.fn((id: number) => {
        rows = rows.filter((n) => n.id !== id);
        return snap();
      }),
      ...overrides,
    },
  });
  installMockApi(api);
  const view = render(<NotesWidget />);
  return { api, view, rows: () => rows };
}

const sheet = () => screen.getByRole('textbox', { name: /^Note/ });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('NotesWidget', () => {
  it('shows a calm empty state with a New note button that creates one', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New note' });
    await user.click(buttons[buttons.length - 1]!);
    expect(api.notes.create).toHaveBeenCalledTimes(1);
    expect(await screen.findByPlaceholderText('Write a note…')).toHaveFocus();
  });

  it('shows the first note as a sheet with its colour, plain multi-line text and a 5000 cap', async () => {
    setup([note(1, 'Buy milk\nRevise ch. 3', { colour: 'pink' }), note(2, 'Second')]);
    const box = await screen.findByDisplayValue(/Buy milk/);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('maxLength', '5000');
    expect(box).toHaveAttribute('placeholder', 'Write a note…');
    expect(screen.getByRole('button', { name: 'Pink' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('autosaves 500 ms after typing stops, not before', async () => {
    const { api } = setup([note(1, '')]);
    await screen.findByPlaceholderText('Write a note…');
    vi.useFakeTimers();
    fireEvent.change(sheet(), { target: { value: 'H' } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(sheet(), { target: { value: 'Hi' } });
    act(() => vi.advanceTimersByTime(499));
    expect(api.notes.update).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(api.notes.update).toHaveBeenCalledTimes(1);
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Hi' });
  });

  it('saves at once on blur', async () => {
    const { api } = setup([note(1, '')]);
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Quick thought' } });
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Quick thought' });
  });

  it('saves on switching notes, and the next note shows its own text', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'One'), note(2, 'Two')]);
    await screen.findByDisplayValue('One');
    fireEvent.change(sheet(), { target: { value: 'One more' } });
    await user.click(screen.getByRole('button', { name: 'Next note' }));
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'One more' });
    expect(await screen.findByDisplayValue('Two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous note' }));
    expect(await screen.findByDisplayValue('One more')).toBeInTheDocument();
  });

  it('the dot strip shows where you are and jumps to a note', async () => {
    const user = userEvent.setup();
    setup([note(1, 'One'), note(2, 'Two'), note(3, 'Three')]);
    await screen.findByDisplayValue('One');
    const strip = screen.getByRole('group', { name: 'Choose a note' });
    expect(within(strip).getByRole('button', { name: 'Note 1 of 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(within(strip).getByRole('button', { name: 'Note 3 of 3' }));
    expect(await screen.findByDisplayValue('Three')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next note' })).toBeDisabled();
  });

  it('saves on unmount and when the window is hidden', async () => {
    const { api, view } = setup([note(1, '')]);
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Before hide' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Before hide' });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

    fireEvent.change(sheet(), { target: { value: 'Before close' } });
    view.unmount();
    expect(api.notes.update).toHaveBeenLastCalledWith(1, { text: 'Before close' });
  });

  it('saves when main says the window was hidden to the tray', async () => {
    const { api } = setup([note(1, '')]);
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Before tray' } });
    act(() => api.emitVisibility(false));
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Before tray' });
  });

  it('typing keeps going while a save is in flight; the answer does not wipe newer text', async () => {
    let release: (v: Note[]) => void = () => undefined;
    const { api } = setup([note(1, '')], {
      update: vi.fn(() => new Promise<Note[]>((r) => (release = r))),
    });
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Draft' } });
    fireEvent.blur(sheet());
    fireEvent.change(sheet(), { target: { value: 'Draft and more' } });
    await act(async () => release([note(1, 'Draft')]));
    expect(sheet()).toHaveValue('Draft and more');
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenLastCalledWith(1, { text: 'Draft and more' });
  });

  it('a failed save keeps the text and says so kindly, never the raw error', async () => {
    const { api } = setup([note(1, '')], {
      update: vi.fn(() =>
        Promise.reject(new Error("Error invoking remote method 'notes:update': Error: SQLITE_BUSY")),
      ),
    });
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Keep me' } });
    fireEvent.blur(sheet());
    expect(
      await screen.findByText("Couldn't save this note. It's still here — try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/SQLITE|invoking/)).not.toBeInTheDocument();
    expect(sheet()).toHaveValue('Keep me');
    // The next blur tries again.
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenCalledTimes(2);
  });

  it('New note adds an empty sheet at the end and focuses it', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'One')]);
    await screen.findByDisplayValue('One');
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(api.notes.create).toHaveBeenCalled();
    await waitFor(() => expect(sheet()).toHaveValue(''));
    expect(sheet()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Note 2 of 2' })).toHaveAttribute('aria-current', 'true');
  });

  it('the colour picker names its six swatches and recolours the note', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'One')]);
    await screen.findByDisplayValue('One');
    const picker = screen.getByRole('group', { name: 'Note colour' });
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Yellow', 'Pink', 'Blue', 'Green', 'Purple', 'Grey']);
    await user.click(within(picker).getByRole('button', { name: 'Green' }));
    expect(api.notes.update).toHaveBeenCalledWith(1, { colour: 'green' });
    await waitFor(() =>
      expect(within(picker).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('delete asks in place with Cancel focused; Cancel keeps the note', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'One')]);
    await screen.findByDisplayValue('One');
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByText('Delete this note?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.notes.remove).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete note' })).toHaveFocus();
  });

  it('Delete removes the note and shows its neighbour', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'One'), note(2, 'Two')]);
    await screen.findByDisplayValue('One');
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.notes.remove).toHaveBeenCalledWith(1);
    expect(await screen.findByDisplayValue('Two')).toHaveFocus();
  });

  it('deleting the last note returns to the empty state', async () => {
    const user = userEvent.setup();
    setup([note(1, 'Only')]);
    await screen.findByDisplayValue('Only');
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });

  it('a failed load says so and can try again', async () => {
    const user = userEvent.setup();
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([note(1, 'Back')]);
    setup([], { list });
    expect(await screen.findByText("Couldn't load your notes.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByDisplayValue('Back')).toBeInTheDocument();
  });
});
