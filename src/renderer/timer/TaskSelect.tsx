// The task picker (spec §3.3): "No task" plus every not-done task in list order, a select-only
// combobox like the subject picker. The list is fetched each time it opens, so a task added in the
// Tasks widget a moment ago is there. The task the timer holds is shown by its remembered text even
// once it is ticked off or deleted: the timer keeps it until the segment ends (spec §3.3).
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { TASK_GONE } from '../../shared/limits';
import type { Task } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

type Choice = { id: number | null; text: string };

const NO_TASK: Choice = { id: null, text: 'No task' };
/** Room the list needs below the box before it opens upwards instead. */
const LIST_ROOM = 300;

export function TaskSelect() {
  const taskId = useStudyStore((s) => s.timer.taskId);
  const taskText = useStudyStore((s) => s.timer.taskText);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [failed, setFailed] = useState<'gone' | 'other' | null>(null);
  const listed: Choice[] = tasks.filter((t) => !t.done).map((t) => ({ id: t.id, text: t.text }));
  const choices: Choice[] = [NO_TASK, ...listed];
  // The held task stays shown even when it is no longer in the not-done list.
  if (taskId !== null && !listed.some((c) => c.id === taskId)) {
    choices.splice(1, 0, { id: taskId, text: taskText ?? 'Task' });
  }
  const selected = Math.max(
    0,
    choices.findIndex((c) => c.id === taskId),
  );

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [upwards, setUpwards] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (i: number): string => `${id}-option-${i}`;

  const load = (): void => {
    window.studyat.tasks
      .list()
      .then(setTasks)
      .catch(() => undefined); // keep the last list; "No task" still works
  };
  const show = (): void => {
    const rect = box.current?.getBoundingClientRect();
    setUpwards(rect !== undefined && rect.bottom + LIST_ROOM > window.innerHeight);
    setActive(selected);
    setFailed(null);
    setOpen(true);
    load();
  };
  const close = (): void => setOpen(false);
  const pick = (i: number): void => {
    close();
    const choice = choices[i];
    if (!choice || choice.id === taskId) return;
    setFailed(null);
    // A task ticked off or removed between opening the picker and choosing it.
    window.studyat.timer.setTask(choice.id).catch((err: unknown) => {
      setFailed(err instanceof Error && err.message.includes(TASK_GONE) ? 'gone' : 'other');
      load();
    });
  };
  const clamp = (i: number): number => Math.min(choices.length - 1, Math.max(0, i));

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { key } = e;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') show();
      else return;
    } else if (key === 'ArrowDown') setActive(clamp(active + 1));
    else if (key === 'ArrowUp') setActive(clamp(active - 1));
    else if (key === 'Home') setActive(0);
    else if (key === 'End') setActive(choices.length - 1);
    else if (key === 'Enter' || key === ' ') pick(active);
    else if (key === 'Escape') close();
    else if (key === 'Tab') {
      // Close without picking: a stray Tab must never split a focus session (appplan §5).
      close();
      return; // let Tab move focus on as usual
    } else return;
    // Handled here, so the in-app shortcuts (Space, R, Esc...) leave it alone.
    e.preventDefault();
  };

  const current = choices[selected]!;

  return (
    <div className={styles.subject}>
      <span id={labelId} className={styles.visuallyHidden}>
        Task
      </span>
      <div
        ref={box}
        className={styles.combo}
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={current.text}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        onBlur={close}
      >
        <span className={styles.comboText}>{current.text}</span>
        <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {failed !== null && (
        <p className={styles.taskGone} role="alert">
          {failed === 'gone' ? TASK_GONE : "Couldn't set that task."}
        </p>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className={`${styles.listbox} ${upwards ? styles.upwards : ''}`}
          tabIndex={-1}
        >
          {choices.map((c, i) => (
            <li
              key={c.id ?? 'none'}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              className={`${styles.option} ${i === active ? styles.activeOption : ''}`}
              title={c.text}
              // Keep focus on the combobox, so choosing doesn't blur and close it first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className={styles.optionText}>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
