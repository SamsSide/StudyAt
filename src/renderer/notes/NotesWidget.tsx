// The Notes widget body (widgets addendum §4b): sticky notes like macOS Stickies, one at a time as a
// soft coloured sheet. A header row switches notes (‹ › and a dot strip), adds one, pops one out as
// a floating sticky (v1.2 spec §3.2) and deletes one (asked in place); six colours below. The stack
// shows only the notes not popped out; with all of them out it says so and still offers New note.
// Text autosaves 500 ms after typing stops and at once on blur, on switching notes, on hiding the
// window and on unmount; text whose save failed waits in the module-level queue (noteSaves.ts) and
// goes again on the next try, even after the widget closes. The notes themselves live in
// notesStore.ts, shared with the stickies. The shell's WidgetFrame supplies the glass and title.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LIMIT_COPY, MAX_POPPED_NOTES } from '../../shared/limits';
import type { Note } from '../../shared/types';
import { Icon } from '../shell/icons';
import { TASK_COLOURS } from '../tasks/taskColours';
import styles from './NotesWidget.module.css';
import { attachNotesWidget, editNote, flushNotes, forgetNote, onNotesSaved, useNoteSaves } from './noteSaves';
import { PopOutIcon } from './noteIcons';
import { SAVE_FAILED, useNotesStore } from './notesStore';

/** Addendum §4b: a note holds at most 5 000 characters. */
export const MAX_NOTE_LENGTH = 5000;
/** Addendum §4b: save this long after the last keystroke. */
export const AUTOSAVE_MS = 500;
/** Past this many notes the dot strip becomes a "3 / 15" count. */
const MAX_DOTS = 12;

/** Main's answers to text saves go into the shared copy; mounted by the stack and the stickies. */
export function useAdoptSavedNotes(): void {
  useEffect(
    () =>
      onNotesSaved((list) => {
        useNotesStore.getState().adopt(list);
        useNotesStore.getState().clearError();
      }),
    [],
  );
}

export function NotesWidget() {
  const all = useNotesStore((s) => s.notes);
  const loaded = useNotesStore((s) => s.loaded);
  const loadFailed = useNotesStore((s) => s.loadFailed);
  const storeError = useNotesStore((s) => s.error);
  // The shown note, and where it sat: when it leaves the stack (deleted, popped out) the note now at
  // that place shows instead, or the last one.
  const [shown, setShown] = useState<{ id: number | null; at: number }>({ id: null, at: 0 });
  // Text typed but not yet confirmed by main, per note: the sheet always shows this over main's copy,
  // so a slow or failed save never takes words away.
  const { drafts, failing } = useNoteSaves();
  const [confirming, setConfirming] = useState(false);

  const timer = useRef<number | null>(null);
  const sheetRef = useRef<HTMLTextAreaElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'sheet' | 'delete' | 'cancel' | 'new' | 'pop' | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  /** Sends every unsaved text now (the queue keeps any that fail for the next try). */
  const flush = useCallback(() => {
    clearTimer();
    flushNotes();
  }, []);

  const load = (): Promise<void> => useNotesStore.getState().load();

  useAdoptSavedNotes();
  useEffect(() => {
    void useNotesStore.getState().load();
    const detach = attachNotesWidget();
    // Text left over from a save that failed after the widget last closed goes again now.
    flush();
    // Hiding the window (visibilitychange, pagehide, main's onVisibility) flushes through the
    // queue's own listener in noteSaves.ts, open or closed.
    return () => {
      detach();
      flush();
    };
  }, [flush]);

  const notes = all.filter((n) => !n.popped);
  const popped = all.length - notes.length;
  const found = notes.findIndex((n) => n.id === shown.id);
  const index = found >= 0 ? found : Math.max(0, Math.min(shown.at, notes.length - 1));
  const current = notes[index] ?? null;
  const text = current ? (drafts.get(current.id) ?? current.text) : '';

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const refs = { sheet: sheetRef, delete: deleteRef, cancel: cancelRef, new: newRef, pop: popRef };
    // With the last note popped out the stack's only button is New note.
    (refs[target].current ?? (target === 'pop' ? newRef.current : null))?.focus();
  });

  const type = (value: string): void => {
    if (!current) return;
    editNote(current.id, value);
    clearTimer();
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  };

  const show = (id: number): void => {
    flush();
    setConfirming(false);
    setShown({ id, at: notes.findIndex((n) => n.id === id) });
  };

  const add = async (): Promise<void> => {
    flush();
    setConfirming(false);
    const list = await useNotesStore.getState().create();
    const stack = list?.filter((n) => !n.popped) ?? [];
    const last = stack.at(-1);
    if (!last) return;
    setShown({ id: last.id, at: stack.length - 1 });
    focusNext.current = 'sheet';
  };

  const recolour = (colour: Note['colour']): void => {
    if (!current || current.colour === colour) return;
    flush();
    void useNotesStore.getState().setColour(current.id, colour);
  };

  /** Spec §3.2: the shown note floats off as a sticky and the stack moves on to the next one. */
  const popOut = async (): Promise<void> => {
    if (!current) return;
    flush();
    setConfirming(false);
    // Set first: the store's answer is what renders next, and focus lands then.
    focusNext.current = 'pop';
    await useNotesStore.getState().popOut(current.id);
  };

  const askDelete = (): void => {
    setConfirming(true);
    focusNext.current = 'cancel';
  };

  const cancelDelete = (): void => {
    setConfirming(false);
    focusNext.current = 'delete';
  };

  /** Esc answers the question with Cancel, and stays here rather than closing the shell's panel. */
  const onConfirmKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancelDelete();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!current) return;
    const id = current.id;
    await useNotesStore.getState().remove(id);
    setConfirming(false);
    // Kept until main has really deleted the note, so a failed delete loses no words.
    if (useNotesStore.getState().notes.some((n) => n.id === id)) return;
    forgetNote(id);
    const left = useNotesStore.getState().notes.some((n) => !n.popped);
    focusNext.current = left ? 'sheet' : 'new';
  };

  // A sticky's own failure is said on that sticky.
  const error = storeError && !all.some((n) => n.id === storeError.id && n.popped) ? storeError.text : null;
  // Another failure's message first; otherwise the save message stays while a failed save waits.
  const shownError = error ?? (failing ? SAVE_FAILED : null);
  const atLimit = popped >= MAX_POPPED_NOTES;

  if (loadFailed && !loaded) {
    return (
      <div className={styles.widget}>
        <div className={styles.state}>
          <p className={styles.message}>Couldn't load your notes.</p>
          <button type="button" className={styles.textButton} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) return <div className={styles.widget} aria-busy="true" />;

  if (!current) {
    return (
      <div className={styles.widget}>
        <div className={styles.state}>
          <p className={styles.message}>
            {all.length > 0 ? 'All your notes are on the screen.' : 'No notes yet.'}
          </p>
          <button ref={newRef} type="button" className={styles.primaryButton} onClick={() => void add()}>
            <Icon name="plus" />
            New note
          </button>
          {shownError && (
            <p className={styles.error} role="status">
              {shownError}
            </p>
          )}
        </div>
      </div>
    );
  }

  const count = notes.length;
  const colourClass = styles[current.colour] ?? '';

  return (
    <div className={styles.widget}>
      {confirming ? (
        <div className={styles.toolbar} role="group" aria-label="Delete this note?" onKeyDown={onConfirmKey}>
          <span className={styles.confirmText}>Delete this note?</span>
          <button ref={cancelRef} type="button" className={styles.textButton} onClick={cancelDelete}>
            Cancel
          </button>
          <button type="button" className={styles.dangerButton} onClick={() => void confirmDelete()}>
            Delete
          </button>
        </div>
      ) : (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.tool}
            aria-label="Previous note"
            title="Previous note"
            disabled={index === 0}
            onClick={() => show(notes[index - 1]!.id)}
          >
            <Icon name="chevronLeft" />
          </button>
          <div className={styles.dots} role="group" aria-label="Choose a note">
            {count > MAX_DOTS ? (
              <span className={styles.counter}>
                {index + 1} / {count}
              </span>
            ) : (
              notes.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  className={`${styles.dot} ${styles[n.colour] ?? ''}`}
                  aria-label={`Note ${i + 1} of ${count}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => show(n.id)}
                />
              ))
            )}
          </div>
          <button
            type="button"
            className={styles.tool}
            aria-label="Next note"
            title="Next note"
            disabled={index === count - 1}
            onClick={() => show(notes[index + 1]!.id)}
          >
            <Icon name="chevronRight" />
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.tool}
            aria-label="New note"
            title="New note"
            onClick={() => void add()}
          >
            <Icon name="plus" />
          </button>
          <button
            ref={popRef}
            type="button"
            className={styles.tool}
            aria-label="Pop out note"
            title={atLimit ? LIMIT_COPY.notes : 'Pop out'}
            disabled={atLimit}
            onClick={() => void popOut()}
          >
            <PopOutIcon />
          </button>
          <button
            ref={deleteRef}
            type="button"
            className={styles.tool}
            aria-label="Delete note"
            title="Delete note"
            onClick={askDelete}
          >
            <Icon name="trash" />
          </button>
        </div>
      )}

      <div className={`${styles.sheet} ${colourClass}`}>
        <textarea
          key={current.id}
          ref={sheetRef}
          className={styles.text}
          aria-label={`Note ${index + 1} of ${count}`}
          placeholder="Write a note…"
          maxLength={MAX_NOTE_LENGTH}
          spellCheck
          value={text}
          onChange={(e) => type(e.target.value)}
          onBlur={flush}
        />
      </div>

      <div className={styles.footer}>
        <div className={styles.swatches} role="group" aria-label="Note colour">
          {TASK_COLOURS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.swatch} ${styles[c.id] ?? ''}`}
              aria-label={c.label}
              title={c.label}
              aria-pressed={current.colour === c.id}
              onClick={() => recolour(c.id)}
            />
          ))}
        </div>
      </div>
      {shownError && (
        <p className={styles.error} role="status">
          {shownError}
        </p>
      )}
    </div>
  );
}
