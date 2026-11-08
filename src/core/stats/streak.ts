// Streaks (spec §3.5; appplan §4.7): a streak day has at least `streakMinutes` of focus.

import type { DayTotal } from '../../shared/types';
import { addDays, daysBetween } from '../time';
import { MINUTE_MS, msOn, todayKey } from './totals';
import type { StatsContext } from './totals';

export function isStreakDay(ms: number, streakMinutes: number): boolean {
  return ms >= streakMinutes * MINUTE_MS;
}

/** Consecutive streak days ending on `dayKey` (0 if `dayKey` itself isn't one). */
export function streakEndingOn(totals: Map<string, DayTotal>, dayKey: string, streakMinutes: number): number {
  let n = 0;
  for (let k = dayKey; isStreakDay(msOn(totals, k), streakMinutes); k = addDays(k, -1)) n++;
  return n;
}

/** Ends today; if today hasn't reached the threshold yet it counts from yesterday, since today
 * doesn't break the streak until it ends. */
export function currentStreak(totals: Map<string, DayTotal>, ctx: StatsContext): number {
  const today = todayKey(ctx);
  const from = isStreakDay(msOn(totals, today), ctx.streakMinutes) ? today : addDays(today, -1);
  return streakEndingOn(totals, from, ctx.streakMinutes);
}

export function longestStreak(totals: Map<string, DayTotal>, ctx: StatsContext): number {
  const days = [...totals.values()]
    .filter((d) => isStreakDay(d.ms, ctx.streakMinutes))
    .map((d) => d.dayKey)
    .sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of days) {
    run = prev !== null && daysBetween(prev, k) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return longest;
}
