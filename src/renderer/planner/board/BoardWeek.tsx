// The board's Week (v1.2 spec §3.7, a Tweek layout): Monday to Friday as columns, then Saturday and
// Sunday stacked in a sixth. Each day is ruled rows: its tasks, the quick-add on the first empty row,
// then blank rules. The head says "<planned> planned · <studied> studied" with the day's deadlines
// under it. Studied time is main's focus-only figure for the day (a missing key is 0).
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { addDays } from '../../../core/time';
import type { Deadline, PlannerTask } from '../../../shared/types';
import { formatGoal } from '../../shell/format';
import { useStudyStore } from '../../shell/store';
import { formatDayLabel } from '../../stats/format';
import { DeadlineChip } from '../DeadlineChip';
import { DropZone, dayZone } from '../dnd';
import { deadlineDayKey } from '../format';
import { tasksOnDay, usePlannerStore, type PlannerState } from '../plannerStore';
import { useToday } from '../useToday';
import { RuledLines } from './RuledLines';
import styles from './board.module.css';

/** Ruled rows a weekday shows even when empty. Sat and Sun share a column and each has its own head,
 *  so four each keeps the weekend column level with a weekday. */
const WEEKDAY_ROWS = 10;
const WEEKEND_ROWS = 4;

/** "1h 30m planned": the estimates of every task on the day, open and done, whatever the filter. */
export function plannedMs(tasks: readonly PlannerTask[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMin ?? 0) * 60_000, 0);
}

/** The day's open deadlines; the day comes from `deadlineDayKey` (rollover applied), never the text. */
export function deadlinesFor(s: PlannerState, day: string, rolloverHour: number): Deadline[] {
  return Object.values(s.deadlines)
    .filter((d) => !d.done && deadlineDayKey(d.due, rolloverHour) === day)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id));
}

function DayColumn({ day, today, rows }: { day: string; today: string; rows: number }) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const tasks = usePlannerStore(useShallow((s: PlannerState) => tasksOnDay(s, day)));
  const planned = usePlannerStore((s) => plannedMs(Object.values(s.tasks).filter((t) => t.day === day)));
  const studied = usePlannerStore((s) => s.studiedMs[day] ?? 0);
  const deadlines = usePlannerStore(useShallow((s: PlannerState) => deadlinesFor(s, day, rolloverHour)));
  const label = formatDayLabel(day);

  return (
    <DropZone id={dayZone(day)} className={styles.day} items={tasks.map((t) => t.id)}>
      <section
        aria-label={label}
        className={styles.daySection}
        data-today={day === today ? 'true' : undefined}
      >
        <header className={styles.dayHead}>
          <h3 className={styles.dayName}>{label}</h3>
          <p className={styles.dayStats}>
            {`${formatGoal(planned)} planned · ${formatGoal(studied)} studied`}
          </p>
          {deadlines.length > 0 && (
            <div className={styles.deadlines}>
              {deadlines.map((d) => (
                <DeadlineChip key={d.id} deadline={d} />
              ))}
            </div>
          )}
        </header>
        <RuledLines
          zone={dayZone(day)}
          tasks={tasks}
          addLabel={`Add to ${label}`}
          place={{ day }}
          rows={rows}
        />
      </section>
    </DropZone>
  );
}

export function BoardWeek({ weekStart }: { weekStart: string }) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const today = useToday(rolloverHour);
  const loadRange = usePlannerStore((s) => s.loadRange);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekdays = days.slice(0, 5);
  const weekend = days.slice(5);

  useEffect(() => {
    void loadRange('week', weekStart);
  }, [weekStart, loadRange]);

  return (
    <div className={styles.week} role="group" aria-label="Week">
      {weekdays.map((d) => (
        <div key={d} className={styles.column} data-board-column="">
          <DayColumn day={d} today={today} rows={WEEKDAY_ROWS} />
        </div>
      ))}
      <div className={`${styles.column} ${styles.weekend}`} data-board-column="">
        {weekend.map((d) => (
          <DayColumn key={d} day={d} today={today} rows={WEEKEND_ROWS} />
        ))}
      </div>
    </div>
  );
}
