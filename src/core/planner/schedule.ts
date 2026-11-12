import { addDays, daysBetween } from '../time';
import type { Deadline, RepeatRule } from '../../shared/types';

/** Mon-Fri; 1970-01-01 was a Thursday. */
function isWeekday(dayKey: string): boolean {
  const dow = (((daysBetween('1970-01-01', dayKey) + 4) % 7) + 7) % 7; // 0 = Sunday
  return dow >= 1 && dow <= 5;
}

/** Spec §3.6: the next matching day after `taskDay`; if that is before `today`, the first matching day >= today. All on day keys (spec §7). */
export function nextRepeatDay(rule: RepeatRule, taskDay: string, today: string): string {
  if (rule.kind === 'weekdays') {
    let day = addDays(taskDay, 1);
    if (day < today) day = today;
    while (!isWeekday(day)) day = addDays(day, 1);
    return day;
  }
  const step = rule.kind === 'daily' ? 1 : rule.kind === 'weekly' ? 7 : Number.isFinite(rule.days) ? Math.max(1, Math.floor(rule.days)) : 1;
  const next = addDays(taskDay, step);
  if (next >= today) return next;
  // Matches are taskDay + k*step; take the first k that lands on or after today.
  return addDays(taskDay, Math.ceil(daysBetween(taskDay, today) / step) * step);
}

/** Spec §3.6 rollover: each open task on a day before `today` moves to today, rolledFrom = its first original day. */
export function rollForwardMoves(
  tasks: readonly { id: number; day: string | null; done: boolean; rolledFrom: string | null }[],
  today: string,
): { id: number; day: string; rolledFrom: string }[] {
  const moves: { id: number; day: string; rolledFrom: string }[] = [];
  for (const t of tasks) {
    if (t.done || t.day === null || t.day >= today) continue;
    moves.push({ id: t.id, day: today, rolledFrom: t.rolledFrom ?? t.day });
  }
  return moves;
}

/** Spec §3.9: tickDay + n for each n, with the exam cap; sorted, unique. */
export function revisionSchedule(tickDay: string, days: readonly number[], examDay: string | null): string[] {
  const set = new Set<string>();
  let dropped = false;
  for (const n of days) {
    const day = addDays(tickDay, n);
    if (examDay === null || day <= examDay) set.add(day);
    else dropped = true;
  }
  // Only a dropped review earns the day-before-the-exam stand-in (spec §3.9).
  if (examDay !== null && dropped) {
    const before = addDays(examDay, -1);
    if (before > tickDay) set.add(before);
  }
  return [...set].sort();
}

/** The soonest open exam for `subjectId` due after `nowWall` (`YYYY-MM-DDTHH:MM`, string compare); null if none. */
export function upcomingExam(deadlines: readonly Deadline[], subjectId: number | null, nowWall: string): Deadline | null {
  if (subjectId === null) return null;
  let best: Deadline | null = null;
  for (const d of deadlines) {
    if (d.kind !== 'exam' || d.done || d.subjectId !== subjectId || d.due <= nowWall) continue;
    if (best === null || d.due < best.due) best = d;
  }
  return best;
}

/** "Exam in 23 days" / "Exam in 1 day" / "Exam today" for an exam on `examDay` seen from `today`; '' once the exam day is past. */
export function examLine(examDay: string, today: string): string {
  const n = daysBetween(today, examDay);
  if (n < 0) return '';
  if (n === 0) return 'Exam today';
  return `Exam in ${n} day${n === 1 ? '' : 's'}`;
}
