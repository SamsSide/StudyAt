// The sticky-note Tasks widget body (spec §3.10, appplan §4.6): add with Enter, notes in six colours,
// click text to edit, tick to move to a collapsible "Done (n)" list, reorder by drag handle or
// Alt+ArrowUp/Down, "Clear done". The shell's WidgetFrame supplies the frosted container and title.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import type { Task, TaskColour } from '../../shared/types';
import { ColourSwatches, TaskNote } from './TaskNote';
import styles from './TasksWidget.module.css';
import { clampTaskText, DEFAULT_TASK_COLOUR, MAX_TASK_LENGTH } from './taskColours';

const openOf = (tasks: Task[]): Task[] => tasks.filter((t) => !t.done).sort((a, b) => a.sort - b.sort);
const doneOf = (tasks: Task[]): Task[] =>
  tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

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
  // Loading and saving fail differently: a failed load has nothing to show; a failed save leaves the list up.
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<'refreshed' | 'plain' | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const dragIdRef = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // Where focus goes once the next list lands: React moves or removes the focused node and the
  // browser then drops focus to the body.
  const refocus = useRef<(() => HTMLElement | null) | null>(null);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const dragStartIds = useRef<number[]>([]);

  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    // Only when focus was actually dropped: if Sam has moved on (clicked the add box while a slow
    // save was in flight, say), leave focus where they put it.
    const now = document.activeElement;
    if (now && now !== document.body) return;
    target()?.focus();
  }, [tasks]);

  const focusControl = (id: number, control: string) => () =>
    listRef.current?.querySelector<HTMLElement>(`[data-task-id="${id}"] [data-control="${control}"]`) ?? null;

  /** Take a fresh list from main: it also clears any earlier error, as the view is honest again. */
  const adopt = useCallback((list: Task[]) => {
    setTasks(list);
    setLoadFailed(false);
    setSaveError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await window.studyat.tasks.list());
    } catch {
      setLoadFailed(true);
    }
  }, [adopt]);

  useEffect(() => {
    let live = true;
    window.studyat.tasks.list().then(
      (list) => live && adopt(list),
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [adopt]);

  /** Run a mutation; every call returns the full list. A failure re-reads so the view is honest. */
  const run = useCallback(
    async (call: Promise<Task[]>) => {
      try {
        adopt(await call);
      } catch {
        refocus.current = null;
        try {
          setTasks(await window.studyat.tasks.list());
          // The list is on screen now, so an earlier "Couldn't load" no longer holds.
          setLoadFailed(false);
          setSaveError('refreshed');
        } catch {
          setSaveError('plain');
        }
      }
    },
    [adopt],
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

  const move = (task: Task, delta: -1 | 1, control: string) => {
    const ids = open.map((t) => t.id);
    const from = ids.indexOf(task.id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    refocus.current = focusControl(task.id, control);
    commitOrder(ids);
  };

  /** Ticking hands focus to the next open note's tick box, or the add box when it was the last. */
  const tick = (task: Task) => {
    const next = open[open.findIndex((t) => t.id === task.id) + 1];
    refocus.current = next ? focusControl(next.id, 'check') : () => addRef.current;
    void run(window.studyat.tasks.update(task.id, { done: true }));
  };

  /** Un-ticked notes return to the end of the open list; focus follows the note there. */
  const untick = (task: Task) => {
    refocus.current = focusControl(task.id, 'check');
    void run(
      window.studyat.tasks.update(task.id, { done: false }).then((list) => {
        const ids = openOf(list)
          .map((t) => t.id)
          .filter((id) => id !== task.id);
        return window.studyat.tasks.reorder([...ids, task.id]);
      }),
    );
  };

  const dragHandlers = {
    onPointerDown(e: PointerEvent<HTMLButtonElement>, task: Task) {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragStartIds.current = openOf(tasksRef.current).map((t) => t.id);
      dragIdRef.current = task.id;
      setDragId(task.id);
    },
    onPointerMove(e: PointerEvent<HTMLButtonElement>) {
      const lifted = dragIdRef.current;
      if (lifted === null || !listRef.current) return;
      const ids = openOf(tasksRef.current).map((t) => t.id);
      const others = ids.filter((id) => id !== lifted);
      // The target slot is the number of other notes whose midpoint sits above the pointer.
      let slot = 0;
      for (const id of others) {
        const el = listRef.current.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top + r.height / 2 < e.clientY) slot += 1;
      }
      others.splice(slot, 0, lifted);
      if (others.some((id, i) => id !== ids[i])) setTasks((prev) => withOrder(prev, others));
    },
    /** Pointer up, cancel and lost capture all land here, so a note never stays lifted. */
    onPointerEnd(e: PointerEvent<HTMLButtonElement>) {
      if (dragIdRef.current === null) return;
      dragIdRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
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
          ref={addRef}
          maxLength={MAX_TASK_LENGTH}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TASK_LENGTH))}
        />
      </form>
      <ColourSwatches label="New note colour" value={colour} onPick={setColour} />

      {saveError && (
        <p className={styles.error} role="status">
          {saveError === 'refreshed'
            ? 'Couldn’t save that just now. Your list has been refreshed.'
            : 'Couldn’t save that just now.'}
        </p>
      )}

      <div className={styles.scroll}>
        {loadFailed && (
          <div className={styles.loadFailed} role="status">
            <p className={styles.error}>Couldn’t load your tasks.</p>
            <button type="button" className={styles.clear} onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {!loadFailed && open.length === 0 && done.length === 0 && (
          <p className={styles.empty}>No tasks yet.</p>
        )}

        {open.length > 0 && (
          <ul className={styles.list} ref={listRef} aria-label="Tasks">
            {open.map((t) => (
              <TaskNote
                key={t.id}
                task={t}
                dragging={dragId === t.id}
                dragHandlers={dragHandlers}
                onMove={move}
                onToggle={tick}
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
              <button
                type="button"
                className={styles.clear}
                onClick={() => void run(window.studyat.tasks.clearDone())}
              >
                Clear done
              </button>
            </div>
            {showDone && (
              <ul className={styles.list} aria-label="Done tasks">
                {done.map((t) => (
                  <TaskNote
                    key={t.id}
                    task={t}
                    onToggle={untick}
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
