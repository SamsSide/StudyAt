// Study calendar heatmap (spec §3.5; appplan §4.7): 53 Monday-first weeks ending this week.

import type { DayTotal, HeatmapCell } from '../../shared/types';
import { addDays, weekStartOf } from '../time';
import { isStreakDay } from './streak';
import { MINUTE_MS, msOn, todayKey } from './totals';
import type { StatsContext } from './totals';

/** Shade boundaries in minutes, the one place they live: 0 · <30 min · <1 h · <2 h · ≥2 h. */
export const SHADE_MINUTES = [0, 30, 60, 120] as const;

export const HEATMAP_WEEKS = 53;

export function shadeFor(ms: number): HeatmapCell['shade'] {
  if (ms <= 0) return 0;
  const minutes = ms / MINUTE_MS;
  if (minutes < SHADE_MINUTES[1]) return 1;
  if (minutes < SHADE_MINUTES[2]) return 2;
  if (minutes < SHADE_MINUTES[3]) return 3;
  return 4;
}

/** `streakDay` marks a day that reached the streak threshold; `goalHit` one that reached the goal. */
export function heatmap(totals: Map<string, DayTotal>, ctx: StatsContext): HeatmapCell[] {
  const first = addDays(weekStartOf(todayKey(ctx)), -7 * (HEATMAP_WEEKS - 1));
  const cells: HeatmapCell[] = [];
  for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
    const dayKey = addDays(first, i);
    const ms = msOn(totals, dayKey);
    cells.push({
      dayKey,
      ms,
      shade: shadeFor(ms),
      goalHit: ms >= ctx.goalMinutes * MINUTE_MS,
      streakDay: isStreakDay(ms, ctx.streakMinutes),
    });
  }
  return cells;
}
