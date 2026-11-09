// The Notes widget's save queue (widgets addendum §4b: notes never lose text). It lives at module
// level, outside the component, so text whose last save failed survives closing the widget: the
// next mount, blur, typing pause or window hide sends it again. One module-level listener (installed
// once) flushes on the window hiding even while the widget is closed, and a save that fails while it
// is closed is retried a few times on its own.
//
// - `drafts`: text main hasn't confirmed, per note. The sheet shows it over main's copy.
// - `pending`: text still to send.
// - Each send gets a sequence number per note; a failed save is queued again only if nothing newer
//   for that note has been sent since, so an old failure can never overwrite newer text.
import { useSyncExternalStore } from 'react';
import type { Note } from '../../shared/types';

export interface NoteSavesSnapshot {
  /** Text main hasn't confirmed yet, per note id. */
  readonly drafts: ReadonlyMap<number, string>;
  /** A save failed and its text is still waiting to go. */
  readonly failing: boolean;
}

let drafts = new Map<number, string>();
const pending = new Map<number, string>();
const lastSent = new Map<number, number>();
const failed = new Set<number>();
let seq = 0;
/** How many Notes widgets are open; timed retries run only while none is. */
let mounted = 0;
let retries = 0;
let retryTimer: number | null = null;
let stopListening: (() => void) | null = null;
let snapshot: NoteSavesSnapshot = { drafts, failing: false };

const changeListeners = new Set<() => void>();
const savedListeners = new Set<(list: Note[]) => void>();

/** A save that fails while the widget is closed is tried again this many times, this far apart. */
export const CLOSED_RETRIES = 3;
export const CLOSED_RETRY_MS = 2000;

function cancelRetry(): void {
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
}

/** With the widget closed nothing else would send a failed save, so try again a few times. */
function scheduleRetry(): void {
  if (mounted > 0 || retryTimer !== null || retries >= CLOSED_RETRIES) return;
  retries += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    flushNotes();
  }, CLOSED_RETRY_MS);
}

/** Flushes when the window hides, whether or not the widget is open. Installed once. */
function listen(): void {
  if (stopListening) return;
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') flushNotes();
  };
  const onPageHide = (): void => flushNotes();
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onPageHide);
  // Main also says when the window hides to the tray or minimises.
  const stopVisibility = window.studyat.app.onVisibility((visible) => {
    if (!visible) flushNotes();
  });
  stopListening = () => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onPageHide);
    stopVisibility();
  };
}

function changed(): void {
  snapshot = { drafts, failing: failed.size > 0 };
  for (const l of changeListeners) l();
}

function setDraft(id: number, text: string | null): void {
  const next = new Map(drafts);
  if (text === null) next.delete(id);
  else next.set(id, text);
  drafts = next;
}

function send(id: number, text: string): void {
  const n = ++seq;
  lastSent.set(id, n);
  window.studyat.notes.update(id, { text }).then(
    (list) => {
      if (lastSent.get(id) === n) failed.delete(id);
      if (failed.size === 0) retries = 0;
      // Main has this text now; a newer draft (typed while it was in flight) stays.
      if (drafts.get(id) === text && !pending.has(id)) setDraft(id, null);
      changed();
      for (const l of savedListeners) l(list);
    },
    () => {
      // Newer text for this note has gone since (or the note was deleted): this one is stale.
      if (lastSent.get(id) !== n) return;
      if (!pending.has(id)) pending.set(id, text);
      failed.add(id);
      changed();
      scheduleRetry();
    },
  );
}

/** Records typed text: shown at once, sent on the next flush. */
export function editNote(id: number, text: string): void {
  listen();
  retries = 0;
  setDraft(id, text);
  pending.set(id, text);
  changed();
}

/** Sends every unsaved text now. A failure puts it back in the queue for the next try. */
export function flushNotes(): void {
  listen();
  cancelRetry();
  const queue = [...pending];
  pending.clear();
  for (const [id, text] of queue) send(id, text);
}

/** Drops everything held for a note main has deleted. */
export function forgetNote(id: number): void {
  pending.delete(id);
  failed.delete(id);
  // Any save still in flight for it is now stale and won't be queued again.
  lastSent.set(id, ++seq);
  setDraft(id, null);
  changed();
}

/** The widget says it is open; returns the call that says it closed. */
export function attachNotesWidget(): () => void {
  listen();
  mounted += 1;
  cancelRetry();
  retries = 0;
  return () => {
    mounted -= 1;
  };
}

/** Calls `listener` with main's whole list after each successful text save. */
export function onNotesSaved(listener: (list: Note[]) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

function subscribe(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** The drafts and whether a failed save is still waiting, kept in step with the queue. */
export function useNoteSaves(): NoteSavesSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Tests only: start each test with an empty queue and no listeners (each test has its own bridge). */
export function resetNoteSaves(): void {
  stopListening?.();
  stopListening = null;
  cancelRetry();
  retries = 0;
  mounted = 0;
  drafts = new Map();
  pending.clear();
  lastSent.clear();
  failed.clear();
  seq = 0;
  savedListeners.clear();
  changed();
}
