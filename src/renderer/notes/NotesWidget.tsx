// The Notes widget body (widgets addendum §4b): sticky notes like macOS Stickies, one at a time as a
// soft coloured sheet. A header row switches notes (‹ › and a dot strip), adds one and deletes one
// (asked in place); six colours below. Text autosaves 500 ms after typing stops and at once on blur,
// on switching notes, on hiding the window and on unmount. The shell's WidgetFrame supplies the
// glass container and title.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Note } from '../../shared/types';
import { Icon } from '../shell/icons';
import { TASK_COLOURS } from '../tasks/taskColours';
import styles from './NotesWidget.module.css';

/** Addendum §4b: a note holds at most 5 000 characters. */
export const MAX_NOTE_LENGTH = 5000;
/** Addendum §4b: save this long after the last keystroke. */
export const AUTOSAVE_MS = 500;
/** Past this many notes the dot strip becomes a "3 / 15" count. */
const MAX_DOTS = 12;

const SAVE_FAILED = "Couldn't save this note. It's still here — try again.";
const ADD_FAILED = "Couldn't add a note. Try again.";
const DELETE_FAILED = "Couldn't delete this note. Try again.";

const bySort = (list: Note[]): Note[] => [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);

export function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  // Text typed but not yet confirmed by main, per note: the sheet always shows this over main's copy,
  // so a slow or failed save never takes words away.
  const [drafts, setDrafts] = useState<ReadonlyMap<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // What still has to go to main, and the autosave timer. Refs, so the unmount and window-hide
  // flushes see the latest without re-subscribing.
  const pending = useRef(new Map<number, string>());
  const timer = useRef<number | null>(null);
  const live = useRef(true);
  const sheetRef = useRef<HTMLTextAreaElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'sheet' | 'delete' | 'cancel' | null>(null);

  const adopt = useCallback((list: Note[]) => {
    if (!live.current) return;
    setNotes(bySort(list));
    setLoaded(true);
    setLoadFailed(false);
  }, []);

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  /** Sends every unsaved text now. A failure puts it back in the queue for the next try. */
  const flush = useCallback(() => {
    clearTimer();
    const queue = [...pending.current];
    pending.current.clear();
    for (const [id, text] of queue) {
      window.studyat.notes.update(id, { text }).then(
        (list) => {
          if (!live.current) return;
          adopt(list);
          setError(null);
          // Main has this text now; a newer draft (typed while it was in flight) stays.
          setDrafts((d) => {
            if (d.get(id) !== text) return d;
            const next = new Map(d);
            next.delete(id);
            return next;
          });
        },
        () => {
          if (!pending.current.has(id)) pending.current.set(id, text);
          if (live.current) setError(SAVE_FAILED);
        },
      );
    }
  }, [adopt]);

  const load = useCallback(async () => {
    try {
      adopt(await window.studyat.notes.list());
    } catch {
      if (live.current) setLoadFailed(true);
    }
  }, [adopt]);

  useEffect(() => {
    live.current = true;
    void load();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Main also says when the window hides to the tray or minimises.
    const stopVisibility = window.studyat.app.onVisibility((visible) => {
      if (!visible) flush();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopVisibility();
      flush();
      live.current = false;
    };
  }, [load, flush]);

  const index = Math.max(
    0,
    notes.findIndex((n) => n.id === currentId),
  );
  const current = notes[index] ?? null;
  const text = current ? (drafts.get(current.id) ?? current.text) : '';

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el =
      target === 'sheet' ? sheetRef.current : target === 'delete' ? deleteRef.current : cancelRef.current;
    el?.focus();
  });

  /** A mutation other than typing; every call returns the whole list. */
  const run = async (call: () => Promise<Note[]>, failure: string): Promise<Note[] | null> => {
    try {
      const list = await call();
      adopt(list);
      setError(null);
      return bySort(list);
    } catch {
      if (!live.current) return null;
      setError(failure);
      try {
        adopt(await window.studyat.notes.list());
      } catch {
        // Keep what is on screen; the message already says what happened.
      }
      return null;
    }
  };

  const type = (value: string): void => {
    if (!current) return;
    const id = current.id;
    setDrafts((d) => new Map(d).set(id, value));
    pending.current.set(id, value);
    clearTimer();
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  };

  const show = (id: number): void => {
    flush();
    setConfirming(false);
    setCurrentId(id);
  };

  const add = async (): Promise<void> => {
    flush();
    setConfirming(false);
    const list = await run(() => window.studyat.notes.create(), ADD_FAILED);
    const last = list?.[list.length - 1];
    if (!last) return;
    setCurrentId(last.id);
    focusNext.current = 'sheet';
  };

  const recolour = (colour: Note['colour']): void => {
    if (!current || current.colour === colour) return;
    flush();
    const id = current.id;
    void run(() => window.studyat.notes.update(id, { colour }), SAVE_FAILED);
  };

  const askDelete = (): void => {
    setConfirming(true);
    focusNext.current = 'cancel';
  };

  const cancelDelete = (): void => {
    setConfirming(false);
    focusNext.current = 'delete';
  };

  const confirmDelete = async (): Promise<void> => {
    if (!current) return;
    const id = current.id;
    // The note is going: its unsaved text goes with it, unsent.
    if (pending.current.delete(id) && pending.current.size === 0) clearTimer();
    setDrafts((d) => {
      const next = new Map(d);
      next.delete(id);
      return next;
    });
    const list = await run(() => window.studyat.notes.remove(id), DELETE_FAILED);
    setConfirming(false);
    if (!list) return;
    const neighbour = list[Math.min(index, list.length - 1)];
    setCurrentId(neighbour?.id ?? null);
    focusNext.current = neighbour ? 'sheet' : null;
  };

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
          <p className={styles.message}>No notes yet.</p>
          <button type="button" className={styles.primaryButton} onClick={() => void add()}>
            <Icon name="plus" />
            New note
          </button>
          {error && (
            <p className={styles.error} role="status">
              {error}
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
        <div className={styles.toolbar} role="group" aria-label="Delete this note?">
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
      {error && (
        <p className={styles.error} role="status">
          {error}
        </p>
      )}
    </div>
  );
}
