// The board's Day (v1.2 spec §3.7): the chosen day's tasks large, each with its note, subtasks and
// estimate vs actual laid open, under a head with "<planned> planned · <studied> studied" and the
// day's deadlines; the lists stand in a right-hand column to drag from. One drop space with the
// board, so a list task dropped on the day lands there (and the insertion line shows where).
import { useEffect, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useShallow } from 'zustand/react/shallow';
import type { PlannerTask } from '../../../shared/types';
import { formatGoal } from '../../shell/format';
import { useStudyStore } from '../../shell/store';
import { formatDayLabel } from '../../stats/format';
import { DeadlineChip } from '../DeadlineChip';
import { DropZone, dayZone, taskDrag } from '../dnd';
import { estimateChip, rolledLabel } from '../format';
import { tasksOnDay, usePlannerStore, type PlannerState } from '../plannerStore';
import { QuickAdd } from '../QuickAdd';
import { useToday } from '../useToday';
import { InsertLine, useInsertHint } from './BoardDrag';
import { BoardLists } from './BoardLists';
import { deadlinesFor, plannedMs } from './BoardWeek';
import styles from './board.module.css';
import row from '../planner.module.css';

/** One task, opened out: check, title, chips, then its note and subtasks. Grip and ▶ as in a row. */
function DayCard({ task }: { task: PlannerTask }) {
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === task.effectiveSubjectId));
  const update = usePlannerStore((s) => s.update);
  const updateSubtask = usePlannerStore((s) => s.updateSubtask);
  const openDetail = usePlannerStore((s) => s.openDetail);
  const startTask = usePlannerStore((s) => s.startTask);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDrag(task.id) });
  const estimate = task.estimateMin === null ? null : estimateChip(task.actualMs, task.estimateMin);

  const onCardClick = (e: MouseEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button, input, label')) return;
    openDetail(task.id);
  };

  return (
    <li
      ref={setNodeRef}
      className={styles.card}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      data-dragging={isDragging ? 'true' : undefined}
      data-task-id={task.id}
      data-done={task.done}
      data-colour={task.colour ?? undefined}
      onClick={onCardClick}
    >
      <div className={styles.cardHead}>
        <input
          type="checkbox"
          className={row.check}
          checked={task.done}
          aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
          onChange={() => void update(task.id, { done: !task.done })}
        />
        <button type="button" className={styles.cardTitle} onClick={() => openDetail(task.id)}>
          {task.title}
        </button>
        <span className={styles.cardTools}>
          <button
            type="button"
            className={row.play}
            aria-label={`Start focus on "${task.title}"`}
            onClick={() => void startTask(task.id)}
          >
            ▶
          </button>
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={row.grip}
            {...attributes}
            {...listeners}
            aria-label={`Move "${task.title}"`}
          >
            ⠿
          </button>
        </span>
      </div>
      <div className={styles.cardMeta}>
        {subject && (
          <span className={styles.subjectChip}>
            <span className={styles.dot} style={{ background: subject.colour }} aria-hidden="true" />
            {subject.name}
          </span>
        )}
        {estimate ? (
          <span className={row.chip} data-over={estimate.over ? 'true' : undefined}>
            {estimate.text}
          </span>
        ) : (
          task.actualMs > 0 && <span className={row.chip}>{`${formatGoal(task.actualMs)} focused`}</span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className={row.chip}>
            #{tag}
          </span>
        ))}
        {task.repeat && (
          <span className={row.chip} aria-label="Repeats">
            ↻
          </span>
        )}
        {task.reminder && (
          <span className={row.chip} aria-label={`Reminder ${task.reminder}`}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
            </svg>
          </span>
        )}
        {task.rolledFrom && <span className={row.chip}>{rolledLabel(task.rolledFrom)}</span>}
      </div>
      {task.note.trim() !== '' && <p className={styles.cardNote}>{task.note}</p>}
      {task.subtasks.length > 0 && (
        <ul className={styles.cardSubtasks} aria-label={`Subtasks of "${task.title}"`}>
          {task.subtasks.map((s) => (
            <li key={s.id} data-done={s.done}>
              <label>
                <input
                  type="checkbox"
                  className={row.check}
                  checked={s.done}
                  onChange={() => void updateSubtask(s.id, { done: !s.done })}
                />
                <span>{s.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function BoardDay({ day }: { day: string }) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? 4);
  const today = useToday(rolloverHour);
  const watchRange = usePlannerStore((s) => s.watchRange);
  const tasks = usePlannerStore(useShallow((s: PlannerState) => tasksOnDay(s, day)));
  const planned = usePlannerStore((s) => plannedMs(Object.values(s.tasks).filter((t) => t.day === day)));
  const studied = usePlannerStore((s) => s.studiedMs[day] ?? 0);
  const deadlines = usePlannerStore(useShallow((s: PlannerState) => deadlinesFor(s, day, rolloverHour)));
  const zone = dayZone(day);
  const hint = useInsertHint(zone, tasks);
  const lastOpen = tasks.reduce((at, t, i) => (t.done ? at : i), -1);
  const label = formatDayLabel(day);

  useEffect(() => {
    return watchRange('day', day).release;
  }, [day, watchRange]);

  return (
    <div className={styles.dayBoard}>
      <DropZone id={zone} className={styles.dayMain} items={tasks.map((t) => t.id)}>
        <section
          aria-label={label}
          className={styles.daySheet}
          data-today={day === today ? 'true' : undefined}
        >
          <header className={styles.dayHead}>
            <h3 className={styles.dayName}>{day === today ? `Today · ${label}` : label}</h3>
            <p
              className={styles.dayStats}
            >{`${formatGoal(planned)} planned · ${formatGoal(studied)} studied`}</p>
            {deadlines.length > 0 && (
              <div className={styles.deadlines}>
                {deadlines.map((d) => (
                  <DeadlineChip key={d.id} deadline={d} />
                ))}
              </div>
            )}
          </header>
          <div className={styles.dayBody}>
            {tasks.length === 0 && hint === null ? (
              <p className={styles.dayEmpty}>Nothing planned for this day.</p>
            ) : (
              <ul className={styles.cards}>
                {hint === 'end' && lastOpen === -1 && <InsertLine />}
                {tasks.map((t, i) => (
                  <DayCardSlot
                    key={t.id}
                    task={t}
                    before={hint === t.id}
                    after={hint === 'end' && i === lastOpen}
                  />
                ))}
              </ul>
            )}
            <div className={styles.dayAdd}>
              <QuickAdd label={`Add to ${label}`} place={{ day }} placeholder="Add…" />
            </div>
          </div>
        </section>
      </DropZone>
      <div className={styles.dayLists} data-day-lists="">
        <BoardLists layout="stack" />
      </div>
    </div>
  );
}

/** A card with the insertion line before or after it, when a drag from elsewhere lands there. */
function DayCardSlot({ task, before, after }: { task: PlannerTask; before: boolean; after: boolean }) {
  return (
    <>
      {before && <InsertLine />}
      <DayCard task={task} />
      {after && <InsertLine />}
    </>
  );
}
