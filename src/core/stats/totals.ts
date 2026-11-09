// Day totals, week bars, trend, by-subject and by-task totals (spec §3.5; v1.1 spec §3.3;
// appplan §4.7). Pure: "now" comes in through StatsContext. Every function sums the rows it is
// given; main decides which rows those are. A row is credited wholly to its stored `dayKey`, the
// day its focus segment started on.

import type {
  DayTotal,
  Session,
  Subject,
  SubjectRange,
  SubjectTotal,
  TaskTotal,
  TrendPoint,
  WeekBars,
} from '../../shared/types';
import { addDays, dayKeyOf, weekStartOf } from '../time';

/** Weeks always run Monday to Sunday (spec §3.5 `weekStartsOn: 1`). */
export interface StatsContext {
  now: number;
  rolloverHour: number;
  streakMinutes: number;
  goalMinutes: number;
  /** IANA zone, for tests only; the app uses the system zone. */
  tz?: string;
}

export const MINUTE_MS = 60_000;

/** Key in `DayTotal.bySubject` for rows with no subject; other keys are `String(subjectId)`. */
export const NO_SUBJECT_KEY = 'none';
export const NO_SUBJECT_NAME = 'No subject';
export const NO_SUBJECT_COLOUR = '#8a8f98';

/** The "By task" card lists at most this many tasks (v1.1 spec §3.3). */
export const TOP_TASKS = 10;

export function todayKey(ctx: StatsContext): string {
  return dayKeyOf(ctx.now, ctx.rolloverHour, ctx.tz);
}

export function subjectKey(subjectId: number | null): string {
  return subjectId === null ? NO_SUBJECT_KEY : String(subjectId);
}

export function emptyDay(dayKey: string): DayTotal {
  return { dayKey, ms: 0, bySubject: {} };
}

export function dayTotals(sessions: Session[]): Map<string, DayTotal> {
  const totals = new Map<string, DayTotal>();
  for (const s of sessions) {
    let day = totals.get(s.dayKey);
    if (!day) {
      day = emptyDay(s.dayKey);
      totals.set(s.dayKey, day);
    }
    day.ms += s.focusMs;
    const key = subjectKey(s.subjectId);
    day.bySubject[key] = (day.bySubject[key] ?? 0) + s.focusMs;
  }
  return totals;
}

export function msOn(totals: Map<string, DayTotal>, dayKey: string): number {
  return totals.get(dayKey)?.ms ?? 0;
}

/** Total of the `days` days starting at `from`. */
export function msOver(totals: Map<string, DayTotal>, from: string, days: number): number {
  let ms = 0;
  for (let i = 0; i < days; i++) ms += msOn(totals, addDays(from, i));
  return ms;
}

export function weekBars(totals: Map<string, DayTotal>, weekStart: string): WeekBars {
  const days: DayTotal[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(weekStart, i);
    const day = totals.get(key);
    days.push(day ? { dayKey: key, ms: day.ms, bySubject: { ...day.bySubject } } : emptyDay(key));
  }
  return { weekStart, days };
}

/** Total per week for the last `weeks` weeks, this (partial) week last. */
export function trend(totals: Map<string, DayTotal>, ctx: StatsContext, weeks = 12): TrendPoint[] {
  const thisWeek = weekStartOf(todayKey(ctx));
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(thisWeek, -7 * i);
    points.push({ weekStart, ms: msOver(totals, weekStart, 7) });
  }
  return points;
}

/** Per-subject totals, largest first; zero totals are left out. */
export function subjectTotals(sessions: Session[], subjects: Subject[]): SubjectTotal[] {
  const known = new Map(subjects.map((s) => [s.id, s]));
  const totals = new Map<number | null, SubjectTotal>();
  for (const s of sessions) {
    const subject = s.subjectId === null ? undefined : known.get(s.subjectId);
    const id = subject ? subject.id : null;
    let t = totals.get(id);
    if (!t) {
      t = subject
        ? { subjectId: subject.id, name: subject.name, colour: subject.colour, ms: 0 }
        : { subjectId: null, name: NO_SUBJECT_NAME, colour: NO_SUBJECT_COLOUR, ms: 0 };
      totals.set(id, t);
    }
    t.ms += s.focusMs;
  }
  return [...totals.values()].filter((t) => t.ms > 0).sort((a, b) => b.ms - a.ms);
}

/** `week` is this Monday–Sunday week, `month` this calendar month (both by day key), `all` all. */
export function inRange(range: SubjectRange, ctx: StatsContext): (dayKey: string) => boolean {
  const today = todayKey(ctx);
  if (range === 'week') {
    const from = weekStartOf(today);
    const to = addDays(from, 6);
    return (k) => k >= from && k <= to;
  }
  if (range === 'month') {
    const month = today.slice(0, 7);
    return (k) => k.startsWith(month);
  }
  return () => true;
}

export function bySubject(
  sessions: Session[],
  subjects: Subject[],
  range: SubjectRange,
  ctx: StatsContext,
): SubjectTotal[] {
  const within = inRange(range, ctx);
  return subjectTotals(
    sessions.filter((s) => within(s.dayKey)),
    subjects,
  );
}

/**
 * Per-task totals for `range`, largest first, top `TOP_TASKS` (v1.1 spec §3.3). Grouped by task id
 * and labelled with the newest row's text snapshot, so a task edited or cleared since still shows
 * by the name it was last studied under. Rows without a task and zero totals are left out.
 */
export function byTask(sessions: Session[], range: SubjectRange, ctx: StatsContext): TaskTotal[] {
  const within = inRange(range, ctx);
  const totals = new Map<number, { total: TaskTotal; newest: number }>();
  for (const s of sessions) {
    if (s.taskId === null || !within(s.dayKey)) continue;
    let t = totals.get(s.taskId);
    if (!t) {
      t = { total: { taskId: s.taskId, text: '', ms: 0 }, newest: Number.NEGATIVE_INFINITY };
      totals.set(s.taskId, t);
    }
    t.total.ms += s.focusMs;
    if (s.taskText !== null && s.startedAt >= t.newest) {
      t.total.text = s.taskText;
      t.newest = s.startedAt;
    }
  }
  return [...totals.values()]
    .map((t) => t.total)
    .filter((t) => t.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, TOP_TASKS);
}
