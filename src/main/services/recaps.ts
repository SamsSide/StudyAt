// Weekly recaps (spec §3.5 pending flow; appplan §4.8). Every fully finished Monday–Sunday week
// since the newest stored recap (or since the first session's week) is computed and stored, empty
// weeks included. The most recent finished week's recap is pending until the renderer marks it
// shown, so a recap is offered until Sam has actually seen it, then never again.
import { finishedWeeksSince, recapFor } from '../../core/stats/recap';
import { todayKey } from '../../core/stats/totals';
import { addDays, weekStartOf } from '../../core/time';
import type { WeeklyRecap } from '../../shared/types';
import type { Db } from '../db/db';
import { recapsRepo } from '../db/repos/recaps';
import { subjectsRepo } from '../db/repos/subjects';
import type { StatsService } from './stats';

export interface RecapsServiceDeps {
  db: Db;
  stats: Pick<StatsService, 'contextAt' | 'historyAt'>;
}

export type RecapsService = ReturnType<typeof recapsService>;

export function recapsService(deps: RecapsServiceDeps) {
  const repo = recapsRepo(deps.db);
  const subjects = subjectsRepo(deps.db);

  return {
    /** Stores every finished week not yet recapped; returns last week's recap if not yet shown. */
    computePending(now: number): WeeklyRecap | null {
      const ctx = deps.stats.contextAt(now);
      // Full history: a recap compares with the week before and counts the streak into it.
      const sessions = deps.stats.historyAt(ctx);
      let first: string | null = null;
      for (const s of sessions) if (first === null || s.dayKey < first) first = s.dayKey;
      const weeks = finishedWeeksSince(repo.list().at(-1)?.weekStart ?? null, first, ctx);
      if (weeks.length > 0) {
        const all = subjects.list();
        for (const week of weeks) repo.upsert(recapFor(week, sessions, all, ctx));
      }
      const last = repo.get(addDays(weekStartOf(todayKey(ctx)), -7));
      return last && last.shownAt === null ? last.recap : null;
    },

    /**
     * R25: after a session's subject changes or it is deleted, the stored recap of its week (if
     * there is one) is recomputed so it never goes stale; `shown_at` is kept. Never creates a recap.
     */
    refreshWeekOf(dayKey: string, now: number): void {
      const weekStart = weekStartOf(dayKey);
      if (!repo.get(weekStart)) return;
      const ctx = deps.stats.contextAt(now);
      repo.upsert(recapFor(weekStart, deps.stats.historyAt(ctx), subjects.list(), ctx));
    },

    /** Oldest week first. */
    list: (): WeeklyRecap[] => repo.list(),

    markShown(weekStart: string, now: number): void {
      repo.markShown(weekStart, now);
    },
  };
}
