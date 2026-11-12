// The Tasks board (v1.2 spec §3.7): the full-window overlay opened by the widget's Expand. Its head
// is "November 2026 W46" ("November 2026" on the Month), the view switch Day · Week · Month, ‹ Today ›
// (a day, a week or a month at a time), the filter and "+ New task"; below, the view and the lists (in
// a right-hand column on the Day), in one drag-and-drop space so a task moves between any day and any
// list. The body
// scrolls inside the sheet and every column inside itself, so nothing overflows the window (§7).
import { useEffect, useRef, useState } from 'react';
import { addDays, weekStartOf } from '../../../core/time';
import { useStudyStore } from '../../shell/store';
import { PlannerDnd } from '../dnd';
import { FilterButton } from '../FilterButton';
import { boardTitle, monthTitle, plannerToday } from '../format';
import { usePlannerStore } from '../plannerStore';
import { QuickAdd } from '../QuickAdd';
import { RevisionBar } from '../RevisionBar';
import { TaskDetail } from '../TaskDetail';
import { useToday } from '../useToday';
import { BoardDay } from './BoardDay';
import { BoardDragOverlay } from './BoardDrag';
import { BoardLists } from './BoardLists';
import { BoardMonth, shiftMonth } from './BoardMonth';
import { BoardWeek } from './BoardWeek';
import styles from './board.module.css';

export type BoardView = 'day' | 'week' | 'month';

const VIEWS: { view: BoardView; label: string }[] = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
];

/** What ‹ › step by, per view: their labels and where each lands. */
const STEP: Record<BoardView, { unit: string; to(day: string, n: -1 | 1): string }> = {
  day: { unit: 'day', to: (day, n) => addDays(day, n) },
  week: { unit: 'week', to: (day, n) => addDays(weekStartOf(day), 7 * n) },
  month: { unit: 'month', to: (day, n) => `${shiftMonth(day.slice(0, 7), n)}-01` },
};

/** True when the shown day, week or month already holds today, so Today has nowhere to go. */
export function showsToday(view: BoardView, day: string, today: string): boolean {
  if (view === 'day') return day === today;
  if (view === 'week') return weekStartOf(day) === weekStartOf(today);
  return day.slice(0, 7) === today.slice(0, 7);
}

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
  const month = boardDay.slice(0, 7);
  const atToday = showsToday(boardView, boardDay, today);
  const step = STEP[boardView];
  const pickDay = (day: string): void => {
    setBoardDay(day);
    setBoardView('day');
  };

  // The revision offer lasts while the view is open (spec §3.9).
  useEffect(() => () => usePlannerStore.getState().dismissOffer(), []);

  // "+ New task" opens its quick add ready to type.
  useEffect(() => {
    if (adding) newTask.current?.querySelector('input')?.focus();
  }, [adding]);

  return (
    <div className={styles.board}>
      <div className={styles.head}>
        <h3 className={styles.title}>{boardView === 'month' ? monthTitle(month) : boardTitle(boardDay)}</h3>
        <div role="group" aria-label="Board view" className={styles.views}>
          {VIEWS.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              className={styles.viewButton}
              aria-pressed={boardView === view}
              onClick={() => setBoardView(view)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label={`Previous ${step.unit}`}
            onClick={() => setBoardDay(step.to(boardDay, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-disabled={atToday ? 'true' : undefined}
            onClick={() => {
              if (!atToday) setBoardDay(today);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className={styles.navButton}
            aria-label={`Next ${step.unit}`}
            onClick={() => setBoardDay(step.to(boardDay, 1))}
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
          {boardView === 'day' && <BoardDay day={boardDay} />}
          {boardView === 'week' && <BoardWeek weekStart={weekStart} />}
          {boardView === 'month' && <BoardMonth month={month} onPickDay={pickDay} />}
          {boardView !== 'day' && <BoardLists />}
          <BoardDragOverlay />
        </PlannerDnd>
      </div>
      {!widgetOpen && <TaskDetail />}
    </div>
  );
}
