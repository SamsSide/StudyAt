// The one renderer copy of the notes (v1.2 spec §3.2, appplan §4.10), shared by the Notes stack
// and the popped-out stickies. Main owns the rows; every call answers with the whole list, which
// this adopts. Typing does not come through here: text goes through the save queue (noteSaves.ts),
// whose answers the stack and the stickies hand to `adopt`.
//
// A failure leaves a short, kind message in `error`, tagged with the note it was about (null for
// adding), so the stack and each sticky can say it where it happened; main's reason is only
// logged, except the pop-out limit, which is designed copy (ruling R38).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Note, TaskColour } from '../../shared/types';
import { LIMIT_COPY } from '../../shared/planner';
import { ipcErrorMessage, logIpcError } from '../lib/ipcError';

export const SAVE_FAILED = "Couldn't save this note. It's still here — try again.";
export const ADD_FAILED = "Couldn't add a note. Try again.";
export const DELETE_FAILED = "Couldn't delete this note. Try again.";
export const POP_OUT_FAILED = "Couldn't pop out this note. Try again.";
export const DOCK_FAILED = "Couldn't dock this note back. Try again.";

export interface NotesError {
  /** The note the failed call was about; null for adding one. */
  id: number | null;
  text: string;
}

export interface NotesState {
  notes: Note[];
  loaded: boolean;
  loadFailed: boolean;
  error: NotesError | null;
  load(): Promise<void>;
  adopt(list: Note[]): void;
  clearError(): void;
  /** The whole list (sorted) once main has added the note, or null if it failed. */
  create(colour?: TaskColour): Promise<Note[] | null>;
  setColour(id: number, colour: TaskColour): Promise<void>;
  remove(id: number): Promise<void>;
  popOut(id: number): Promise<void>;
  dockBack(id: number): Promise<void>;
  /** Optimistic, so a drag or a toggle shows at once; undone if main fails. */
  place(id: number, p: { x?: number; y?: number; scale?: number; bare?: boolean }): Promise<void>;
}

type Placement = { x?: number; y?: number; scale?: number; bare?: boolean };

export const bySort = (list: Note[]): Note[] => [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);

// The newest placement per note and what it set. While one is in flight a list from any other
// call (a text save answering, say) keeps it, so a sticky never jumps back mid-drag; a reply to an
// older placement is dropped.
let placeSeq = new Map<number, number>();
let placing = new Map<number, Placement>();

const withPlacing = (list: Note[]): Note[] =>
  list.map((n) => {
    const p = placing.get(n.id);
    return p ? { ...n, ...p } : n;
  });

export const useNotesStore: UseBoundStore<StoreApi<NotesState>> = create<NotesState>((set, get) => {
  /** A mutation other than typing; on failure says so and re-reads the list. */
  const run = async (
    call: () => Promise<Note[]>,
    error: (e: unknown) => NotesError,
    context: string,
  ): Promise<Note[] | null> => {
    try {
      const list = await call();
      get().adopt(list);
      set({ error: null });
      return bySort(withPlacing(list));
    } catch (e) {
      logIpcError(context, e);
      set({ error: error(e) });
      try {
        get().adopt(await window.studyat.notes.list());
      } catch {
        // Keep what is on screen; the message already says what happened.
      }
      return null;
    }
  };

  return {
    notes: [],
    loaded: false,
    loadFailed: false,
    error: null,
    async load() {
      try {
        get().adopt(await window.studyat.notes.list());
      } catch (e) {
        // Never rejects: the shell calls this unattended at launch.
        logIpcError('Loading notes failed', e);
        set({ loadFailed: true });
      }
    },
    adopt(list) {
      set({ notes: bySort(withPlacing(list)), loaded: true, loadFailed: false });
    },
    clearError() {
      if (get().error) set({ error: null });
    },
    create: (colour) =>
      run(
        () => window.studyat.notes.create(colour ? { colour } : undefined),
        () => ({ id: null, text: ADD_FAILED }),
        'Adding a note failed',
      ),
    async setColour(id, colour) {
      await run(
        () => window.studyat.notes.update(id, { colour }),
        () => ({ id, text: SAVE_FAILED }),
        'Recolouring a note failed',
      );
    },
    async remove(id) {
      await run(
        () => window.studyat.notes.remove(id),
        () => ({ id, text: DELETE_FAILED }),
        'Deleting a note failed',
      );
    },
    async popOut(id) {
      await run(
        () => window.studyat.notes.popOut(id),
        // Main's limit refusal is designed copy; anything else gets the kind sentence.
        (e) => ({ id, text: ipcErrorMessage(e) === LIMIT_COPY.notes ? LIMIT_COPY.notes : POP_OUT_FAILED }),
        'Popping out a note failed',
      );
    },
    async dockBack(id) {
      await run(
        () => window.studyat.notes.dockBack(id),
        () => ({ id, text: DOCK_FAILED }),
        'Docking a note back failed',
      );
    },
    async place(id, p) {
      const before = get().notes.find((n) => n.id === id);
      if (!before) return;
      const seq = (placeSeq.get(id) ?? 0) + 1;
      placeSeq.set(id, seq);
      const merged = { ...placing.get(id), ...p };
      placing.set(id, merged);
      set({ notes: get().notes.map((n) => (n.id === id ? { ...n, ...merged } : n)) });
      try {
        const list = await window.studyat.notes.update(id, p);
        if (placeSeq.get(id) !== seq) return;
        placing.delete(id);
        get().adopt(list);
      } catch (e) {
        logIpcError('Placing a note failed', e);
        if (placeSeq.get(id) !== seq) return;
        placing.delete(id);
        // Only what this placement set goes back; the rest of the note is as main last said.
        const undo: Partial<Note> = {};
        if (p.x !== undefined) undo.x = before.x;
        if (p.y !== undefined) undo.y = before.y;
        if (p.scale !== undefined) undo.scale = before.scale;
        if (p.bare !== undefined) undo.bare = before.bare;
        set({ notes: get().notes.map((n) => (n.id === id ? { ...n, ...undo } : n)) });
      }
    },
  };
});

/** Back to an empty, unloaded copy (tests). */
export function resetNotesStore(): void {
  placeSeq = new Map();
  placing = new Map();
  useNotesStore.setState({ notes: [], loaded: false, loadFailed: false, error: null });
}
