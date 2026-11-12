// A board column's ruled lines (v1.2 spec §3.7, a Tweek page): one task per line (a long title wraps
// onto the next rule), the quick-add on the first empty line, then blank lines to `rows`. Shared by
// the day columns and the list columns. The column grows with its tasks and the board scrolls as one
// page; a column never scrolls inside itself.
import { Fragment, useRef, type MouseEvent } from 'react';
import type { PlannerTask } from '../../../shared/types';
import { SortableTask } from '../dnd';
import { QuickAdd } from '../QuickAdd';
import { InsertLine, useInsertHint } from './BoardDrag';
import styles from './board.module.css';

interface Props {
  zone: string;
  tasks: PlannerTask[];
  addLabel: string;
  place: { day: string } | { listId: number };
  /** Lines shown even when empty: the tasks, the add line and the blanks. */
  rows: number;
}

export function RuledLines({ zone, tasks, addLabel, place, rows }: Props) {
  const hint = useInsertHint(zone, tasks);
  const blanks = Math.max(0, rows - tasks.length - 1);
  const addRef = useRef<HTMLInputElement>(null);
  const lastOpen = tasks.reduce((at, t, i) => (t.done ? at : i), -1);

  // A click on blank paper types a task; a click on a row, button, input or link is its own.
  const focusAdd = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('li, button, input, label, a, [role="button"]')) return;
    addRef.current?.focus();
  };

  return (
    <div className={styles.ruled} onClick={focusAdd}>
      {/* Always rendered, so the add line never remounts (and loses focus) when the first task lands. */}
      <ul className={styles.tasks}>
        {hint === 'end' && lastOpen === -1 && <InsertLine />}
        {tasks.map((t, i) => (
          <Fragment key={t.id}>
            {hint === t.id && <InsertLine />}
            <SortableTask task={t} variant="compact" />
            {hint === 'end' && i === lastOpen && <InsertLine />}
          </Fragment>
        ))}
      </ul>
      <div className={styles.rule} data-rule="add">
        <QuickAdd label={addLabel} place={place} variant="line" inputRef={addRef} />
      </div>
      {Array.from({ length: blanks }, (_, i) => (
        <div key={i} className={styles.rule} data-rule="blank" aria-hidden="true" />
      ))}
    </div>
  );
}
