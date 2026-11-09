import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotePatch } from '../../shared/ipc';
import type { Note, TaskColour } from '../../shared/types';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { NotesWidget } from './NotesWidget';
import { resetNoteSaves } from './noteSaves';

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

beforeEach(() => {
  vi.clearAllMocks();
  resetNoteSaves();
});
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

  it('a failed older save is not retried once newer text for the note has gone', async () => {
    const replies: { ok: (v: Note[]) => void; fail: (e: Error) => void }[] = [];
    const { api } = setup([note(1, '')], {
      update: vi.fn(() => new Promise<Note[]>((ok, fail) => replies.push({ ok, fail }))),
    });
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 't1' } });
    fireEvent.blur(sheet());
    fireEvent.change(sheet(), { target: { value: 't2' } });
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenCalledTimes(2);
    await act(async () => replies[0]!.fail(new Error('busy')));
    await act(async () => replies[1]!.ok([note(1, 't2')]));
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenCalledTimes(2);
    expect(api.notes.update).not.toHaveBeenLastCalledWith(1, { text: 't1' });
    expect(sheet()).toHaveValue('t2');
  });

  it('keeps unsaved text when a delete fails after a failed save', async () => {
    const user = userEvent.setup();
    const { api } = setup([note(1, 'Old')], {
      update: vi.fn(() => Promise.reject(new Error('busy'))),
      remove: vi.fn(() => Promise.reject(new Error('busy'))),
    });
    await screen.findByDisplayValue('Old');
    fireEvent.change(sheet(), { target: { value: 'Precious words' } });
    fireEvent.blur(sheet());
    await screen.findByText("Couldn't save this note. It's still here — try again.");
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("Couldn't delete this note. Try again.")).toBeInTheDocument();
    expect(api.notes.remove).toHaveBeenCalledWith(1);
    expect(sheet()).toHaveValue('Precious words');
    fireEvent.blur(sheet());
    expect(api.notes.update).toHaveBeenLastCalledWith(1, { text: 'Precious words' });
  });

  it('the save error stays while a failed save is still queued, even after a recolour works', async () => {
    const user = userEvent.setup();
    const update = vi.fn((_id: number, patch: NotePatch) =>
      patch.text !== undefined
        ? Promise.reject(new Error('busy'))
        : Promise.resolve([note(1, 'Old', { colour: patch.colour ?? 'yellow' })]),
    );
    setup([note(1, 'Old')], { update });
    await screen.findByDisplayValue('Old');
    fireEvent.change(sheet(), { target: { value: 'New words' } });
    fireEvent.blur(sheet());
    await screen.findByText("Couldn't save this note. It's still here — try again.");
    await user.click(screen.getByRole('button', { name: 'Blue' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.getByText("Couldn't save this note. It's still here — try again.")).toBeInTheDocument();
    expect(sheet()).toHaveValue('New words');
  });

  it('unsaved text survives closing the widget after a failed final save', async () => {
    const update = vi.fn((_id: number, _patch: NotePatch) => Promise.reject<Note[]>(new Error('busy')));
    const { api, view } = setup([note(1, 'Old')], { update });
    await screen.findByDisplayValue('Old');
    fireEvent.change(sheet(), { target: { value: 'Last words' } });
    view.unmount();
    expect(update).toHaveBeenLastCalledWith(1, { text: 'Last words' });
    await act(async () => undefined);
    update.mockClear();
    update.mockImplementation(() => Promise.resolve([note(1, 'Last words')]));
    render(<NotesWidget />);
    expect(await screen.findByDisplayValue('Last words')).toBeInTheDocument();
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Last words' });
  });

  describe('while the widget is closed', () => {
    /** Types into a note, closes the widget and lets the final save fail. */
    async function closeAfterFailedSave() {
      const update = vi.fn((_id: number, _patch: NotePatch) => Promise.reject<Note[]>(new Error('busy')));
      const { api, view } = setup([note(1, 'Old')], { update });
      await screen.findByDisplayValue('Old');
      fireEvent.change(sheet(), { target: { value: 'Closed words' } });
      vi.useFakeTimers();
      view.unmount();
      await vi.advanceTimersByTimeAsync(0);
      expect(update).toHaveBeenCalledTimes(1);
      update.mockClear();
      return { api, update };
    }

    it('main hiding the window resends the queued text', async () => {
      const { api, update } = await closeAfterFailedSave();
      update.mockImplementation(() => Promise.resolve([note(1, 'Closed words')]));
      api.emitVisibility(false);
      expect(update).toHaveBeenCalledWith(1, { text: 'Closed words' });
    });

    it('the page going hidden resends the queued text', async () => {
      const { update } = await closeAfterFailedSave();
      update.mockImplementation(() => Promise.resolve([note(1, 'Closed words')]));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      fireEvent(document, new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      expect(update).toHaveBeenCalledWith(1, { text: 'Closed words' });
    });

    it('pagehide resends the queued text', async () => {
      const { update } = await closeAfterFailedSave();
      update.mockImplementation(() => Promise.resolve([note(1, 'Closed words')]));
      fireEvent(window, new Event('pagehide'));
      expect(update).toHaveBeenCalledWith(1, { text: 'Closed words' });
    });

    it('a failed save is retried up to three times, two seconds apart', async () => {
      const { update } = await closeAfterFailedSave();
      await vi.advanceTimersByTimeAsync(1999);
      expect(update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(update).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(update).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(update).toHaveBeenCalledTimes(3);
      expect(update).toHaveBeenLastCalledWith(1, { text: 'Closed words' });
    });

    it('the retries stop once a save goes through', async () => {
      const { update } = await closeAfterFailedSave();
      update.mockImplementation(() => Promise.resolve([note(1, 'Closed words')]));
      await vi.advanceTimersByTimeAsync(2000);
      expect(update).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  it('no timed retries while the widget is open; the next blur tries again', async () => {
    const update = vi.fn((_id: number, _patch: NotePatch) => Promise.reject<Note[]>(new Error('busy')));
    setup([note(1, '')], { update });
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Open words' } });
    vi.useFakeTimers();
    fireEvent.blur(sheet());
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('a queued failed save is retried when the window hides', async () => {
    const update = vi.fn((_id: number, _patch: NotePatch) => Promise.reject<Note[]>(new Error('busy')));
    const { api } = setup([note(1, '')], { update });
    await screen.findByPlaceholderText('Write a note…');
    fireEvent.change(sheet(), { target: { value: 'Try again later' } });
    fireEvent.blur(sheet());
    await screen.findByText("Couldn't save this note. It's still here — try again.");
    update.mockImplementation(() => Promise.resolve([note(1, 'Try again later')]));
    await act(async () => api.emitVisibility(false));
    expect(update).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't save this note. It's still here — try again."),
      ).not.toBeInTheDocument(),
    );
  });

  it('Esc in the delete question cancels it, stays inside the widget and refocuses delete', async () => {
    const user = userEvent.setup();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const { api } = setup([note(1, 'One')]);
    await screen.findByDisplayValue('One');
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', onWindowKey);
    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete note' })).toHaveFocus();
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(api.notes.remove).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'New note' })).toHaveFocus();
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
