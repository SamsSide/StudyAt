// The task picker (v1.2 spec §3.8): "No task", then the open planner tasks grouped Today, This week
// (the other days of it) and Lists, with a type-to-filter box. A combobox like the subject picker;
// the lists are fetched each time it opens, so a task added in the planner a moment ago is there.
// The task the timer holds is shown by its remembered text even once it is done or deleted: the
// timer keeps it until the segment ends (v1.1 spec §3.3).
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { TASK_GONE } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PlannerTask } from '../../shared/types';
import { plannerToday } from '../planner/format';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

type Group = 'Today' | 'This week' | 'Lists';
type Choice = { id: number | null; text: string; group: Group | null };

const NO_TASK: Choice = { id: null, text: 'No task', group: null };
/** Room the list needs below the box before it opens upwards instead. */
const LIST_ROOM = 340;
/** The options' tallest (as `.taskOptions` in timer.module.css) and shortest height, in CSS px. */
const OPTIONS_MAX = 7 * 34 + 3 * 22;
const OPTIONS_MIN = 2 * 34;
/** What the open list adds around its options: the find box, gaps, padding and the window edge. */
const LIST_CHROME = 72;

type Found = { today: PlannerTask[]; week: PlannerTask[]; lists: PlannerTask[] };
const EMPTY: Found = { today: [], week: [], lists: [] };

const byOrder = (a: PlannerTask, b: PlannerTask): number => a.sort - b.sort || a.id - b.id;

export function TaskSelect() {
  const taskId = useStudyStore((s) => s.timer.taskId);
  const taskText = useStudyStore((s) => s.timer.taskText);
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? DEFAULT_SETTINGS.rolloverHour);
  const [found, setFound] = useState<Found>(EMPTY);
  const [filter, setFilter] = useState('');
  const [failed, setFailed] = useState<'gone' | 'other' | null>(null);

  const needle = filter.trim().toLowerCase();
  const matches = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);
  const listed: Choice[] = [];
  const add = (tasks: PlannerTask[], group: Group): void => {
    for (const t of [...tasks].sort(byOrder)) {
      if (!t.done && matches(t.title)) listed.push({ id: t.id, text: t.title, group });
    }
  };
  add(found.today, 'Today');
  add(found.week, 'This week');
  add(found.lists, 'Lists');
  const heldText = taskText ?? 'Task';
  const heldListed = [...found.today, ...found.week, ...found.lists].some((t) => t.id === taskId && !t.done);
  const choices: Choice[] = [];
  if (needle === '') choices.push(NO_TASK);
  // The held task stays shown even when it is no longer in the open lists.
  if (taskId !== null && !heldListed && matches(heldText)) {
    choices.push({ id: taskId, text: heldText, group: null });
  }
  choices.push(...listed);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [upwards, setUpwards] = useState(false);
  // The options' height for the room on the side it opens to, so it never runs off the window.
  const [optionsMax, setOptionsMax] = useState(OPTIONS_MAX);
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Set once the user moves the highlight or types; until then it follows the held task.
  const moved = useRef(false);
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (i: number): string => `${id}-option-${i}`;

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  // Open on the held task, so Enter, Enter never swaps it for "No task"; the planner fetch can
  // reorder the list, so keep following it until the user takes over.
  const heldIndex = Math.max(
    0,
    choices.findIndex((c) => c.id === taskId),
  );
  useEffect(() => {
    if (open && !moved.current) setActive(heldIndex);
  }, [open, heldIndex]);
  const highlight = (i: number): void => {
    moved.current = true;
    setActive(i);
  };

  const show = (): void => {
    const rect = box.current?.getBoundingClientRect();
    const up = rect !== undefined && rect.bottom + LIST_ROOM > window.innerHeight;
    setUpwards(up);
    // The widget is drawn scaled (WidgetFrame), so window pixels become CSS pixels by its scale.
    const drawn = box.current?.offsetHeight ?? 0;
    const scale = rect !== undefined && drawn > 0 && rect.height > 0 ? rect.height / drawn : 1;
    const room = rect === undefined ? Infinity : (up ? rect.top : window.innerHeight - rect.bottom) / scale;
    setOptionsMax(Math.max(OPTIONS_MIN, Math.min(OPTIONS_MAX, room - LIST_CHROME)));
    setFilter('');
    setFailed(null);
    moved.current = false;
    setActive(heldIndex);
    setOpen(true);
    const today = plannerToday(rolloverHour);
    Promise.all([window.studyat.planner.week(today), window.studyat.planner.lists()])
      .then(([week, lists]) =>
        setFound({
          today: week.tasks.filter((t) => t.day === today),
          week: week.tasks.filter((t) => t.day !== null && t.day !== today),
          lists: lists.tasks.filter((t) => t.listId !== null),
        }),
      )
      .catch(() => undefined); // keep the last lists; "No task" still works
  };
  const close = (refocus = false): void => {
    setOpen(false);
    if (refocus) box.current?.focus();
  };
  const pick = (i: number): void => {
    const choice = choices[i];
    close(true);
    if (!choice || choice.id === taskId) return;
    setFailed(null);
    window.studyat.timer.setTask(choice.id).catch((err: unknown) => {
      setFailed(err instanceof Error && err.message.includes(TASK_GONE) ? 'gone' : 'other');
    });
  };
  const clamp = (i: number): number => Math.min(choices.length - 1, Math.max(0, i));

  const onKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { key } = e;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') show();
      else return;
    } else if (key === 'ArrowDown') highlight(clamp(active + 1));
    else if (key === 'ArrowUp') highlight(clamp(active - 1));
    else if (key === 'Enter') pick(active);
    else if (key === 'Escape') close(true);
    else if (key === 'Tab') {
      // Close without picking: a stray Tab must never split a focus session (appplan §5).
      close();
      return; // let Tab move focus on as usual
    } else {
      // Typing in the filter box: keep the in-app shortcuts (Space, R...) out of it.
      e.stopPropagation();
      return;
    }
    // Handled here, so the in-app shortcuts (Space, R, Esc...) leave it alone.
    e.preventDefault();
  };
  // Focus moving between the box and the filter keeps it open; anywhere else closes it.
  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };

  const current = taskId === null ? NO_TASK : { id: taskId, text: heldText, group: null };
  const heldNow = choices.find((c) => c.id === taskId);
  const shown = heldNow?.text ?? current.text;

  return (
    <div className={`${styles.subject} ${styles.taskPicker}`} ref={wrap} onBlur={onBlur}>
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
        title={shown}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (!open) onKey(e); // the filter box has focus once it is open
        }}
      >
        <span className={styles.comboText}>{shown}</span>
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
        <div className={`${styles.listbox} ${styles.taskList} ${upwards ? styles.upwards : ''}`}>
          <input
            ref={search}
            type="search"
            className={styles.taskFilter}
            aria-label="Find a task"
            aria-controls={listId}
            aria-activedescendant={choices.length > 0 ? optionId(active) : undefined}
            placeholder="Find a task"
            autoComplete="off"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              highlight(0); // typing narrows the list, so the highlight goes back to its top
            }}
            onKeyDown={onKey}
          />
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className={styles.taskOptions}
            style={{ maxHeight: optionsMax }}
            tabIndex={-1}
          >
            {choices.map((c, i) => (
              <li key={c.id ?? 'none'} role="presentation">
                {c.group !== null && choices[i - 1]?.group !== c.group && (
                  <span className={styles.groupLabel}>{c.group}</span>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={c.id === taskId}
                  className={`${styles.option} ${i === active ? styles.activeOption : ''}`}
                  title={c.text}
                  // Keep focus in the filter box, so choosing doesn't blur and close it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => highlight(i)}
                  onClick={() => pick(i)}
                >
                  <span className={styles.optionText}>{c.text}</span>
                </div>
              </li>
            ))}
            {choices.length === 0 && (
              <li role="presentation" className={styles.groupLabel}>
                No open tasks match
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
