// The Tasks board (v1.2 spec §3.7): the full-window overlay opened by the widget's Expand. Its head
// is "November 2026 W46", the view switch, ‹ Today ›, the filter and "+ New task"; below, the Week and
// then the lists, in one drag-and-drop space so a task moves between any day and any list. The body
// scrolls inside the sheet and every column inside itself, so nothing overflows the window (§7).
import { useEffect, useRef, useState } from 'react';
import { addDays, weekStartOf } from '../../../core/time';
import { useStudyStore } from '../../shell/store';
import { PlannerDnd } from '../dnd';
import { FilterButton } from '../FilterButton';
import { boardTitle, plannerToday } from '../format';
import { usePlannerStore } from '../plannerStore';
import { QuickAdd } from '../QuickAdd';
import { RevisionBar } from '../RevisionBar';
import { TaskDetail } from '../TaskDetail';
import { useToday } from '../useToday';
import { BoardDragOverlay } from './BoardDrag';
import { BoardLists } from './BoardLists';
import { BoardWeek } from './BoardWeek';
import styles from './board.module.css';

export type BoardView = 'day' | 'week' | 'month';

export function TasksBoard() {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  // The one task detail lives in the Tasks widget while it is open; with it closed the board hosts
  // it. Both read the same setting, so exactly one is ever mounted.
  const widgetOpen = useStudyStore((s) => s.settings?.widgets.tasks.open === true);
  const notice = usePlannerStore((s) => s.notice);
  const openDetail = usePlannerStore((s) => s.openDetail);
  const today = useToday(rolloverHour);
  const [boardView, setBoardView] = useState<BoardView>('week');
  const [boardDay, setBoardDay] = useState(today);
  const [adding, setAdding] = useState(false);
  const newTask = useRef<HTMLDivElement>(null);
  const weekStart = weekStartOf(boardDay);
  const onThisWeek = weekStart === weekStartOf(today);

  // The revision offer lasts while the view is open (spec §3.9).
  useEffect(() => () => usePlannerStore.getState().dismissOffer(), []);

  // "+ New task" opens its quick add ready to type.
  useEffect(() => {
    if (adding) newTask.current?.querySelector('input')?.focus();
  }, [adding]);

  return (
    <div className={styles.board}>
      <div className={styles.head}>
        <h3 className={styles.title}>{boardTitle(boardDay)}</h3>
        <div role="group" aria-label="Board view" className={styles.views}>
          {/* Task 22 adds Day before and Month after: Day · Week · Month. */}
          <button
            type="button"
            className={styles.viewButton}
            aria-pressed={boardView === 'week'}
            onClick={() => setBoardView('week')}
          >
            Week
          </button>
        </div>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous week"
            onClick={() => setBoardDay(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-disabled={onThisWeek ? 'true' : undefined}
            onClick={() => setBoardDay(today)}
          >
            Today
          </button>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Next week"
            onClick={() => setBoardDay(addDays(weekStart, 7))}
          >
            ›
          </button>
        </div>
        <div className={styles.tools}>
          <FilterButton />
          <button
            type="button"
            className={styles.textButton}
            aria-expanded={adding}
            onClick={() => setAdding((a) => !a)}
          >
            + New task
          </button>
        </div>
      </div>
      {adding && (
        <div ref={newTask} className={styles.newTask}>
          <QuickAdd
            label="New task for today"
            place={() => ({ day: plannerToday(rolloverHour) })}
            onCreated={(t) => {
              setAdding(false);
              openDetail(t.id);
            }}
          />
        </div>
      )}
      <p role="status" aria-label="Task notice" className={styles.notice}>
        {notice}
      </p>
      <RevisionBar />
      <div className={styles.scroll}>
        <PlannerDnd>
          {boardView === 'week' && <BoardWeek weekStart={weekStart} />}
          <BoardLists />
          <BoardDragOverlay />
        </PlannerDnd>
      </div>
      {!widgetOpen && <TaskDetail />}
    </div>
  );
}
