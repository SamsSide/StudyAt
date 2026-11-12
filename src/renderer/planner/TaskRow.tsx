// One task row (v1.2 spec §3.7): a checkbox, the title, then chips; ▶ and the grip appear on hover
// or focus. Clicking the row opens its detail. The board's columns use the compact variant, a Tweek
// line: a small check, the subject dot, the title wrapping across the full width onto the next rule,
// and the estimate chip only; tags, subtasks, repeat, the bell and the rolled chip stay in the
// widget, the board's Day and the detail.
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import type { PlannerTask } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { estimateChip, rolledLabel, subtaskCount } from './format';
import { usePlannerStore } from './plannerStore';
import styles from './planner.module.css';

interface RowProps {
  task: PlannerTask;
  grip?: ReactNode;
  /** For a sortable row: the li's ref, its drag transform and whether it is being dragged. */
  rowRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  dragging?: boolean;
  /** 'compact': the board's ruled-line row. The widget keeps the full row. */
  variant?: 'full' | 'compact';
}

export function TaskRow({ task, grip, rowRef, style, dragging, variant = 'full' }: RowProps) {
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === task.effectiveSubjectId));
  const update = usePlannerStore((s) => s.update);
  const openDetail = usePlannerStore((s) => s.openDetail);
  const startTask = usePlannerStore((s) => s.startTask);
  const estimate = task.estimateMin === null ? null : estimateChip(task.actualMs, task.estimateMin);
  const subtasks = subtaskCount(task);

  const onRowClick = (e: MouseEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    openDetail(task.id);
  };

  const tools = (
    <span className={styles.hover}>
      <button
        type="button"
        className={styles.play}
        aria-label={`Start focus on "${task.title}"`}
        onClick={() => void startTask(task.id)}
      >
        ▶
      </button>
      {grip}
    </span>
  );

  if (variant === 'compact') {
    // The title is an inline span acting as a button, so a long title wraps like text across the
    // whole column and the chip follows its last word; a real <button> would box it in.
    const onTitleKey = (e: KeyboardEvent<HTMLSpanElement>): void => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openDetail(task.id);
    };
    return (
      <li
        className={`${styles.row} ${styles.compact}`}
        ref={rowRef}
        style={style}
        data-variant="compact"
        data-dragging={dragging ? 'true' : undefined}
        data-task-id={task.id}
        data-done={task.done}
        data-colour={task.colour ?? undefined}
        onClick={onRowClick}
      >
        <input
          type="checkbox"
          className={styles.check}
          checked={task.done}
          aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
          onChange={() => void update(task.id, { done: !task.done })}
        />
        {subject && (
          <span
            className={styles.dot}
            data-subject-dot=""
            title={subject.name}
            style={{ background: subject.colour }}
          />
        )}
        <span role="button" tabIndex={0} className={styles.title} onKeyDown={onTitleKey}>
          {task.title}
        </span>
        {estimate && (
          <span className={styles.chip} data-over={estimate.over ? 'true' : undefined}>
            {estimate.text}
          </span>
        )}
        {tools}
      </li>
    );
  }

  return (
    <li
      className={styles.row}
      ref={rowRef}
      style={style}
      data-dragging={dragging ? 'true' : undefined}
      data-task-id={task.id}
      data-done={task.done}
      data-colour={task.colour ?? undefined}
      onClick={onRowClick}
    >
      <input
        type="checkbox"
        className={styles.check}
        checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onChange={() => void update(task.id, { done: !task.done })}
      />
      <button type="button" className={styles.title} onClick={() => openDetail(task.id)}>
        {task.title}
      </button>
      <span className={styles.chips}>
        {subject && (
          <span className={styles.dot} title={subject.name} style={{ background: subject.colour }} />
        )}
        {estimate && (
          <span className={styles.chip} data-over={estimate.over ? 'true' : undefined}>
            {estimate.text}
          </span>
        )}
        {subtasks && <span className={styles.chip}>{subtasks}</span>}
        {task.tags.map((tag) => (
          <span key={tag} className={styles.chip}>
            #{tag}
          </span>
        ))}
        {task.repeat && (
          <span className={styles.chip} aria-label="Repeats">
            ↻
          </span>
        )}
        {task.reminder && (
          <span className={styles.chip} aria-label={`Reminder ${task.reminder}`}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
            </svg>
          </span>
        )}
        {task.rolledFrom && <span className={styles.chip}>{rolledLabel(task.rolledFrom)}</span>}
      </span>
      {tools}
    </li>
  );
}
