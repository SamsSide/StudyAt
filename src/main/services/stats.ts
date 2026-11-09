// Stats served to the renderer (spec §3.5; appplan §4.7): the pure Task 3 functions run over the
// full session history, read from settings each call. The running row is included with its live
// accrual for today: the database copy lags by up to one 15 s checkpoint, so today's total is
// topped up to the controller's `todayFocusMs`, the same figure the timer widget and top bar show.
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
  HeatmapCell,
  Session,
  StatsOverview,
  SubjectRange,
  SubjectTotal,
  TaskTotal,
  TrendPoint,
  WeekBars,
} from '../../shared/types';
import type { Db } from '../db/db';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { subjectsRepo } from '../db/repos/subjects';
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
