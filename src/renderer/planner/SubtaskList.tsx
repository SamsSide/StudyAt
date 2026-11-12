// A task's subtasks (v1.2 spec §3.6): tick, rename, move up or down, delete, and an add field that
// is disabled at MAX_SUBTASKS. Every change goes through the planner store's subtask commands.
import { useState } from 'react';
import { LIMIT_COPY, MAX_SUBTASKS, SUBTASK_TEXT_MAX } from '../../shared/planner';
import type { PlannerTask, Subtask } from '../../shared/types';
import { usePlannerStore } from './plannerStore';
import styles from './detail.module.css';

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

  const commit = (): void => {
    const next = text.trim();
    setDraft(null);
    if (next === '' || next === sub.text) return;
    void update(sub.id, { text: next });
  };

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
        onChange={(e) => setDraft({ of: sub.text, text: capText(e.target.value) })}
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
    </li>
  );
}

export function SubtaskList({ task }: { task: PlannerTask }) {
  const add = usePlannerStore((s) => s.addSubtask);
  const reorder = usePlannerStore((s) => s.reorderSubtasks);
  const [text, setText] = useState('');
  const full = task.subtasks.length >= MAX_SUBTASKS;

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
        disabled={full}
        title={full ? LIMIT_COPY.subtasks : undefined}
        onChange={(e) => setText(capText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const next = text.trim();
          if (next === '') return;
          setText('');
          void add(task.id, next);
        }}
      />
    </div>
  );
}
