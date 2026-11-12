// The widget's Lists view (v1.2 spec §3.6, §3.7): a list picker, that list's tasks, and a quick-add
// row, and the list menu. A list linked to a subject with an upcoming exam says how far off it is.
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { examLine, upcomingExam } from '../../core/planner/schedule';
import { wallStamp } from '../../core/wallclock';
import type { Deadline } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { deadlineDayKey, plannerToday } from './format';
import { ListMenu } from './ListMenu';
import { tasksInList, usePlannerStore } from './plannerStore';
import { QuickAdd } from './QuickAdd';
import { TaskRow } from './TaskRow';
import styles from './planner.module.css';

/** "Exam in 23 days" for the subject's next exam, or null. The exam's study day is worked out as
 *  main does (rollover hour applied), never by slicing the due text. */
function examTextFor(deadlines: Deadline[], subjectId: number | null, rolloverHour: number): string | null {
  const exam = upcomingExam(deadlines, subjectId, wallStamp(Date.now()));
  if (!exam) return null;
  return examLine(deadlineDayKey(exam.due, rolloverHour), plannerToday(rolloverHour));
}

export function ListsView() {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const lists = usePlannerStore((s) => s.lists);
  const chosen = usePlannerStore((s) => s.listId);
  const deadlines = usePlannerStore((s) => s.deadlines);
  const setListId = usePlannerStore((s) => s.setListId);
  const loadLists = usePlannerStore((s) => s.loadLists);
  const list = lists.find((l) => l.id === chosen) ?? lists[0] ?? null;
  const tasks = usePlannerStore(useShallow((s) => (list ? tasksInList(s, list.id) : [])));

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  if (!list) {
    return (
      <section className={styles.view} aria-label="Lists">
        <p className={styles.empty}>No lists yet.</p>
      </section>
    );
  }

  const examText = examTextFor(Object.values(deadlines), list.subjectId, rolloverHour);

  return (
    <section className={styles.view} aria-label="Lists">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <select
          className={styles.select}
          style={{ flex: 1, minWidth: 0 }}
          aria-label="List"
          value={list.id}
          onChange={(e) => setListId(Number(e.target.value))}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <ListMenu list={list} />
      </div>
      {examText && <p className={styles.exam}>{examText}</p>}
      {tasks.length === 0 ? (
        <p className={styles.empty}>Nothing in this list yet.</p>
      ) : (
        <ul className={styles.rows}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
      <QuickAdd label="Add a task" place={{ listId: list.id }} />
    </section>
  );
}
