// Header tiles and today's goal ring (spec §3.5; appplan §4.7).

import type { Session, StatsOverview } from '../../shared/types';
import { addDays, weekStartOf } from '../time';
import { currentStreak, longestStreak } from './streak';
import { MINUTE_MS, dayTotals, msOn, msOver, todayKey } from './totals';
import type { StatsContext } from './totals';

export function overview(sessions: Session[], ctx: StatsContext): StatsOverview {
  const totals = dayTotals(sessions);
  const today = todayKey(ctx);
  const thisWeek = weekStartOf(today);
  const todayMs = msOn(totals, today);
  const weekMs = msOver(totals, thisWeek, 7);
  const lastWeekMs = msOver(totals, addDays(thisWeek, -7), 7);
  const goalMs = ctx.goalMinutes * MINUTE_MS;
  let allTimeMs = 0;
  for (const d of totals.values()) allTimeMs += d.ms;
  return {
    todayMs,
    weekMs,
    lastWeekMs,
    // Whole percent; null when last week was 0 (the tile shows "—").
    weekDeltaPct: lastWeekMs === 0 ? null : Math.round(((weekMs - lastWeekMs) / lastWeekMs) * 100),
    currentStreak: currentStreak(totals, ctx),
    longestStreak: longestStreak(totals, ctx),
    allTimeMs,
    goalMs,
    goalProgress: goalMs > 0 ? Math.min(1, todayMs / goalMs) : 0,
  };
}
