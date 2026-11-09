// The Notes widget's save queue (widgets addendum §4b: notes never lose text). It lives at module
// level, outside the component, so text whose last save failed survives closing the widget: the
// next mount, blur, typing pause or window hide sends it again.
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
let snapshot: NoteSavesSnapshot = { drafts, failing: false };

const changeListeners = new Set<() => void>();
const savedListeners = new Set<(list: Note[]) => void>();

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
    },
  );
}

/** Records typed text: shown at once, sent on the next flush. */
export function editNote(id: number, text: string): void {
  setDraft(id, text);
  pending.set(id, text);
  changed();
}

/** Sends every unsaved text now. A failure puts it back in the queue for the next try. */
export function flushNotes(): void {
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

/** Tests only: start each test with an empty queue. */
export function resetNoteSaves(): void {
  drafts = new Map();
  pending.clear();
  lastSent.clear();
  failed.clear();
  seq = 0;
  savedListeners.clear();
  changed();
}
