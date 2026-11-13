import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotePatch } from '../../shared/ipc';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Note, PublicSettings } from '../../shared/types';
import { Shell } from '../shell/Shell';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { testRegistry } from '../shell/testRegistry';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { resetNoteSaves } from './noteSaves';
import { NoteStickies, stickyTitle } from './NoteSticky';
import { resetNotesStore, useNotesStore } from './notesStore';

const note = (id: number, text: string, over: Partial<Note> = {}): Note => ({
  id,
  text,
  colour: 'yellow',
  sort: id,
  createdAt: id,
  updatedAt: id,
  popped: true,
  x: 0.5,
  y: 0.3,
  scale: 1,
  bare: false,
  ...over,
});

/** An in-memory notes table behind the mocked bridge, so the stickies see real round trips. */
function bridge(initial: Note[]): MockApi {
  let rows = initial.map((n) => ({ ...n }));
  const snap = () => Promise.resolve(rows.map((n) => ({ ...n })));
  const patch = (id: number, p: Partial<Note>) => {
    rows = rows.map((n) => (n.id === id ? { ...n, ...p } : n));
    return snap();
  };
  return mockApi({
    notes: {
      list: vi.fn(snap),
      update: vi.fn((id: number, p: NotePatch) => patch(id, p)),
      remove: vi.fn((id: number) => {
        rows = rows.filter((n) => n.id !== id);
        return snap();
      }),
      popOut: vi.fn((id: number) => patch(id, { popped: true })),
      dockBack: vi.fn((id: number) => patch(id, { popped: false })),
    },
  });
}

async function renderStickies(initial: Note[]): Promise<MockApi> {
  const api = bridge(initial);
  installMockApi(api);
  await act(() => useNotesStore.getState().load());
  render(<NoteStickies />);
  return api;
}

const onboarded = (): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, onboarded: true };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNoteSaves();
  resetNotesStore();
  resetStudyStore();
});
afterEach(() => vi.useRealTimers());

describe('stickyTitle', () => {
  it('is the first line when it is 1–30 characters, else "Note"', () => {
    expect(stickyTitle('Shopping\nmilk')).toBe('Shopping');
    expect(stickyTitle('a'.repeat(30))).toBe('a'.repeat(30));
    expect(stickyTitle(`${'a'.repeat(31)}\nshort`)).toBe('Note');
    expect(stickyTitle('')).toBe('Note');
    expect(stickyTitle('   \nsecond')).toBe('Note');
  });
});

describe('NoteStickies (v1.2 spec §3.2)', () => {
  it('renders each popped-out note as a sticky titled by its first line, and no others', async () => {
    await renderStickies([
      note(1, 'Shopping\nmilk'),
      note(2, `${'x'.repeat(31)}\nmore`),
      note(3, 'In the stack', { popped: false }),
    ]);
    expect(screen.getByRole('group', { name: 'Shopping' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Note' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('In the stack')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Shopping' })).toBeInTheDocument();
  });

  it('names the text box "Note text", whatever has been typed', async () => {
    await renderStickies([note(1, 'Shopping\nmilk')]);
    const box = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.change(box, { target: { value: 'Something else\nentirely' } });
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBe(box);
  });

  it('typing saves 500 ms after it stops, through notes.update', async () => {
    const api = await renderStickies([note(1, 'Shopping\nmilk')]);
    const box = screen.getByDisplayValue(/Shopping/);
    expect(box).toHaveAttribute('maxLength', '5000');
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: 'Shopping\nmilk, eggs' } });
    act(() => vi.advanceTimersByTime(499));
    expect(api.notes.update).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(api.notes.update).toHaveBeenCalledWith(1, { text: 'Shopping\nmilk, eggs' });
  });

  it('the title follows the text as it is typed', async () => {
    await renderStickies([note(1, 'Shopping\nmilk')]);
    fireEvent.change(screen.getByDisplayValue(/Shopping/), { target: { value: 'Revision\nch. 3' } });
    expect(screen.getByRole('group', { name: 'Revision' })).toBeInTheDocument();
  });

  it('dragging by the header saves { x, y }', async () => {
    const api = await renderStickies([note(1, 'Shopping')]);
    const handle = screen.getByRole('button', { name: 'Move Shopping' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 560, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 560, clientY: 360, pointerId: 1 });
    await waitFor(() => expect(api.notes.update).toHaveBeenCalledTimes(1));
    const [id, patch] = vi.mocked(api.notes.update).mock.calls[0]!;
    expect(id).toBe(1);
    expect(Object.keys(patch).sort()).toEqual(['x', 'y']);
    expect(useNotesStore.getState().notes[0]!.x).toBe(patch.x);
  });

  it('"Hide background" saves bare: true; bare is coloured paper with no header', async () => {
    const user = userEvent.setup();
    const api = await renderStickies([note(1, 'Shopping', { colour: 'pink' })]);
    await user.click(screen.getByRole('button', { name: 'Hide background' }));
    expect(api.notes.update).toHaveBeenCalledWith(1, { bare: true });
    const group = screen.getByRole('group', { name: 'Shopping' });
    await waitFor(() => expect(group.className).not.toMatch(/frosted/));
    expect(screen.queryByRole('button', { name: 'Delete note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide background' })).not.toBeInTheDocument();
    const paper = group.querySelector('[data-colour]') as HTMLElement;
    expect(paper.dataset.colour).toBe('pink');
    expect(paper.style.backgroundColor).toBe('var(--note-pink)');
  });

  it('the bare toolbar has Show background, Dock back, a colour button and Delete', async () => {
    const user = userEvent.setup();
    const api = await renderStickies([note(1, 'Shopping', { bare: true })]);
    for (const name of ['Show background', 'Dock back', 'Note colour', 'Delete', 'Move Shopping']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Show background' }));
    expect(api.notes.update).toHaveBeenCalledWith(1, { bare: false });
  });

  it('bare: a press on the text never drags; the paper round it does', async () => {
    const api = await renderStickies([note(1, 'Shopping', { bare: true })]);
    const text = screen.getByDisplayValue('Shopping');
    expect(text).toHaveAttribute('data-no-drag');
    fireEvent.pointerDown(text, { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 560, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 560, clientY: 360, pointerId: 1 });
    fireEvent.keyDown(text, { key: 'ArrowDown' });
    expect(api.notes.update).not.toHaveBeenCalled();
    const paper = screen.getByRole('group', { name: 'Shopping' }).querySelector('[data-colour]')!;
    fireEvent.pointerDown(paper, { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 560, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 560, clientY: 360, pointerId: 1 });
    await waitFor(() => expect(api.notes.update).toHaveBeenCalledTimes(1));
  });

  it('the colour button opens the swatches and recolours the note', async () => {
    const user = userEvent.setup();
    const api = await renderStickies([note(1, 'Shopping')]);
    await user.click(screen.getByRole('button', { name: 'Note colour' }));
    const swatches = screen.getByRole('group', { name: 'Choose a colour' });
    await user.click(within(swatches).getByRole('button', { name: 'Green' }));
    expect(api.notes.update).toHaveBeenCalledWith(1, { colour: 'green' });
    expect(screen.queryByRole('group', { name: 'Choose a colour' })).not.toBeInTheDocument();
  });

  it('"Dock back" calls notes.dockBack and the sticky goes', async () => {
    const user = userEvent.setup();
    const api = await renderStickies([note(1, 'Shopping')]);
    await user.click(screen.getByRole('button', { name: 'Dock back' }));
    expect(api.notes.dockBack).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Shopping' })).not.toBeInTheDocument());
  });

  it('Delete asks "Delete this note?"; Cancel keeps it, Delete removes it', async () => {
    const user = userEvent.setup();
    const api = await renderStickies([note(1, 'Shopping')]);
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByText('Delete this note?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.notes.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.notes.remove).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Shopping' })).not.toBeInTheDocument());
  });

  it('bare Delete asks in the toolbar too', async () => {
    const user = userEvent.setup();
    await renderStickies([note(1, 'Shopping', { bare: true })]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this note?')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Delete this note?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('show in the shell with the Notes widget closed, and never carry the auto-hide class', async () => {
    const api = bridge([note(1, 'Shopping'), note(2, 'Paper', { bare: true })]);
    vi.mocked(api.settings.get).mockResolvedValue(onboarded());
    installMockApi(api);
    render(<Shell registry={testRegistry()} />);
    await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
    expect(useStudyStore.getState().settings!.widgets.notes.open).toBe(false);
    for (const name of ['Shopping', 'Paper']) {
      const group = await screen.findByRole('group', { name });
      expect(group.className).not.toMatch(/fades/);
    }
  });
});
