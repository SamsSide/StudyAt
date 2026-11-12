// The board's Month (v1.2 spec §3.7): a Monday-first grid of whole weeks around the month. Each cell
// has its date, up to three task titles and "+n more", the day's deadline chips and its studied time
// (main's focus-only figure; a missing key is 0). Today is marked. Clicking a cell opens that day in
// the Day view; a task dropped on a cell moves to the end of that day. Titles drag by pointer; the
// keyboard way to move one is the detail's placement picker, which a title opens.
import { useEffect, type MouseEvent, type PointerEventHandler } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useShallow } from 'zustand/react/shallow';
import { addDays, daysBetween, weekStartOf } from '../../../core/time';
import type { PlannerTask } from '../../../shared/types';
import { formatGoal } from '../../shell/format';
import { useStudyStore } from '../../shell/store';
import { formatDayLabel } from '../../stats/format';
import { DeadlineChip } from '../DeadlineChip';
import { DropZone, dayZone, taskDrag } from '../dnd';
import { monthTitle } from '../format';
import { tasksOnDay, usePlannerStore, type PlannerState } from '../plannerStore';
import { useToday } from '../useToday';
import { deadlinesFor } from './BoardWeek';
import styles from './board.module.css';

/** Task titles a cell shows before "+n more" (spec §3.7). */
export const CELL_TITLES = 3;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 'YYYY-MM' moved by `n` months. */
export function shiftMonth(month: string, n: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const at = y * 12 + (m - 1) + n;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, '0')}`;
}

/** The grid's days: Monday on or before the 1st to the Sunday on or after the last (as main loads). */
export function monthDays(month: string): string[] {
  const from = weekStartOf(`${month}-01`);
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const to = addDays(weekStartOf(last), 6);
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
}

/** A title in a cell: click (or Enter) opens its detail; a pointer drag moves it. */
function MonthTask({ task }: { task: PlannerTask }) {
  const openDetail = usePlannerStore((s) => s.openDetail);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: taskDrag(task.id) });
  // Pointer only: the keyboard's Enter opens the detail, whose placement picker moves the task.
  const onPointerDown = listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined;

  return (
    <li
      ref={setNodeRef}
      className={styles.cellTask}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      data-dragging={isDragging ? 'true' : undefined}
      data-done={task.done}
      data-colour={task.colour ?? undefined}
    >
      <button
        type="button"
        className={styles.cellTitle}
        title={task.title}
        onPointerDown={onPointerDown}
        onClick={() => openDetail(task.id)}
      >
        {task.title}
      </button>
    </li>
  );
}

function MonthCell({
  day,
  month,
  today,
  onPickDay,
}: {
  day: string;
  month: string;
  today: string;
  onPickDay(day: string): void;
}) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const tasks = usePlannerStore(useShallow((s: PlannerState) => tasksOnDay(s, day)));
  const studied = usePlannerStore((s) => s.studiedMs[day] ?? 0);
  const deadlines = usePlannerStore(useShallow((s: PlannerState) => deadlinesFor(s, day, rolloverHour)));
  const shown = tasks.slice(0, CELL_TITLES);
  const more = tasks.length - shown.length;
  const label = formatDayLabel(day);

  // The empty part of a cell opens the day too; its own controls keep their clicks.
  const onClick = (e: MouseEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    onPickDay(day);
  };

  return (
    <DropZone id={dayZone(day)} role="cell" className={styles.cellZone} items={shown.map((t) => t.id)}>
      <div
        className={styles.cell}
        data-month-cell={day}
        data-outside={day.slice(0, 7) !== month ? 'true' : undefined}
        aria-current={day === today ? 'date' : undefined}
        onClick={onClick}
      >
        <div className={styles.cellHead}>
          <button
            type="button"
            className={styles.cellDate}
            aria-label={`Open ${label}`}
            onClick={() => onPickDay(day)}
          >
            {Number(day.slice(8))}
          </button>
          {studied > 0 && <span className={styles.cellStudied}>{`${formatGoal(studied)} studied`}</span>}
        </div>
        {deadlines.length > 0 && (
          <div className={styles.cellDeadlines}>
            {deadlines.map((d) => (
              <DeadlineChip key={d.id} deadline={d} />
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <ul className={styles.cellTasks}>
            {shown.map((t) => (
              <MonthTask key={t.id} task={t} />
            ))}
          </ul>
        )}
        {more > 0 && <span className={styles.cellMore}>{`+${more} more`}</span>}
      </div>
    </DropZone>
  );
}

export function BoardMonth({ month, onPickDay }: { month: string; onPickDay(day: string): void }) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const today = useToday(rolloverHour);
  const watchRange = usePlannerStore((s) => s.watchRange);
  const days = monthDays(month);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  useEffect(() => {
    return watchRange('month', month).release;
  }, [month, watchRange]);

  return (
    <div role="table" aria-label={monthTitle(month)} className={styles.month}>
      <div role="row" className={styles.monthRow}>
        {WEEKDAYS.map((d) => (
          <span key={d} role="columnheader" className={styles.weekday}>
            {d}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className={styles.monthRow}>
          {week.map((d) => (
            <MonthCell key={d} day={d} month={month} today={today} onPickDay={onPickDay} />
          ))}
        </div>
      ))}
    </div>
  );
}
