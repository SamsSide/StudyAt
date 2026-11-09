// Weekly recaps (spec §3.5; appplan §4.8): one per fully finished Monday–Sunday week.

import type { Session, Subject, WeeklyRecap } from '../../shared/types';
import { addDays, weekStartOf } from '../time';
import { streakEndingOn } from './streak';
import { MINUTE_MS, dayTotals, msOn, msOver, subjectTotals, todayKey } from './totals';
import type { StatsContext } from './totals';

const TOP_SUBJECTS = 3;

export function recapFor(
  weekStart: string,
  sessions: Session[],
  subjects: Subject[],
  ctx: StatsContext,
): WeeklyRecap {
  const weekEnd = addDays(weekStart, 6);
  const totals = dayTotals(sessions);
  const inWeek = sessions.filter((s) => s.dayKey >= weekStart && s.dayKey <= weekEnd);

  let daysStudied = 0;
  let goalDaysHit = 0;
  let bestDay: WeeklyRecap['bestDay'] = null;
  for (let i = 0; i < 7; i++) {
    const dayKey = addDays(weekStart, i);
    const ms = msOn(totals, dayKey);
    if (ms > 0) daysStudied++;
    if (ms >= ctx.goalMinutes * MINUTE_MS) goalDaysHit++;
    // Ties go to the earlier day.
    if (ms > 0 && (!bestDay || ms > bestDay.ms)) bestDay = { dayKey, ms };
  }

  // A session is one Pomodoro: rows split by a subject change mid-segment count together.
  const byPomodoro = new Map<string, number>();
  for (const s of inWeek) byPomodoro.set(s.pomodoroId, (byPomodoro.get(s.pomodoroId) ?? 0) + s.focusMs);

  return {
    weekStart,
    totalMs: msOver(totals, weekStart, 7),
    prevTotalMs: msOver(totals, addDays(weekStart, -7), 7),
    daysStudied,
    bestDay,
    topSubjects: subjectTotals(inWeek, subjects)
      .slice(0, TOP_SUBJECTS)
      .map(({ subjectId, name, ms }) => ({ subjectId, name, ms })),
    longestSessionMs: Math.max(0, ...byPomodoro.values()),
    // The week is over, so a Sunday below the threshold has broken the streak.
    streakAtEnd: streakEndingOn(totals, weekEnd, ctx.streakMinutes),
    goalDaysHit,
  };
}

/**
 * Mondays of the fully finished weeks still needing a recap: those after `lastWeekStart` (the
 * newest stored recap), or from the first session's week if none is stored, up to last week.
 */
export function finishedWeeksSince(
  lastWeekStart: string | null,
  firstSessionDayKey: string | null,
  ctx: StatsContext,
): string[] {
  const thisWeek = weekStartOf(todayKey(ctx));
  let week: string;
  if (lastWeekStart !== null) week = addDays(weekStartOf(lastWeekStart), 7);
  else if (firstSessionDayKey !== null) week = weekStartOf(firstSessionDayKey);
  else return [];
  const weeks: string[] = [];
  for (; week < thisWeek; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}
