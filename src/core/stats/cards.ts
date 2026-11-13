// Stats widget card maths (v1.2 spec §3.12; appplan §4.7, §4.10). Pure: "now" comes in through
// StatsContext. Everything works on study-day keys (the rollover hour decides which day a moment
// belongs to) and on the rows it is given, which are focus-timer time only (appplan §5). Totals
// compare with the same elapsed part of the previous period, so a half-finished week or month
// is never set against a whole one.

import type {
  GoalCardData,
  Session,
  StatRange,
  Subject,
  SubjectBar,
  SubjectsCardData,
  TotalCardData,
} from '../../shared/types';
import { addDays, daysBetween, weekStartOf } from '../time';
import { currentStreak } from './streak';
import {
  MINUTE_MS,
  NO_SUBJECT_COLOUR,
  NO_SUBJECT_KEY,
  NO_SUBJECT_NAME,
  dayTotals,
  msOn,
  todayKey,
} from './totals';
import type { StatsContext } from './totals';

/** The subjects card shows this many bars; the rest are summed into "Other". */
export const TOP_SUBJECT_BARS = 6;
export const OTHER_KEY = 'other';
export const OTHER_NAME = 'Other';

const DAY_MS = 86_400_000;

/** Inclusive day keys: today; Mon–Sun of this week; the 1st to the last of this month. */
export function rangeDays(range: StatRange, ctx: StatsContext): { from: string; to: string } {
  const today = todayKey(ctx);
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') {
    const from = weekStartOf(today);
    return { from, to: addDays(from, 6) };
  }
  const from = `${today.slice(0, 7)}-01`;
  return { from, to: lastOfMonth(from) };
}

/** The last day key of the month that starts at `first` (a `YYYY-MM-01` key). */
function lastOfMonth(first: string): string {
  // 28 days always land inside the month; step to the 1st of the next, then back one.
  let k = addDays(first, 28);
  while (k.slice(0, 7) === first.slice(0, 7)) k = addDays(k, 1);
  return addDays(k, -1);
}

function sumDays(totals: ReturnType<typeof dayTotals>, from: string, to: string): number {
  let ms = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) ms += msOn(totals, k);
  return ms;
}

/** Spec §3.12: the total and the same elapsed part of the previous period. */
export function totalCard(sessions: Session[], range: StatRange, ctx: StatsContext): TotalCardData {
  const today = todayKey(ctx);
  const totals = dayTotals(sessions);
  const todayMs = msOn(totals, today);
  let totalMs: number;
  let previousMs: number;

  if (range === 'today') {
    totalMs = todayMs;
    // Yesterday's rows count only up to this time of day: clip each at "now minus 24 h".
    const cutoff = ctx.now - DAY_MS;
    const yesterday = addDays(today, -1);
    previousMs = 0;
    for (const s of sessions) {
      if (s.dayKey === yesterday) previousMs += Math.min(s.focusMs, Math.max(0, cutoff - s.startedAt));
    }
  } else if (range === 'week') {
    const from = weekStartOf(today);
    totalMs = sumDays(totals, from, today);
    previousMs = sumDays(totals, addDays(from, -7), addDays(today, -7));
  } else {
    const from = `${today.slice(0, 7)}-01`;
    totalMs = sumDays(totals, from, today);
    // Last month's 1st to the same date, clamped to its length (31 March -> 28 February).
    const prevFirst = `${addDays(from, -1).slice(0, 7)}-01`;
    const prevLength = daysBetween(prevFirst, from);
    const elapsed = daysBetween(from, today) + 1;
    previousMs = sumDays(totals, prevFirst, addDays(prevFirst, Math.min(elapsed, prevLength) - 1));
  }

  const deltaPct = previousMs === 0 ? null : Math.round(((totalMs - previousMs) / previousMs) * 100);
  return { card: 'total', range, totalMs, previousMs, deltaPct, todayMs };
}

function inDays(from: string, to: string): (dayKey: string) => boolean {
  return (k) => k >= from && k <= to;
}

export function subjectsCard(
  sessions: Session[],
  subjects: Subject[],
  range: StatRange,
  ctx: StatsContext,
): SubjectsCardData {
  const { from, to } = rangeDays(range, ctx);
  const within = inDays(from, to);
  const known = new Map(subjects.map((s) => [s.id, s]));
  const bars = new Map<string, SubjectBar>();
  for (const s of sessions) {
    if (!within(s.dayKey)) continue;
    const subject = s.subjectId === null ? undefined : known.get(s.subjectId);
    const key = subject ? String(subject.id) : NO_SUBJECT_KEY;
    let bar = bars.get(key);
    if (!bar) {
      bar = subject
        ? { key, name: subject.name, colour: subject.colour, ms: 0 }
        : { key, name: NO_SUBJECT_NAME, colour: NO_SUBJECT_COLOUR, ms: 0 };
      bars.set(key, bar);
    }
    bar.ms += s.focusMs;
  }
  const sorted = [...bars.values()].filter((b) => b.ms > 0).sort((a, b) => b.ms - a.ms);
  const top = sorted.slice(0, TOP_SUBJECT_BARS);
  const rest = sorted.slice(TOP_SUBJECT_BARS);
  if (rest.length > 0) {
    top.push({
      key: OTHER_KEY,
      name: OTHER_NAME,
      colour: NO_SUBJECT_COLOUR,
      ms: rest.reduce((sum, b) => sum + b.ms, 0),
    });
  }
  return { card: 'subjects', range, bars: top };
}

export function goalCard(sessions: Session[], range: StatRange, ctx: StatsContext): GoalCardData {
  const today = todayKey(ctx);
  const totals = dayTotals(sessions);
  const { from, to } = rangeDays(range, ctx);
  const goalMs = ctx.goalMinutes * MINUTE_MS;
  const days: GoalCardData['days'] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    days.push({ dayKey: k, hit: msOn(totals, k) >= goalMs, future: k > today });
  }
  return {
    card: 'goal',
    range,
    goalMs,
    todayMs: msOn(totals, today),
    days,
    hitDays: days.filter((d) => d.hit).length,
    elapsedDays: days.filter((d) => !d.future).length,
    streak: currentStreak(totals, ctx),
  };
}
