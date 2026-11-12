// The field logic shared by a task's quick card and its full detail (Tweek board feel spec §3.3):
// text drafts, saving a patch, the save-refused notice, and saving whatever is still being typed
// when the dialog goes. Esc, Close, a backdrop press and Expand deliver no blur, so the unmount does it.
import { useEffect, useRef, useState } from 'react';
import { REMINDER_RE } from '../../shared/planner';
import type { PlannerTask, TaskUpdate } from '../../shared/types';
import { usePlannerStore } from './plannerStore';

/** Caps by code points, never UTF-16 units. */
export const cap = (s: string, max: number): string => [...s].slice(0, max).join('');

/** A text field's draft: it belongs to the saved value it started from, so a change from main drops it. */
function useDraft(value: string): [string, (text: string) => void, () => void] {
  const [draft, setDraft] = useState<{ of: string; text: string } | null>(null);
  const text = draft && draft.of === value ? draft.text : value;
  return [text, (t) => setDraft({ of: value, text: t }), () => setDraft(null)];
}

export interface TaskEditor {
  title: string;
  setTitle(text: string): void;
  commitTitle(): void;
  note: string;
  setNote(text: string): void;
  commitNote(): void;
  reminder: string;
  setReminder(text: string): void;
  commitReminder(): void;
  /** Saves a patch; when main refuses it (the field is still as it was) `saveFailed` says so. */
  save(patch: TaskUpdate): void;
  saveFailed: boolean;
  /** Marks a field as typed in and not yet saved. */
  touch(key: string): void;
  /**
   * Adds a field's commit to what the unmount saves (call it on every render, so the latest typing
   * is the one saved). Returns the commit to use on blur and Enter, which also clears the mark.
   */
  register(key: string, commit: () => void): () => void;
}

export function useTaskEditor(task: PlannerTask): TaskEditor {
  const update = usePlannerStore((s) => s.update);
  const [title, setTitle, clearTitle] = useDraft(task.title);
  const [note, setNote, clearNote] = useDraft(task.note);
  const [reminder, setReminder, clearReminder] = useDraft(task.reminder ?? '');
  const [saveFailed, setSaveFailed] = useState(false);

  // Fields with typing not yet saved.
  const dirty = useRef(new Set<string>());
  const touch = (key: string): void => {
    dirty.current.add(key);
    setSaveFailed(false);
  };

  const save = (patch: TaskUpdate): void => {
    setSaveFailed(false);
    const read = (): Record<string, unknown> | undefined => {
      const t: PlannerTask | undefined = usePlannerStore.getState().tasks[task.id];
      return t ? { ...t } : undefined;
    };
    const before = read();
    void update(task.id, patch).then(() => {
      const now = read();
      if (!before || !now) return;
      const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
      const patched = patch as Record<string, unknown>;
      if (Object.keys(patched).some((k) => !same(now[k], patched[k]) && same(now[k], before[k]))) {
        setSaveFailed(true);
      }
    });
  };

  const commitTitle = (): void => {
    dirty.current.delete('title');
    const next = title.trim();
    // The draft stays until the store echoes the new title, so the field never flashes the old one.
    if (next === '' || next === task.title) clearTitle();
    else save({ title: next });
  };
  const commitNote = (): void => {
    dirty.current.delete('note');
    if (note === task.note) clearNote();
    else save({ note });
  };
  const commitReminder = (): void => {
    dirty.current.delete('reminder');
    if (reminder === (task.reminder ?? '')) clearReminder();
    else if (reminder === '') save({ reminder: null });
    else if (REMINDER_RE.test(reminder)) save({ reminder });
    else clearReminder();
  };

  // This render's commits, the registered ones added as the component renders; the effect below
  // keeps the latest set for the unmount.
  const commits: Record<string, () => void> = {
    title: commitTitle,
    note: commitNote,
    reminder: commitReminder,
  };
  const register = (key: string, commit: () => void): (() => void) => {
    const settle = (): void => {
      dirty.current.delete(key);
      commit();
    };
    commits[key] = settle;
    return settle;
  };

  // Whatever is still pending when the dialog goes (Esc, Close, Expand, another task) is saved, not dropped.
  const latest = useRef(commits);
  useEffect(() => {
    latest.current = commits;
  });
  useEffect(
    () => () => {
      for (const key of [...dirty.current]) latest.current[key]?.();
    },
    [],
  );

  return {
    title,
    setTitle,
    commitTitle,
    note,
    setNote,
    commitNote,
    reminder,
    setReminder,
    commitReminder,
    save,
    saveFailed,
    touch,
    register,
  };
}
