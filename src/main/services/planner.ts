// Planner reads (v1.2 spec §3.6-§3.8, §5): tasks with their effective subject and actual focus,
// deadlines per day, and focus time studied per day. Read-only: it never creates or alters a
// session row. Settings are read per call, like `statsService`.
import { dayTotals, todayKey, type StatsContext } from '../../core/stats/totals';
import { addDays, dayKeyOf, weekStartOf } from '../../core/time';
import { parseDue, wallStamp } from '../../core/wallclock';
import type { Deadline, ListsView, PlannerRange, PlannerTask, Session } from '../../shared/types';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { plannerTasksRepo, type TaskRow } from '../db/repos/plannerTasks';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { taskListsRepo } from '../db/repos/taskLists';
import { withLiveAccrual } from './stats';

export interface PlannerServiceDeps {
  db: Db;
  now: () => number;
  /** Today's focus time including the running segment (`timer.getState().todayFocusMs`). */
  liveTodayMs: () => number;
  /** IANA zone, for tests only. */
  tz?: string;
}

export type PlannerService = ReturnType<typeof plannerService>;

/**
 * The study day a deadline's wall-clock `due` ('YYYY-MM-DDTHH:MM') belongs to: the instant mapped
 * through the study-day rule, so an exam at 02:00 with rollover 04:00 sits on the previous day.
 * Countdowns elsewhere stay wall-clock.
 */
export function deadlineDay(due: string, rolloverHour: number, tz?: string): string {
  return dayKeyOf(parseDue(due), rolloverHour, tz);
}

/** The Sunday ending the week that holds the last day of `month` ('YYYY-MM'). */
function monthEnd(month: string): string {
  const [y = NaN, m = NaN] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of the next month
  const key = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
  return addDays(weekStartOf(key), 6);
}

const byOrder = (a: PlannerTask, b: PlannerTask): number =>
  Number(a.done) - Number(b.done) || a.sort - b.sort || a.id - b.id;

export function plannerService(deps: PlannerServiceDeps) {
  const tasks = plannerTasksRepo(deps.db);
  const lists = taskListsRepo(deps.db);
  const deadlines = deadlinesRepo(deps.db);
  const sessions = sessionsRepo(deps.db);
  const settings = settingsRepo(deps.db);

  const contextAt = (now: number): StatsContext => {
    const s = settings.get();
    return {
      now,
      rolloverHour: s.rolloverHour,
      streakMinutes: s.streakMinutes,
      goalMinutes: s.goalMinutes,
      tz: deps.tz,
    };
  };

  /** Every session row, the running one topped up to the controller's live figure. */
  const history = (ctx: StatsContext): Session[] =>
    withLiveAccrual(sessions.all(), todayKey(ctx), deps.liveTodayMs());

  const actualOf = (rows: Session[]): Map<number, number> => {
    const actual = new Map<number, number>();
    for (const s of rows) {
      if (s.taskId === null) continue;
      actual.set(s.taskId, (actual.get(s.taskId) ?? 0) + s.focusMs);
    }
    return actual;
  };

  const convert = (rows: TaskRow[], actual: Map<number, number>): PlannerTask[] => {
    const subjectOfList = new Map(lists.list().map((l) => [l.id, l.subjectId]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note,
      done: r.done,
      doneAt: r.doneAt,
      colour: r.colour,
      day: r.day,
      listId: r.listId,
      subjectId: r.subjectId,
      effectiveSubjectId: r.subjectId ?? (r.listId === null ? null : (subjectOfList.get(r.listId) ?? null)),
      estimateMin: r.estimateMin,
      tags: r.tags,
      subtasks: r.subtasks,
      repeat: r.repeat,
      reminder: r.reminder,
      kind: r.kind,
      originTaskId: r.originTaskId,
      rolledFrom: r.rolledFrom,
      sort: r.sort,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      actualMs: actual.get(r.id) ?? 0,
    }));
  };

  const service = {
    /** The study-day key of now (settings.rolloverHour): the planner's today = the stats' today. */
    today(): string {
      return todayKey(contextAt(deps.now()));
    },

    /** Own subject, else the list's subject (spec §3.6). */
    effectiveSubject(row: TaskRow): number | null {
      if (row.subjectId !== null) return row.subjectId;
      return row.listId === null ? null : (lists.get(row.listId)?.subjectId ?? null);
    },

    /** Focus ms per task id over every session, the running row topped up live. */
    actualByTask(): Map<number, number> {
      return actualOf(history(contextAt(deps.now())));
    },

    toPlanner(rows: TaskRow[]): PlannerTask[] {
      return convert(rows, service.actualByTask());
    },

    task(id: number): PlannerTask | null {
      const row = tasks.get(id);
      return row ? (service.toPlanner([row])[0] ?? null) : null;
    },

    /** Tasks dated from..to; open deadlines on those study days; focus ms per day. */
    range(from: string, to: string): PlannerRange {
      const ctx = contextAt(deps.now());
      const rows = history(ctx);
      const dated = convert(tasks.onDays(from, to), actualOf(rows)).sort(
        (a, b) => (a.day ?? '').localeCompare(b.day ?? '') || byOrder(a, b),
      );
      const due = deadlines.all().filter((d) => {
        if (d.done) return false;
        const day = deadlineDay(d.due, ctx.rolloverHour, ctx.tz);
        return day >= from && day <= to;
      });
      const studiedMs: Record<string, number> = {};
      for (const [day, total] of dayTotals(rows)) {
        if (day >= from && day <= to && total.ms > 0) studiedMs[day] = total.ms;
      }
      return { from, to, tasks: dated, deadlines: due, studiedMs };
    },

    week(day: string): PlannerRange {
      const from = weekStartOf(day);
      return service.range(from, addDays(from, 6));
    },

    /** 'YYYY-MM': whole Monday-Sunday weeks around the month. */
    month(month: string): PlannerRange {
      return service.range(weekStartOf(`${month}-01`), monthEnd(month));
    },

    day(day: string): PlannerRange {
      return service.range(day, day);
    },

    /** Every list, every list task, and the open deadlines due after now (soonest first). */
    lists(): ListsView {
      const nowWall = wallStamp(deps.now());
      const listed = convert(tasks.inLists(), service.actualByTask()).sort(
        (a, b) => (a.listId ?? 0) - (b.listId ?? 0) || byOrder(a, b),
      );
      const upcoming: Deadline[] = deadlines.all().filter((d) => !d.done && d.due > nowWall);
      return { lists: lists.list(), tasks: listed, deadlines: upcoming };
    },
  };
  return service;
}
