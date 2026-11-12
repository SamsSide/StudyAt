// Note stickies (v1.2 spec §3.2, appplan §4.10): a popped-out note floats in its own WidgetFrame,
// like an image widget, after the fixed widgets. It never auto-hides and shows whether or not the
// Notes stack is open. Its body is the editable note in its colour, saving through the same queue
// as the stack (noteSaves.ts: 500 ms after typing stops, at once on blur, 5000 characters).
//
// Framed: the glass with the note's first line as its title, and header buttons for the colour,
// "Hide background" and "Dock back"; the close button is Delete, asked in place as on the stack.
// Bare: no glass, no header, just a square of coloured paper with the text. The paper is the drag
// handle except over the text (`data-no-drag`), and a toolbar fades in on hover or focus with
// Show background · Dock back · colour · Delete, plus the frame's keyboard move handle.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Note, TaskColour } from '../../shared/types';
import shell from '../shell/shell.module.css';
import { type FramePatch, WidgetFrame } from '../shell/WidgetFrame';
import { Icon } from '../shell/icons';
import { TASK_COLOURS } from '../tasks/taskColours';
import notes from './NotesWidget.module.css';
import { AUTOSAVE_MS, MAX_NOTE_LENGTH, useAdoptSavedNotes } from './NotesWidget';
import { attachNotesWidget, editNote, flushNotes, forgetNote, useNoteSaves } from './noteSaves';
import { DockBackIcon } from './noteIcons';
import { SAVE_FAILED, useNotesStore } from './notesStore';
import styles from './stickies.module.css';

/** Spec §3.2: a sticky's title is the note's first line when it is 1–30 characters. */
const TITLE_MAX = 30;

/** Where a note with no stored spot sits: main's first cascade step (spec §3.2). */
const FALLBACK = { x: 0.5, y: 0.3 };

/** The note's first line if it is 1–30 characters (ends trimmed), else "Note". */
export function stickyTitle(text: string): string {
  const first = (text.split('\n')[0] ?? '').trim();
  return first.length >= 1 && first.length <= TITLE_MAX ? first : 'Note';
}

/** Every popped-out note, in stack order. */
export function NoteStickies() {
  const all = useNotesStore((s) => s.notes);
  useAdoptSavedNotes();
  return (
    <>
      {all
        .filter((n) => n.popped)
        .map((n) => (
          <NoteSticky key={n.id} note={n} />
        ))}
    </>
  );
}

export function NoteSticky({ note }: { note: Note }) {
  const { drafts, failing } = useNoteSaves();
  const storeError = useNotesStore((s) => s.error);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const timer = useRef<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const reopened = useRef(false);

  const flush = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    flushNotes();
  };

  // A sticky is an open editor like the stack: while one is up, timed retries wait for its next
  // blur or pause; leaving (docked, deleted, the app closing) sends what was typed.
  useEffect(() => {
    const detach = attachNotesWidget();
    return () => {
      detach();
      if (timer.current !== null) window.clearTimeout(timer.current);
      flushNotes();
    };
  }, []);

  // The safe choice has focus while asking; afterwards focus goes back where the question came from.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (reopened.current) {
      reopened.current = false;
      const back = opener.current?.isConnected ? opener.current : deleteRef.current;
      back?.focus();
    }
  }, [confirming]);

  const text = drafts.get(note.id) ?? note.text;
  const title = stickyTitle(text);
  const store = useNotesStore.getState;

  const type = (value: string): void => {
    editNote(note.id, value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  };

  const ask = (): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPicking(false);
    setConfirming(true);
  };
  const cancel = (): void => {
    reopened.current = true;
    setConfirming(false);
  };
  const onConfirmKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    // Esc answers the question and goes no further (useShortcuts skips a handled key).
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  const confirmDelete = async (): Promise<void> => {
    const id = note.id;
    await store().remove(id);
    // Kept until main has really deleted the note, so a failed delete loses no words.
    if (store().notes.some((n) => n.id === id)) {
      setConfirming(false);
      return;
    }
    forgetNote(id);
  };
  const dockBack = (): void => {
    flush();
    void store().dockBack(note.id);
  };
  const recolour = (colour: TaskColour): void => {
    setPicking(false);
    if (colour !== note.colour) void store().setColour(note.id, colour);
  };
  const setBare = (bare: boolean): void => void store().place(note.id, { bare });
  const onPatch = (p: FramePatch): void => void store().place(note.id, p);

  const error =
    storeError?.id === note.id ? storeError.text : failing && drafts.has(note.id) ? SAVE_FAILED : null;

  const colourButton = (
    <button
      type="button"
      className={`${shell.iconButton} ${shell.small} ${note.bare ? shell.bareHandle : ''}`}
      aria-label="Note colour"
      title="Note colour"
      aria-expanded={picking}
      onClick={() => setPicking((p) => !p)}
    >
      <span className={`${styles.colourDot} ${notes[note.colour] ?? ''}`} aria-hidden="true" />
    </button>
  );

  const confirm = (
    <div className={styles.confirm} role="group" aria-label="Delete this note?" onKeyDown={onConfirmKey}>
      <span className={styles.confirmText}>Delete this note?</span>
      <button ref={cancelRef} type="button" className={notes.textButton} onClick={cancel}>
        Cancel
      </button>
      <button type="button" className={notes.dangerButton} onClick={() => void confirmDelete()}>
        Delete
      </button>
    </div>
  );

  const swatches = picking && (
    <div className={styles.swatches} role="group" aria-label="Choose a colour">
      {TASK_COLOURS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`${notes.swatch} ${notes[c.id] ?? ''}`}
          aria-label={c.label}
          title={c.label}
          aria-pressed={note.colour === c.id}
          onClick={() => recolour(c.id)}
        />
      ))}
    </div>
  );

  const paper = (
    <div
      className={`${styles.paper} ${note.bare ? styles.bare : notes.sheet} ${notes[note.colour] ?? ''}`}
      data-colour={note.colour}
      style={note.bare ? { backgroundColor: `var(--note-${note.colour})` } : undefined}
    >
      <textarea
        className={`${notes.text} ${styles.text}`}
        aria-label="Note text"
        placeholder="Write a note…"
        maxLength={MAX_NOTE_LENGTH}
        spellCheck
        value={text}
        data-no-drag
        onChange={(e) => type(e.target.value)}
        onBlur={flush}
      />
    </div>
  );

  const body = (
    <div className={styles.sticky}>
      {swatches}
      {paper}
      {confirming && !note.bare && confirm}
      {error && (
        <p className={`${notes.error} ${note.bare ? styles.bareError : ''}`} role="status">
          {error}
        </p>
      )}
    </div>
  );

  const pos = { x: note.x ?? FALLBACK.x, y: note.y ?? FALLBACK.y, scale: note.scale, autoHide: false };

  if (note.bare) {
    return (
      <WidgetFrame
        title={title}
        chrome="bare"
        interactiveBody
        pos={pos}
        onPatch={onPatch}
        headerExtra={
          confirming ? (
            confirm
          ) : (
            <>
              <button type="button" className={shell.toolText} onClick={() => setBare(false)}>
                Show background
              </button>
              <button type="button" className={shell.toolText} onClick={dockBack}>
                Dock back
              </button>
              {colourButton}
              <button ref={deleteRef} type="button" className={shell.toolText} onClick={ask}>
                Delete
              </button>
            </>
          )
        }
      >
        {body}
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame
      title={title}
      pos={pos}
      onPatch={onPatch}
      onClose={ask}
      closeLabel="Delete note"
      closeIcon="trash"
      headerExtra={
        <>
          {colourButton}
          <button
            type="button"
            className={`${shell.iconButton} ${shell.small}`}
            aria-label="Hide background"
            title="Hide background"
            onClick={() => setBare(true)}
          >
            <Icon name="eyeOff" />
          </button>
          <button
            type="button"
            className={`${shell.iconButton} ${shell.small}`}
            aria-label="Dock back"
            title="Dock back"
            onClick={dockBack}
          >
            <DockBackIcon />
          </button>
        </>
      }
    >
      {body}
    </WidgetFrame>
  );
}
