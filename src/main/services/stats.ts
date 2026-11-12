// Stats served to the renderer (spec §3.5; appplan §4.7): the pure Task 3 functions run over the
// full session history, read from settings each call. The running row is included with its live
// accrual for today: the database copy lags by up to one 15 s checkpoint, so today's total is
// topped up to the controller's `todayFocusMs`, the same figure the timer widget and top bar show.
import {
  estimatesCard,
  goalCard,
  rangeDays,
  subjectsCard,
  totalCard,
  type EstimateTask,
} from '../../core/stats/cards';
import { heatmap } from '../../core/stats/heatmap';
import { overview } from '../../core/stats/overview';
import {
  bySubject,
  byTask,
  dayTotals,
  todayKey,
  trend,
  weekBars,
  type StatsContext,
} from '../../core/stats/totals';
import { weekStartOf } from '../../core/time';
import type { SessionFilter } from '../../shared/ipc';
import type {
  CardData,
  HeatmapCell,
  Session,
  StatCard,
  StatRange,
  StatsOverview,
  SubjectRange,
  SubjectTotal,
  TaskTotal,
  TrendPoint,
  WeekBars,
} from '../../shared/types';
import type { Db } from '../db/db';
import { plannerTasksRepo } from '../db/repos/plannerTasks';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { subjectsRepo } from '../db/repos/subjects';
import { taskListsRepo } from '../db/repos/taskLists';
import { assertDayKey, assertIntOrNull, assertRecord, IpcValidationError } from './validate';

export interface StatsServiceDeps {
  db: Db;
  now: () => number;
  /** Today's focus time including the running segment (`timer.getState().todayFocusMs`). */
  liveTodayMs: () => number;
  /** IANA zone, for tests only. */
  tz?: string;
}

export type StatsService = ReturnType<typeof statsService>;

/** Validates a renderer `stats.sessions` filter. */
export function sanitiseSessionFilter(v: unknown): SessionFilter {
  if (v === undefined || v === null) return {};
  const f = assertRecord(v, 'filter');
  const out: SessionFilter = {};
  if (f.from !== undefined) out.from = assertDayKey(f.from, 'from');
  if (f.to !== undefined) out.to = assertDayKey(f.to, 'to');
  if (f.subjectId !== undefined) out.subjectId = assertIntOrNull(f.subjectId, 'subjectId');
  return out;
}

/**
 * `sessions` with today's figure raised to `liveMs`: the gap is credited to today's running row
 * (a copy). Rows are never lowered, so a pending away discard can't make history shrink here.
 */
export function withLiveAccrual(sessions: Session[], today: string, liveMs: number): Session[] {
  let stored = 0;
  for (const s of sessions) if (s.dayKey === today) stored += s.focusMs;
  const gap = liveMs - stored;
  if (gap <= 0) return sessions;
  const running = sessions.findIndex((s) => s.status === 'running' && s.dayKey === today);
  if (running < 0) return sessions;
  return sessions.map((s, i) => (i === running ? { ...s, focusMs: s.focusMs + gap } : s));
}

export function statsService(deps: StatsServiceDeps) {
  const sessions = sessionsRepo(deps.db);
  const settings = settingsRepo(deps.db);
  const subjects = subjectsRepo(deps.db);

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

  /** Every row, oldest first, with the live accrual when `now` is the present. */
  const historyAt = (ctx: StatsContext): Session[] =>
    withLiveAccrual(sessions.all(), todayKey(ctx), deps.liveTodayMs());

  const current = (): { ctx: StatsContext; rows: Session[] } => {
    const ctx = contextAt(deps.now());
    return { ctx, rows: historyAt(ctx) };
  };

  /** The row, if it exists and is done; returns its day key (for R25's recap refresh). */
  const editable = (id: number): string => {
    const row = sessions.all().find((s) => s.id === id);
    if (!row) throw new IpcValidationError('No such session');
    // The controller owns the running row in memory; an edit here would be overwritten or lost.
    if (row.status === 'running') throw new IpcValidationError('That session is still running');
    return row.dayKey;
  };

  return {
    contextAt,
    historyAt,

    overview(): StatsOverview {
      const { ctx, rows } = current();
      return overview(rows, ctx);
    },

    heatmap(): HeatmapCell[] {
      const { ctx, rows } = current();
      return heatmap(dayTotals(rows), ctx);
    },

    /** The Monday–Sunday week containing `weekStart` (any day of it), this week by default. */
    week(weekStart?: string): WeekBars {
      const { ctx, rows } = current();
      return weekBars(dayTotals(rows), weekStartOf(weekStart ?? todayKey(ctx)));
    },

    trend(): TrendPoint[] {
      const { ctx, rows } = current();
      return trend(dayTotals(rows), ctx);
    },

    bySubject(range: SubjectRange): SubjectTotal[] {
      const { ctx, rows } = current();
      return bySubject(rows, subjects.list(), range, ctx);
    },

    /**
     * Data for one stats widget card over `range` (v1.2 spec §3.12), from the same live rows as
     * the rest. The Estimates card takes done tasks only: the filter is `doneEstimated`'s.
     */
    card(card: StatCard, range: StatRange): CardData {
      const { ctx, rows } = current();
      switch (card) {
        case 'total':
          return totalCard(rows, range, ctx);
        case 'subjects':
          return subjectsCard(rows, subjects.list(), range, ctx);
        case 'goal':
          return goalCard(rows, range, ctx);
        case 'estimates': {
          const { from, to } = rangeDays(range, ctx);
          const listSubject = new Map(taskListsRepo(deps.db).list().map((l) => [l.id, l.subjectId]));
          const tasks: EstimateTask[] = [];
          for (const t of plannerTasksRepo(deps.db).doneEstimated(from, to)) {
            if (t.day === null || t.estimateMin === null) continue;
            tasks.push({
              id: t.id,
              title: t.title,
              day: t.day,
              estimateMin: t.estimateMin,
              effectiveSubjectId: t.subjectId ?? (t.listId === null ? null : (listSubject.get(t.listId) ?? null)),
            });
          }
          const actual = new Map<number, number>();
          for (const s of rows) if (s.taskId !== null) actual.set(s.taskId, (actual.get(s.taskId) ?? 0) + s.focusMs);
          return estimatesCard(tasks, actual, subjects.list(), range, ctx);
        }
      }
    },

    /** Top 10 tasks for `range`, largest first; the running row counts live (v1.1 spec §3.3). */
    byTask(range: SubjectRange): TaskTotal[] {
      const { ctx, rows } = current();
      return byTask(rows, range, ctx);
    },

    /** Stored rows as they are (the running row at its last checkpoint). */
    sessions(filter: SessionFilter = {}): Session[] {
      return sessions.list(filter);
    },

    /** Returns the edited row's day key. */
    updateSession(id: number, subjectId: number | null): string {
      const dayKey = editable(id);
      if (subjectId !== null && !subjects.list().some((s) => s.id === subjectId)) {
        throw new IpcValidationError('No such subject');
      }
      sessions.updateSubject(id, subjectId);
      return dayKey;
    },

    /** Returns the deleted row's day key. */
    deleteSession(id: number): string {
      const dayKey = editable(id);
      sessions.remove(id);
      return dayKey;
    },
  };
}
