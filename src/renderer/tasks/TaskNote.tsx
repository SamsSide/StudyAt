// One sticky note (spec §3.10): tick box, click-to-edit text, a colour picker and a drag handle.
// Open notes are reorderable; done notes are plain and can be un-ticked.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Task, TaskColour } from '../../shared/types';
import styles from './TasksWidget.module.css';
import { clampTaskText, MAX_TASK_LENGTH, TASK_COLOURS } from './taskColours';

export interface TaskNoteProps {
  task: Task;
  dragging?: boolean;
  onToggle(task: Task): void;
  onEditText(task: Task, text: string): void;
  onColour(task: Task, colour: TaskColour): void;
  /** Open notes only: pointer handlers for the drag handle. */
  dragHandlers?: {
    onPointerDown(e: PointerEvent<HTMLButtonElement>, task: Task): void;
    onPointerMove(e: PointerEvent<HTMLButtonElement>): void;
    onPointerEnd(e: PointerEvent<HTMLButtonElement>): void;
  };
  /** Open notes only: Alt+ArrowUp/Down on the focused note. */
  onMove?(task: Task, delta: -1 | 1): void;
}

export function ColourSwatches({
  label,
  value,
  onPick,
}: {
  label: string;
  value: TaskColour;
  onPick(colour: TaskColour): void;
}) {
  return (
    <div className={styles.swatches} role="group" aria-label={label}>
      {TASK_COLOURS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`${styles.swatch} ${styles[c.id]}`}
          aria-label={c.label}
          aria-pressed={value === c.id}
          title={c.label}
          onClick={() => onPick(c.id)}
        />
      ))}
    </div>
  );
}

export function TaskNote({ task, dragging, onToggle, onEditText, onColour, dragHandlers, onMove }: TaskNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc unmounts the input, which must not then count as a "blur saves".
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    cancelled.current = false;
    setDraft(task.text);
    setEditing(true);
  };

  const finishEdit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const text = clampTaskText(draft);
    if (text && text !== task.text) onEditText(task, text);
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc here cancels the edit, not whatever the shell would close
      cancelled.current = true;
      setEditing(false);
    }
  };

  const onNoteKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!onMove || !e.altKey || editing) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(task, e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  const classes = [styles.note, styles[task.colour], task.done ? styles.doneNote : '', dragging ? styles.dragging : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes} data-task-id={task.id} onKeyDown={onNoteKey}>
      <div className={styles.noteRow}>
        {dragHandlers && (
          <button
            type="button"
            className={styles.handle}
            aria-label={`Drag to reorder: ${task.text}`}
            title="Drag to reorder, or Alt + Up / Down"
            onPointerDown={(e) => dragHandlers.onPointerDown(e, task)}
            onPointerMove={dragHandlers.onPointerMove}
            onPointerUp={dragHandlers.onPointerEnd}
            onPointerCancel={dragHandlers.onPointerEnd}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        )}
        <input
          type="checkbox"
          className={styles.check}
          checked={task.done}
          aria-label={task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`}
          onChange={() => onToggle(task)}
        />
        {editing ? (
          <input
            ref={inputRef}
            className={styles.editInput}
            value={draft}
            maxLength={MAX_TASK_LENGTH}
            aria-label="Edit task"
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_TASK_LENGTH))}
            onKeyDown={onEditKey}
            onBlur={finishEdit}
          />
        ) : task.done ? (
          <span className={styles.text}>{task.text}</span>
        ) : (
          <button type="button" className={styles.textButton} onClick={startEdit} title="Click to edit">
            {task.text}
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Change colour of "${task.text}"`}
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          <span aria-hidden="true" className={styles.dot} />
        </button>
      </div>
      {picking && (
        <ColourSwatches
          label="Note colour"
          value={task.colour}
          onPick={(c) => {
            setPicking(false);
            if (c !== task.colour) onColour(task, c);
          }}
        />
      )}
    </li>
  );
}
