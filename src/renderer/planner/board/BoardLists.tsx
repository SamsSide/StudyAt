// The board's lists (v1.2 spec §3.6, §3.7), three to a row under the week as ruled columns like the
// days (Tweek's "Someday" columns: Inbox, subject lists, any others, in their sort order). Each has
// its name (edited in place), its subject chip, "Exam in N days" when that subject has an exam
// coming, the list menu, and its tasks on ruled lines with the quick-add on the first empty one.
// "+ New list" adds one, up to MAX_LISTS.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { examLine, upcomingExam } from '../../../core/planner/schedule';
import { wallStamp } from '../../../core/wallclock';
import { LIMIT_COPY, LIST_NAME_MAX, MAX_LISTS } from '../../../shared/planner';
import type { TaskList } from '../../../shared/types';
import { useStudyStore } from '../../shell/store';
import { DropZone, listZone } from '../dnd';
import { deadlineDayKey } from '../format';
import { capChars, ListMenu } from '../ListMenu';
import { tasksInList, usePlannerStore } from '../plannerStore';
import { useToday } from '../useToday';
import { RuledLines } from './RuledLines';
import styles from './board.module.css';

/** Lists per row under the week (spec §3.7). */
export const LISTS_PER_ROW = 3;

/** Ruled lines a list column shows even when empty (a Tweek "Someday" column). */
const LIST_ROWS = 6;

/** The name a list made by "+ New list" starts with; it opens ready to rename. */
const NEW_LIST_NAME = 'New list';

const nowStamp = (): string => wallStamp(Date.now());

/** "Exam in 23 days" for the list's subject, or null. The exam's day is main's (rollover applied). */
function useExamText(subjectId: number | null): string | null {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  // "Today" ticks over at the rollover, which re-runs the lookup and the day count.
  const today = useToday(rolloverHour);
  const deadlines = usePlannerStore((s) => s.deadlines);
  const exam = upcomingExam(Object.values(deadlines), subjectId, nowStamp());
  if (!exam) return null;
  return examLine(deadlineDayKey(exam.due, rolloverHour), today);
}

/** The name, edited in place: Enter or leaving saves, Esc puts it back, a blank name is refused. */
function ListName({ list, autoFocus }: { list: TaskList; autoFocus: boolean }) {
  const [text, setText] = useState(list.name);
  const input = useRef<HTMLInputElement>(null);
  const updateList = usePlannerStore((s) => s.updateList);

  // Another rename (the menu's, another window's) shows through when not mid-edit.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(list.name);
  }, [list.name]);

  // A list just made by "+ New list" opens ready to rename.
  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
    input.current?.select();
  }, [autoFocus]);

  const commit = (): void => {
    const next = text.trim();
    if (next === '' || next === list.name) {
      setText(list.name);
      return;
    }
    void updateList(list.id, { name: next });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.current?.blur();
    } else if (e.key === 'Escape') {
      // Esc here undoes the edit; it does not close the board.
      e.preventDefault();
      e.stopPropagation();
      setText(list.name);
      requestAnimationFrame(() => input.current?.blur());
    }
  };

  return (
    <input
      ref={input}
      className={styles.listName}
      aria-label="List name"
      value={text}
      onChange={(e) => setText(capChars(e.target.value, LIST_NAME_MAX))}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

function ListCard({ list, fresh, onDeleted }: { list: TaskList; fresh: boolean; onDeleted: () => void }) {
  const tasks = usePlannerStore(useShallow((s) => tasksInList(s, list.id)));
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === list.subjectId));
  const examText = useExamText(list.subjectId);

  return (
    <DropZone id={listZone(list.id)} className={styles.list} items={tasks.map((t) => t.id)}>
      <section aria-label={list.name} className={styles.listSection}>
        <header className={styles.listHead}>
          <ListName list={list} autoFocus={fresh} />
          <ListMenu list={list} onDeleted={onDeleted} />
        </header>
        {(subject || examText) && (
          <div className={styles.listMeta}>
            {subject && (
              <span className={styles.subjectChip}>
                <span className={styles.dot} style={{ background: subject.colour }} aria-hidden="true" />
                {subject.name}
              </span>
            )}
            {examText && <span className={styles.exam}>{examText}</span>}
          </div>
        )}
        <RuledLines
          zone={listZone(list.id)}
          tasks={tasks}
          addLabel={`Add to ${list.name}`}
          place={{ listId: list.id }}
          rows={LIST_ROWS}
        />
      </section>
    </DropZone>
  );
}

/** `perRow`: three under the week and the month, one in the Day view's right-hand column. */
export function BoardLists({ perRow = LISTS_PER_ROW }: { perRow?: number }) {
  const lists = usePlannerStore((s) => s.lists);
  const loadLists = usePlannerStore((s) => s.loadLists);
  const createList = usePlannerStore((s) => s.createList);
  const [freshId, setFreshId] = useState<number | null>(null);
  const hintId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const full = lists.length >= MAX_LISTS;

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const add = async (): Promise<void> => {
    if (full) return;
    const before = new Set(usePlannerStore.getState().lists.map((l) => l.id));
    await createList({ name: NEW_LIST_NAME });
    const made = usePlannerStore.getState().lists.find((l) => !before.has(l.id));
    if (made) setFreshId(made.id);
  };

  return (
    <section className={styles.lists} aria-label="Lists">
      <div className={styles.listGrid} style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
        {lists.map((l) => (
          <ListCard
            key={l.id}
            list={l}
            fresh={l.id === freshId}
            onDeleted={() => addButton.current?.focus()}
          />
        ))}
      </div>
      <div className={styles.newList}>
        <button
          ref={addButton}
          type="button"
          className={styles.textButton}
          aria-disabled={full ? 'true' : undefined}
          aria-describedby={full ? hintId : undefined}
          title={full ? LIMIT_COPY.lists : undefined}
          onClick={() => void add()}
        >
          + New list
        </button>
        {full && (
          <span id={hintId} className={styles.hint}>
            {LIMIT_COPY.lists}
          </span>
        )}
      </div>
    </section>
  );
}
