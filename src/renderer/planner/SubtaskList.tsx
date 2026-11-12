// A task's subtasks (v1.2 spec §3.6): tick, rename, move up or down, delete, and an add field that
// is aria-disabled at MAX_SUBTASKS, with a hint. Every change goes through the planner store's subtask
// commands. A rename in progress is saved when the row goes away (the dialog closing), not lost.
import { useEffect, useId, useRef, useState } from 'react';
import { LIMIT_COPY, MAX_SUBTASKS, SUBTASK_TEXT_MAX } from '../../shared/planner';
import type { PlannerTask, Subtask } from '../../shared/types';
import { usePlannerStore } from './plannerStore';
import styles from './detail.module.css';

/** Shown when main refuses a save and the text is left as typed. */
export const SAVE_FAILED = "Couldn't save that. Try again.";

/** Caps by code points, never UTF-16 units. */
const capText = (s: string): string => [...s].slice(0, SUBTASK_TEXT_MAX).join('');

interface RowProps {
  sub: Subtask;
  first: boolean;
  last: boolean;
  onMove(delta: -1 | 1): void;
}

function SubtaskRow({ sub, first, last, onMove }: RowProps) {
  const update = usePlannerStore((s) => s.updateSubtask);
  const remove = usePlannerStore((s) => s.removeSubtask);
  // A draft belongs to the text it was started from; a change from main drops it.
  const [draft, setDraft] = useState<{ of: string; text: string } | null>(null);
  const text = draft && draft.of === sub.text ? draft.text : sub.text;

  const [failed, setFailed] = useState(false);
  const dirty = useRef(false);
  const commit = (): void => {
    dirty.current = false;
    const next = text.trim();
    // The draft stays until main's echo changes `sub.text`, so the field never flashes the old text.
    if (next === '' || next === sub.text) {
      setDraft(null);
      return;
    }
    setFailed(false);
    void update(sub.id, { text: next }).then(() => {
      const now = usePlannerStore.getState().tasks[sub.taskId]?.subtasks.find((x) => x.id === sub.id);
      if (now && now.text === sub.text) setFailed(true);
    });
  };
  // Unmounting (Esc, Close) delivers no blur, so save what is pending.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(
    () => () => {
      if (dirty.current) latest.current();
    },
    [],
  );

  return (
    <li className={styles.subtask} data-done={sub.done}>
      <input
        type="checkbox"
        className={styles.check}
        checked={sub.done}
        aria-label={`Tick "${sub.text}"`}
        onChange={() => void update(sub.id, { done: !sub.done })}
      />
      <input
        className={styles.subtaskText}
        aria-label={`Subtask ${sub.text}`}
        value={text}
        onChange={(e) => {
          dirty.current = true;
          setFailed(false);
          setDraft({ of: sub.text, text: capText(e.target.value) });
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Move "${sub.text}" up`}
        disabled={first}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Move "${sub.text}" down`}
        disabled={last}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Delete "${sub.text}"`}
        onClick={() => void remove(sub.id)}
      >
        ×
      </button>
      {failed && (
        <p role="alert" className={styles.hint}>
          {SAVE_FAILED}
        </p>
      )}
    </li>
  );
}

export function SubtaskList({ task }: { task: PlannerTask }) {
  const add = usePlannerStore((s) => s.addSubtask);
  const reorder = usePlannerStore((s) => s.reorderSubtasks);
  const [text, setText] = useState('');
  const full = task.subtasks.length >= MAX_SUBTASKS;
  const hintId = useId();

  const move = (index: number, delta: -1 | 1): void => {
    const ids = task.subtasks.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    if (id === undefined) return;
    ids.splice(index + delta, 0, id);
    void reorder(task.id, ids);
  };

  return (
    <div className={styles.subtasks}>
      {task.subtasks.length > 0 && (
        <ul className={styles.subtaskList} aria-label="Subtask list">
          {task.subtasks.map((sub, i) => (
            <SubtaskRow
              key={sub.id}
              sub={sub}
              first={i === 0}
              last={i === task.subtasks.length - 1}
              onMove={(d) => move(i, d)}
            />
          ))}
        </ul>
      )}
      <input
        className={styles.input}
        aria-label="Add a subtask"
        placeholder="Add a subtask"
        value={text}
        aria-disabled={full || undefined}
        aria-describedby={full ? hintId : undefined}
        readOnly={full}
        onChange={(e) => {
          if (!full) setText(capText(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (full) return;
          const next = text.trim();
          if (next === '') return;
          setText('');
          void add(task.id, next);
        }}
      />
      {full && (
        <p id={hintId} className={styles.hint}>
          {LIMIT_COPY.subtasks}
        </p>
      )}
    </div>
  );
}
