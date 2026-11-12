// The widget's Day view (v1.2 spec §3.7): deadline chips on top, the day's tasks (open, then done),
// ‹ › to move a day, Today to come back, and a quick-add row at the bottom.
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { addDays } from '../../core/time';
import { formatDayLabel } from '../stats/format';
import { useStudyStore } from '../shell/store';
import { DeadlineChip } from './DeadlineChip';
import { DropZone, dayZone, SortableTask } from './dnd';
import { plannerToday } from './format';
import { deadlinesOn, tasksOnDay, usePlannerStore } from './plannerStore';
import { QuickAdd } from './QuickAdd';
import { useToday } from './useToday';
import styles from './planner.module.css';

export function DayView() {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const today = useToday(rolloverHour);
  const chosen = usePlannerStore((s) => s.day);
  const day = chosen ?? today;
  const setDay = usePlannerStore((s) => s.setDay);
  const loadRange = usePlannerStore((s) => s.loadRange);
  const tasks = usePlannerStore(useShallow((s) => tasksOnDay(s, day)));
  const deadlines = usePlannerStore(useShallow((s) => deadlinesOn(s, day)));

  useEffect(() => {
    void loadRange('day', day);
  }, [day, loadRange]);

  const go = (to: string): void => setDay(to === today ? null : to);

  return (
    <section className={styles.view} aria-label="Day">
      <div className={styles.dayNav}>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Previous day"
          onClick={() => go(addDays(day, -1))}
        >
          ‹
        </button>
        <span className={styles.dayLabel}>
          {day === today ? `Today · ${formatDayLabel(day)}` : formatDayLabel(day)}
        </span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Next day"
          onClick={() => go(addDays(day, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className={styles.textButton}
          disabled={day === today}
          onClick={() => setDay(null)}
        >
          Today
        </button>
      </div>
      {deadlines.length > 0 && (
        <div className={styles.deadlines}>
          {deadlines.map((d) => (
            <DeadlineChip key={d.id} deadline={d} />
          ))}
        </div>
      )}
      <DropZone id={dayZone(day)} items={tasks.map((t) => t.id)}>
        {tasks.length === 0 ? (
          <p className={styles.empty}>Nothing planned for this day.</p>
        ) : (
          <ul className={styles.rows}>
            {tasks.map((t) => (
              <SortableTask key={t.id} task={t} />
            ))}
          </ul>
        )}
      </DropZone>
      <QuickAdd
        label="Add a task"
        place={chosen === null ? () => ({ day: plannerToday(rolloverHour) }) : { day }}
      />
    </section>
  );
}
