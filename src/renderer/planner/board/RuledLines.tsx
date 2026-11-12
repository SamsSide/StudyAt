// A board column's ruled lines (v1.2 spec §3.7, a Tweek page): one task per line (a long title wraps
// onto the next rule), the quick-add on the first empty line, then blank lines to `rows`. Shared by
// the day columns and the list columns. The column grows with its tasks and the board scrolls as one
// page; a column never scrolls inside itself.
import { Fragment } from 'react';
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
  const lastOpen = tasks.reduce((at, t, i) => (t.done ? at : i), -1);

  return (
    <div className={styles.ruled}>
      {(tasks.length > 0 || hint !== null) && (
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
      )}
      <div className={styles.rule} data-rule="add">
        <QuickAdd label={addLabel} place={place} placeholder="Add…" />
      </div>
      {Array.from({ length: blanks }, (_, i) => (
        <div key={i} className={styles.rule} aria-hidden="true" />
      ))}
    </div>
  );
}
