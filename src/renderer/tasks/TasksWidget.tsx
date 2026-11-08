// The sticky-note Tasks widget body (spec §3.10, appplan §4.6): add with Enter, notes in six colours,
// click text to edit, tick to move to a collapsible "Done (n)" list, reorder by drag handle or
// Alt+ArrowUp/Down, "Clear done". The shell's WidgetFrame supplies the frosted container and title.
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import type { Task, TaskColour } from '../../shared/types';
import { ColourSwatches, TaskNote } from './TaskNote';
import styles from './TasksWidget.module.css';
import { clampTaskText, DEFAULT_TASK_COLOUR, MAX_TASK_LENGTH } from './taskColours';

const openOf = (tasks: Task[]): Task[] => tasks.filter((t) => !t.done).sort((a, b) => a.sort - b.sort);
const doneOf = (tasks: Task[]): Task[] => tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

/** Apply a new open-note order locally (optimistic) by rewriting each open note's sort. */
const withOrder = (tasks: Task[], ids: number[]): Task[] =>
  tasks.map((t) => {
    const i = ids.indexOf(t.id);
    return i === -1 ? t : { ...t, sort: i };
  });

export function TasksWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [text, setText] = useState('');
  const [colour, setColour] = useState<TaskColour>(DEFAULT_TASK_COLOUR);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const dragStartIds = useRef<number[]>([]);

  const reload = useCallback(async () => {
    try {
      setTasks(await window.studyat.tasks.list());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    let live = true;
    window.studyat.tasks.list().then(
      (list) => live && setTasks(list),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, []);

  /** Run a mutation; every call returns the full list. A failure re-reads so the view is honest. */
  const run = useCallback(
    async (call: Promise<Task[]>) => {
      try {
        setTasks(await call);
        setError(false);
      } catch {
        setError(true);
        await reload();
      }
    },
    [reload],
  );

  const open = openOf(tasks);
  const done = doneOf(tasks);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const clean = clampTaskText(text);
    if (!clean) return;
    setText('');
    void run(window.studyat.tasks.create({ text: clean, colour }));
  };

  const commitOrder = (ids: number[]) => {
    setTasks((prev) => withOrder(prev, ids));
    void run(window.studyat.tasks.reorder(ids));
  };

  const move = (task: Task, delta: -1 | 1) => {
    const ids = open.map((t) => t.id);
    const from = ids.indexOf(task.id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    commitOrder(ids);
  };

  const dragHandlers = {
    onPointerDown(e: PointerEvent<HTMLButtonElement>, task: Task) {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragStartIds.current = openOf(tasksRef.current).map((t) => t.id);
      setDragId(task.id);
    },
    onPointerMove(e: PointerEvent<HTMLButtonElement>) {
      if (dragId === null || !listRef.current) return;
      const ids = openOf(tasksRef.current).map((t) => t.id);
      const others = ids.filter((id) => id !== dragId);
      // The target slot is the number of other notes whose midpoint sits above the pointer.
      let slot = 0;
      for (const id of others) {
        const el = listRef.current.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top + r.height / 2 < e.clientY) slot += 1;
      }
      others.splice(slot, 0, dragId);
      if (others.some((id, i) => id !== ids[i])) setTasks((prev) => withOrder(prev, others));
    },
    onPointerEnd(e: PointerEvent<HTMLButtonElement>) {
      if (dragId === null) return;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDragId(null);
      const ids = openOf(tasksRef.current).map((t) => t.id);
      if (ids.some((id, i) => id !== dragStartIds.current[i])) void run(window.studyat.tasks.reorder(ids));
    },
  };

  return (
    <div className={styles.widget}>
      <form className={styles.addRow} onSubmit={add}>
        <input
          className={styles.addInput}
          type="text"
          value={text}
          placeholder="Add a task…"
          aria-label="Add a task"
          maxLength={MAX_TASK_LENGTH}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TASK_LENGTH))}
        />
      </form>
      <ColourSwatches label="New note colour" value={colour} onPick={setColour} />

      {error && (
        <p className={styles.error} role="status">
          Couldn’t save that just now. Your list has been refreshed.
        </p>
      )}

      <div className={styles.scroll}>
        {open.length === 0 && done.length === 0 && <p className={styles.empty}>No tasks yet.</p>}

        {open.length > 0 && (
          <ul className={styles.list} ref={listRef} aria-label="Tasks">
            {open.map((t) => (
              <TaskNote
                key={t.id}
                task={t}
                dragging={dragId === t.id}
                dragHandlers={dragHandlers}
                onMove={move}
                onToggle={(n) => void run(window.studyat.tasks.update(n.id, { done: true }))}
                onEditText={(n, v) => void run(window.studyat.tasks.update(n.id, { text: v }))}
                onColour={(n, c) => void run(window.studyat.tasks.update(n.id, { colour: c }))}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <section className={styles.doneSection}>
            <div className={styles.doneHeader}>
              <button
                type="button"
                className={styles.doneToggle}
                aria-expanded={showDone}
                onClick={() => setShowDone((s) => !s)}
              >
                <span aria-hidden="true" className={showDone ? styles.chevronOpen : styles.chevron}>
                  ›
                </span>
                Done ({done.length})
              </button>
              <button type="button" className={styles.clear} onClick={() => void run(window.studyat.tasks.clearDone())}>
                Clear done
              </button>
            </div>
            {showDone && (
              <ul className={styles.list} aria-label="Done tasks">
                {done.map((t) => (
                  <TaskNote
                    key={t.id}
                    task={t}
                    onToggle={(n) => void run(window.studyat.tasks.update(n.id, { done: false }))}
                    onEditText={(n, v) => void run(window.studyat.tasks.update(n.id, { text: v }))}
                    onColour={(n, c) => void run(window.studyat.tasks.update(n.id, { colour: c }))}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
