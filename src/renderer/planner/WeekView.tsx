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
  const isToday = day === today;

  return (
    <DropZone id={dayZone(day)} className={styles.weekDay} items={tasks.map((t) => t.id)}>
      <section aria-label={label} data-today={isToday ? 'true' : undefined}>
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
  const watchRange = usePlannerStore((s) => s.watchRange);
  const start = weekStartOf(chosen);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // Today's section is scrolled to the top of the week's own scroller when a week holding it opens
  // (E8), and again whenever the week's content changes size while it shows, until the user scrolls
  // by hand: the days above today grow as their tasks load and draw, frames after the first scroll.
  // Its scrollTop only: scrollIntoView would scroll every ancestor too, the board's page and the
  // window among them. A spacer after Sunday tops the content after today (from today's top to the
  // spacer's, plus the scroller's bottom padding) up to the scroller's height, so a week whose later
  // days are short can still scroll far enough to put today at the very top. A week without today
  // has no spacer.
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let follow = true;
    let frame = 0;
    const box = scroller.current;
    const pad = spacer.current;
    const toToday = (): void => {
      if (!live || !follow || !box) return;
      const section = box.querySelector<HTMLElement>('section[data-today]');
      if (!section) {
        if (pad) pad.style.height = '0px';
        return;
      }
      // Rects are screen px, scrollTop and clientHeight CSS px: the widget's transform: scale sits
      // between them, so every rect distance is divided by it.
      const boxRect = box.getBoundingClientRect();
      const scale = box.offsetHeight > 0 && boxRect.height > 0 ? boxRect.height / box.offsetHeight : 1;
      const top = section.getBoundingClientRect().top;
      const offset = (top - boxRect.top) / scale + box.scrollTop;
      if (pad) {
        const bottom = parseFloat(getComputedStyle(box).paddingBottom) || 0;
        const after = (pad.getBoundingClientRect().top - top) / scale + bottom;
        pad.style.height = `${Math.max(0, Math.ceil(box.clientHeight - after))}px`;
      }
      box.scrollTop = offset;
    };
    // A wheel, a touch, a key or a press in the scroller (its scrollbar too) hands it to the user.
    const stop = (): void => {
      follow = false;
    };
    const hands = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const type of hands) box?.addEventListener(type, stop, { passive: true });
    // Each day's section (today's among them): together they are the content's size. jsdom has no
    // ResizeObserver; the frame after the load below covers it there.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(toToday);
    if (box && observer) {
      for (const child of Array.from(box.children)) if (child !== pad) observer.observe(child);
      const section = box.querySelector('section[data-today]');
      if (section) observer.observe(section);
    }
    toToday();
    const watch = watchRange('week', start);
    void watch.loaded.then(() => {
      if (live) frame = requestAnimationFrame(toToday);
    });
    return () => {
      live = false;
      watch.release();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const type of hands) box?.removeEventListener(type, stop);
    };
  }, [start, today, watchRange]);

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
      <div ref={scroller} className={styles.weekDays}>
        {days.map((d) => (
          <DaySection key={d} day={d} today={today} />
        ))}
        <div ref={spacer} aria-hidden="true" className={styles.weekSpacer} />
      </div>
    </section>
  );
}
