// The widget's Week view (v1.2 spec §3.7): Monday to Sunday of the week holding the chosen day,
// each a collapsible section with its open count, rows you can drag between days, and a quick-add.
import { useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { addDays, weekStartOf } from '../../core/time';
import { useStudyStore } from '../shell/store';
import { formatDayLabel } from '../stats/format';
import { DropZone, dayZone, SortableTask } from './dnd';
import { boardTitle } from './format';
import { tasksOnDay, usePlannerStore, type PlannerState } from './plannerStore';
import { QuickAdd } from './QuickAdd';
import { useToday } from './useToday';
import styles from './planner.module.css';

function DaySection({ day, today }: { day: string; today: string }) {
  const [open, setOpen] = useState(true);
  const tasks = usePlannerStore(useShallow((s: PlannerState) => tasksOnDay(s, day)));
  const openCount = tasks.filter((t) => !t.done).length;
  const label = formatDayLabel(day);
  const bodyId = useId();
  const ref = useRef<HTMLElement>(null);
  const isToday = day === today;

  // Today's section is open and scrolled into view when the week opens (E8).
  useEffect(() => {
    if (isToday) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [isToday]);

  return (
    <DropZone id={dayZone(day)} className={styles.weekDay} items={tasks.map((t) => t.id)}>
      <section ref={ref} aria-label={label} data-today={isToday ? 'true' : undefined}>
        <button
          type="button"
          className={styles.weekHead}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true" className={styles.caret} data-open={open}>
            ›
          </span>
          {`${label} · ${openCount} open`}
        </button>
        {open && (
          <div id={bodyId}>
            {tasks.length > 0 && (
              <ul className={styles.rows}>
                {tasks.map((t) => (
                  <SortableTask key={t.id} task={t} />
                ))}
              </ul>
            )}
            <QuickAdd label={`Add to ${label}`} place={{ day }} />
          </div>
        )}
      </section>
    </DropZone>
  );
}

export function WeekView() {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const today = useToday(rolloverHour);
  const chosen = usePlannerStore((s) => s.day) ?? today;
  const setDay = usePlannerStore((s) => s.setDay);
  const loadRange = usePlannerStore((s) => s.loadRange);
  const start = weekStartOf(chosen);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  useEffect(() => {
    void loadRange('week', start);
  }, [start, loadRange]);

  // Landing on the week that holds today clears the day, so the Day tab opens on today.
  const go = (to: string): void => {
    const week = weekStartOf(to);
    setDay(week === weekStartOf(today) ? null : week);
  };

  return (
    <section className={styles.view} aria-label="Week">
      <div className={styles.dayNav}>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Previous week"
          onClick={() => go(addDays(start, -7))}
        >
          ‹
        </button>
        <span className={styles.dayLabel}>{boardTitle(start)}</span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Next week"
          onClick={() => go(addDays(start, 7))}
        >
          ›
        </button>
      </div>
      <div className={styles.weekDays}>
        {days.map((d) => (
          <DaySection key={d} day={d} today={today} />
        ))}
      </div>
    </section>
  );
}
