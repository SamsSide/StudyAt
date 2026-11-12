// Planner writes (v1.2 spec §3.6, §3.9, §5, §7): tasks, subtasks and lists, with repeat copies,
// revision tasks and roll forward. Every method returns full `PlannerTask`s (via `planner`), so the
// renderer never has to merge rows. `now` is injected; "today" is the study day (spec §7).
import { dayKeyOf } from '../../core/time';
import { nextRepeatDay, revisionSchedule, rollForwardMoves, upcomingExam } from '../../core/planner/schedule';
import { wallStamp } from '../../core/wallclock';
import {
  LIMIT_COPY,
  LIST_NAME_MAX,
  MAX_LISTS,
  MAX_SUBTASKS,
  MAX_TAGS,
  REVISION_DAYS_MAX,
  REVISION_PREFIX,
  REVISION_TAG,
  SUBTASK_TEXT_MAX,
  TASK_GONE,
  TASK_TITLE_MAX,
  normaliseTag,
} from '../../shared/planner';
import type {
  ListInput,
  ListPatch,
  ListsChange,
  PlannerTask,
  TaskChange,
  TaskInput,
  TaskList,
  TaskMove,
  TaskUpdate,
} from '../../shared/types';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { plannerTasksRepo, type TaskRow, type TaskRowPatch } from '../db/repos/plannerTasks';
import { settingsRepo } from '../db/repos/settings';
import { subjectsRepo } from '../db/repos/subjects';
import { taskListsRepo } from '../db/repos/taskLists';
import { all, int, transaction } from '../db/sql';
import { deadlineDay, type PlannerService } from './planner';
import { IpcValidationError } from './validate';

export interface TaskWritesDeps {
  db: Db;
  now: () => number;
  planner: PlannerService;
}

export type TaskWrites = ReturnType<typeof taskWritesService>;

const NO_TASK = 'No such task';
const NO_LIST = 'No such list';
const NO_SUBJECT = 'No such subject';
const NO_SUBTASK = 'No such subtask';
const DATED_ONLY = 'Repeat and reminders are for tasks on a day';
const NO_REVISION_OF_REVISION = 'Revision tasks never offer revision again';
const SUBTASK_LENGTH = `A subtask is 1 to ${SUBTASK_TEXT_MAX} characters`;

/** A copy of `patch` without the keys whose value is `undefined` (a missing key keeps the stored value). */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function fail(message: string): never {
  throw new IpcValidationError(message);
}

export function taskWritesService(deps: TaskWritesDeps) {
  const { db, planner } = deps;
  const tasks = plannerTasksRepo(db);
  const lists = taskListsRepo(db);
  const deadlines = deadlinesRepo(db);
  const settings = settingsRepo(db);
  const subjects = subjectsRepo(db);

  const need = (id: number): TaskRow => tasks.get(id) ?? fail(NO_TASK);
  const needList = (id: number): TaskList => lists.get(id) ?? fail(NO_LIST);
  const checkSubject = (id: number | null | undefined): void => {
    if (id === null || id === undefined) return;
    if (!subjects.list().some((s) => s.id === id)) fail(NO_SUBJECT);
  };
  const checkTitle = (title: string): void => {
    if (title.trim().length === 0) fail('A task needs a title');
    if (title.length > TASK_TITLE_MAX) fail(`A title is 1 to ${TASK_TITLE_MAX} characters`);
  };
  const cleanTags = (tags: string[]): string[] => {
    const out = [...new Set(tags.map(normaliseTag).filter((t): t is string => t !== null))];
    if (out.length > MAX_TAGS) fail(LIMIT_COPY.tags);
    return out;
  };
  const checkListName = (name: string): string => {
    const trimmed = name.trim();
    // Code points, like the migration's SQLite substr.
    const n = [...trimmed].length;
    if (n < 1 || n > LIST_NAME_MAX) fail(`A list name is 1 to ${LIST_NAME_MAX} characters`);
    return trimmed;
  };

  /** Full tasks for `ids` as stored now, in the given order, each once. */
  const reload = (ids: number[]): PlannerTask[] => {
    const rows = [...new Set(ids)].map((id) => tasks.get(id)).filter((r): r is TaskRow => r !== null);
    return planner.toPlanner(rows);
  };
  const changed = (ids: number[], removed: number[] = []): TaskChange => ({ tasks: reload(ids), removed });
  const parentOf = (taskId: number): PlannerTask => planner.task(taskId) ?? fail(TASK_GONE);

  /** A copy of `row` in the same place: subtasks unticked, never done. */
  const copyOf = (row: TaskRow, day: string | null, listId: number | null): TaskRow =>
    tasks.create(
      {
        title: row.title,
        note: row.note,
        colour: row.colour,
        day,
        listId,
        subjectId: row.subjectId,
        estimateMin: row.estimateMin,
        repeat: row.repeat,
        reminder: row.reminder,
        kind: row.kind,
        originTaskId: row.originTaskId,
        tags: row.tags,
        subtasks: row.subtasks.map((s) => ({ text: s.text, done: false })),
      },
      deps.now(),
    );

  /**
   * A dated task into a list, clearing repeat and reminder in the same transaction as the move
   * (spec §3.6). The repo's `place` has its own transaction and sql.js does not nest, so this
   * renumbers by hand; returns the ids it renumbered.
   */
  const placeInListClearing = (current: TaskRow, listId: number, index: number): number[] => {
    const open = (column: 'day' | 'list_id', key: string | number): number[] =>
      all(db.raw, `SELECT id FROM tasks WHERE ${column} = ? AND done = 0 AND id != ? ORDER BY sort, id`, [
        key,
        current.id,
      ]).map((r) => int(r.id));
    const renumber = (ids: number[]): void =>
      ids.forEach((id, sort) => db.raw.run('UPDATE tasks SET sort = ? WHERE id = ?', [sort, id]));
    let touched: number[] = [];
    transaction(db.raw, () => {
      const old = current.day === null ? [] : open('day', current.day);
      const siblings = open('list_id', listId);
      siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, current.id);
      db.raw.run(
        `UPDATE tasks SET day = NULL, list_id = ?, repeat = NULL, reminder = NULL, reminded_day = NULL,
                updated_at = ? WHERE id = ?`,
        [listId, deps.now(), current.id],
      );
      renumber(old);
      renumber(siblings);
      touched = [...old, ...siblings];
    });
    db.markDirty();
    return touched;
  };

  return {
    create(input: TaskInput): TaskChange {
      checkTitle(input.title);
      if (input.day !== undefined && input.listId !== undefined) fail('A task is on a day or in a list');
      if (input.listId !== undefined) needList(input.listId);
      checkSubject(input.subjectId);
      const row = tasks.create(
        {
          title: input.title,
          note: input.note,
          colour: input.colour,
          day: input.listId === undefined ? (input.day ?? planner.today()) : null,
          listId: input.listId ?? null,
          subjectId: input.subjectId,
          estimateMin: input.estimateMin,
          tags: cleanTags(input.tags ?? []),
        },
        deps.now(),
      );
      return changed([row.id]);
    },

    update(id: number, patch: TaskUpdate): TaskChange {
      const current = need(id);
      const { tags, ...fields } = defined(patch);
      if (fields.title !== undefined) checkTitle(fields.title);
      if (fields.subjectId !== undefined) checkSubject(fields.subjectId);
      const cleaned = tags === undefined ? undefined : cleanTags(tags);
      if (
        current.day === null &&
        ((fields.repeat !== undefined && fields.repeat !== null) ||
          (fields.reminder !== undefined && fields.reminder !== null))
      ) {
        fail(DATED_ONLY);
      }
      const rowPatch: TaskRowPatch = { ...fields };
      // A new reminder time may fire again on its day.
      if (fields.reminder !== undefined && fields.reminder !== current.reminder) rowPatch.remindedDay = null;
      const next = tasks.update(id, rowPatch, deps.now()) ?? fail(NO_TASK);
      if (cleaned !== undefined) tasks.setTags(id, cleaned);

      const ids = [id];
      // Ticking is done going false -> true; only a dated repeating task makes the next copy.
      if (!current.done && next.done && next.repeat !== null && next.day !== null) {
        const source = tasks.get(id) ?? next;
        const target = nextRepeatDayOf(next.repeat, next.day);
        const rule = JSON.stringify(source.repeat);
        // Tick, untick, tick must not stack a second copy on the same day (appplan §3.6).
        const already = tasks
          .onDays(target, target)
          .some((t) => t.title === source.title && t.kind === source.kind && JSON.stringify(t.repeat) === rule);
        if (!already) ids.push(copyOf(source, target, null).id);
      }
      return changed(ids);
    },

    move(id: number, to: TaskMove): TaskChange {
      const current = need(id);
      let touched: number[];
      if ('day' in to) {
        // From a linked list to a day: the task keeps its own subject, else takes the list's.
        if (current.listId !== null && current.subjectId === null) {
          const inherited = lists.get(current.listId)?.subjectId ?? null;
          if (inherited !== null) tasks.update(id, { subjectId: inherited }, deps.now());
        }
        touched = tasks.place(id, { day: to.day }, to.index, deps.now()).map((r) => r.id);
      } else {
        needList(to.listId);
        touched =
          current.day !== null
            ? placeInListClearing(current, to.listId, to.index)
            : tasks.place(id, { listId: to.listId }, to.index, deps.now()).map((r) => r.id);
      }
      return changed([id, ...touched]);
    },

    remove(id: number): TaskChange {
      need(id);
      tasks.remove(id);
      return { tasks: [], removed: [id] };
    },

    duplicate(id: number): TaskChange {
      const row = need(id);
      const copy = copyOf(row, row.day, row.listId);
      // Right after the original among its open siblings (the end when the original is done).
      const siblings = (row.day !== null ? tasks.onDays(row.day, row.day) : tasks.inLists(row.listId ?? -1))
        .filter((t) => !t.done && t.id !== copy.id)
        .sort((a, b) => a.sort - b.sort || a.id - b.id);
      const at = siblings.findIndex((t) => t.id === id);
      const index = row.done || at < 0 ? siblings.length : at + 1;
      const to = row.day !== null ? { day: row.day } : { listId: row.listId ?? -1 };
      const touched = tasks.place(copy.id, to, index, deps.now()).map((r) => r.id);
      return changed([copy.id, ...touched]);
    },

    scheduleRevision(id: number, days: number[]): TaskChange {
      const row = need(id);
      if (row.kind === 'revision') fail(NO_REVISION_OF_REVISION);
      for (const n of days) {
        if (!Number.isInteger(n) || n < 1 || n > REVISION_DAYS_MAX) {
          fail(`Revision days are 1 to ${REVISION_DAYS_MAX}`);
        }
      }
      const subjectId = planner.effectiveSubject(row);
      const exam = upcomingExam(deadlines.all(), subjectId, wallStamp(deps.now()));
      const examDay = exam ? deadlineDay(exam.due, settings.get().rolloverHour) : null;
      const created: number[] = [];
      for (const day of revisionSchedule(planner.today(), days, examDay)) {
        const made = tasks.create(
          {
            title: (REVISION_PREFIX + row.title).slice(0, TASK_TITLE_MAX),
            day,
            listId: null,
            subjectId,
            estimateMin: null,
            kind: 'revision',
            originTaskId: id,
            tags: [REVISION_TAG],
          },
          deps.now(),
        );
        created.push(made.id);
      }
      return changed(created);
    },

    /** Spec §3.6: nothing unless settings.rollTasksForward; then every open task before today moves to today. */
    rollForward(now: number): TaskChange {
      const s = settings.get();
      if (!s.rollTasksForward) return { tasks: [], removed: [] };
      const today = dayKeyOf(now, s.rolloverHour);
      const moves = rollForwardMoves(tasks.openBefore(today), today);
      if (moves.length === 0) return { tasks: [], removed: [] };
      // To the end of today's tasks, in their old order.
      const end = tasks.onDays(today, today).reduce((m, t) => Math.max(m, t.sort + 1), 0);
      transaction(db.raw, () => {
        moves.forEach((m, i) =>
          tasks.update(m.id, { day: m.day, rolledFrom: m.rolledFrom, sort: end + i }, now),
        );
      });
      return changed(moves.map((m) => m.id));
    },

    addSubtask(taskId: number, text: string): PlannerTask {
      const row = need(taskId);
      const trimmed = text.trim();
      if (trimmed.length === 0 || trimmed.length > SUBTASK_TEXT_MAX) fail(SUBTASK_LENGTH);
      if (row.subtasks.length >= MAX_SUBTASKS) fail(LIMIT_COPY.subtasks);
      tasks.addSubtask(taskId, trimmed);
      return parentOf(taskId);
    },

    updateSubtask(id: number, patch: { text?: string; done?: boolean }): PlannerTask {
      const clean = defined(patch);
      if (clean.text !== undefined) {
        clean.text = clean.text.trim();
        if (clean.text.length === 0 || clean.text.length > SUBTASK_TEXT_MAX) fail(SUBTASK_LENGTH);
      }
      const sub = tasks.updateSubtask(id, clean) ?? fail(NO_SUBTASK);
      return parentOf(sub.taskId);
    },

    removeSubtask(id: number): PlannerTask {
      const sub = tasks.removeSubtask(id) ?? fail(NO_SUBTASK);
      return parentOf(sub.taskId);
    },

    reorderSubtasks(taskId: number, ids: number[]): PlannerTask {
      need(taskId);
      tasks.reorderSubtasks(taskId, ids);
      return parentOf(taskId);
    },

    createList(input: ListInput): TaskList[] {
      const name = checkListName(input.name);
      if (lists.count() >= MAX_LISTS) fail(LIMIT_COPY.lists);
      checkSubject(input.subjectId);
      lists.create({ name, subjectId: input.subjectId ?? null }, deps.now());
      return lists.list();
    },

    updateList(id: number, patch: ListPatch): TaskList[] {
      needList(id);
      const clean = defined(patch);
      if (clean.name !== undefined) clean.name = checkListName(clean.name);
      if (clean.subjectId !== undefined) checkSubject(clean.subjectId);
      lists.update(id, clean);
      return lists.list();
    },

    reorderLists(ids: number[]): TaskList[] {
      lists.reorder(ids);
      return lists.list();
    },

    /** Deletes the list and its tasks (with tags and subtasks). */
    removeList(id: number): ListsChange {
      needList(id);
      // Through the repo, so the focus timer hears of removed tasks.
      for (const t of tasks.inLists(id)) tasks.remove(t.id);
      lists.remove(id);
      return { lists: lists.list(), removed: [id] };
    },

    clearDone(listId: number): TaskChange {
      needList(listId);
      return { tasks: [], removed: tasks.clearDone(listId) };
    },
  };

  function nextRepeatDayOf(rule: NonNullable<TaskRow['repeat']>, day: string): string {
    return nextRepeatDay(rule, day, planner.today());
  }
}
