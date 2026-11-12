// The placement chip (v1.2 spec §3.7): the task's day or list, and the keyboard alternative to
// dragging. Choosing a day or a list moves the task to the end of it.
import { useId, useRef, useState } from 'react';
import { addDays } from '../../core/time';
import type { PlannerTask, TaskMove } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { formatDayLabel } from '../stats/format';
import { plannerToday } from './format';
import { usePlannerStore } from './plannerStore';
import styles from './detail.module.css';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/** A whole, sensible date: typing a year passes through 0002-11-11 on the way. */
const validDay = (v: string): boolean =>
  DAY_RE.test(v) && Number(v.slice(0, 4)) >= YEAR_MIN && Number(v.slice(0, 4)) <= YEAR_MAX;

type Dest = { day: string } | { listId: number };

/** How many tasks are in the destination, so the move lands at its end. */
async function endIndex(id: number, dest: Dest): Promise<number> {
  try {
    const api = window.studyat.planner;
    const tasks = 'day' in dest ? (await api.day(dest.day)).tasks : (await api.lists()).tasks;
    usePlannerStore.getState().apply({ tasks, removed: [] });
  } catch {
    // Fall back to what is already loaded.
  }
  const here = (t: PlannerTask): boolean => ('day' in dest ? t.day === dest.day : t.listId === dest.listId);
  return Object.values(usePlannerStore.getState().tasks).filter((t) => t.id !== id && here(t)).length;
}

export function PlacementPicker({ task }: { task: PlannerTask }) {
  const lists = usePlannerStore((s) => s.lists);
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const move = usePlannerStore((s) => s.move);
  const loadLists = usePlannerStore((s) => s.loadLists);
  const [open, setOpen] = useState(false);
  // The date field's draft: stepping or typing never moves the task, only Enter in the field or the Move button.
  // Leaving the field commits nothing, so Esc and the quick buttons are never overridden by it.
  const [dayDraft, setDayDraft] = useState<string | null>(null);
  const moving = useRef(false);
  const chip = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const label =
    task.day !== null ? formatDayLabel(task.day) : (lists.find((l) => l.id === task.listId)?.name ?? 'List');

  const go = async (dest: Dest): Promise<void> => {
    if (moving.current) return;
    moving.current = true;
    try {
      const to: TaskMove = { ...dest, index: await endIndex(task.id, dest) };
      setOpen(false);
      setDayDraft(null);
      chip.current?.focus();
      await move(task.id, to);
    } finally {
      moving.current = false;
    }
  };

  const dayValue = dayDraft ?? task.day ?? '';
  const dayReady = validDay(dayValue) && dayValue !== task.day;
  const commitDay = (): void => {
    if (dayReady) void go({ day: dayValue });
  };

  const today = plannerToday(rolloverHour);

  return (
    <div
      className={styles.placement}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setDayDraft(null);
        setOpen(false);
        chip.current?.focus();
      }}
    >
      <button
        ref={chip}
        type="button"
        className={styles.chipButton}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Placement: ${label}`}
        onClick={() => {
          if (!open && lists.length === 0) void loadLists();
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Move task" className={styles.placementPanel}>
          <div className={styles.inline}>
            <button type="button" className={styles.smallButton} onClick={() => void go({ day: today })}>
              Today
            </button>
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => void go({ day: addDays(today, 1) })}
            >
              Tomorrow
            </button>
          </div>
          <label className={styles.field}>
            <span>Day</span>
            <input
              type="date"
              className={styles.input}
              min={`${YEAR_MIN}-01-01`}
              max={`${YEAR_MAX}-12-31`}
              value={dayValue}
              aria-invalid={dayDraft !== null && dayDraft !== '' && !validDay(dayDraft) ? true : undefined}
              onChange={(e) => setDayDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                commitDay();
              }}
            />
          </label>
          <button type="button" className={styles.smallButton} disabled={!dayReady} onClick={commitDay}>
            Move
          </button>
          {lists.length > 0 && (
            <ul className={styles.listChoices} aria-label="Lists">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className={styles.smallButton}
                    aria-pressed={task.listId === l.id}
                    onClick={() => void go({ listId: l.id })}
                  >
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
