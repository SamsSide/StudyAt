import { describe, expect, it } from 'vitest';
import type { DayTotal, Session, Subject } from '../../shared/types';
import { addDays, dayKeyOf } from '../time';
import { SHADE_MINUTES, heatmap } from './heatmap';
import { overview } from './overview';
import { finishedWeeksSince, recapFor } from './recap';
import { currentStreak, longestStreak } from './streak';
import {
  NO_SUBJECT_COLOUR,
  NO_SUBJECT_KEY,
  NO_SUBJECT_NAME,
  bySubject,
  dayTotals,
  trend,
  weekBars,
} from './totals';
import type { StatsContext } from './totals';

const TZ = 'Europe/London';
const MIN = 60_000;

// Sunday 2026-11-08, 12:00 GMT: today is 2026-11-08, this week starts Monday 2026-11-02.
const ctx: StatsContext = {
  now: Date.UTC(2026, 10, 8, 12),
  rolloverHour: 4,
  streakMinutes: 25,
  goalMinutes: 180,
  tz: TZ,
};

const subjects: Subject[] = [
  { id: 1, name: 'Networks', colour: '#5ccfb0', archived: false, sort: 0 },
  { id: 2, name: 'AI', colour: '#e57aa8', archived: false, sort: 1 },
  { id: 3, name: 'Data Science', colour: '#9ad06b', archived: true, sort: 2 },
  { id: 4, name: 'Software Engineering', colour: '#b48cf2', archived: false, sort: 3 },
];

let nextId = 1;
function sessionAt(
  startedAt: number,
  focusMs: number,
  subjectId: number | null = null,
  pomodoroId?: string,
): Session {
  const id = nextId++;
  return {
    id,
    pomodoroId: pomodoroId ?? `p${id}`,
    subjectId,
    startedAt,
    endedAt: startedAt + focusMs,
    checkpointAt: startedAt + focusMs,
    focusMs,
    discardedMs: 0,
    dayKey: dayKeyOf(startedAt, 4, TZ),
    status: 'done',
    taskId: null,
    taskText: null,
  };
}

/** A session at 10:00 UTC on `dayKey` (10:00 or 11:00 London, same date). */
function on(dayKey: string, minutes: number, subjectId: number | null = null, pomodoroId?: string): Session {
  return sessionAt(Date.parse(`${dayKey}T10:00:00Z`), minutes * MIN, subjectId, pomodoroId);
}

function totalsOf(days: Record<string, number>): Map<string, DayTotal> {
  return dayTotals(Object.entries(days).map(([k, m]) => on(k, m)));
}

describe('dayTotals', () => {
  it('sums focus by day key and by subject', () => {
    const t = dayTotals([
      on('2026-11-08', 30, 1),
      on('2026-11-08', 20, 1),
      on('2026-11-08', 10),
      on('2026-11-07', 5, 2),
    ]);
    expect(t.get('2026-11-08')).toEqual({
      dayKey: '2026-11-08',
      ms: 60 * MIN,
      bySubject: { '1': 50 * MIN, [NO_SUBJECT_KEY]: 10 * MIN },
    });
    expect(t.get('2026-11-07')?.ms).toBe(5 * MIN);
  });

  it('a session crossing midnight is credited wholly to its start day', () => {
    // 23:50 on the 7th, 25 min: runs past midnight but belongs to the 7th.
    const t = dayTotals([sessionAt(Date.UTC(2026, 10, 7, 23, 50), 25 * MIN)]);
    expect([...t.keys()]).toEqual(['2026-11-07']);
    expect(t.get('2026-11-07')?.ms).toBe(25 * MIN);
  });

  it('dst spring-forward session credited to previous day', () => {
    // 2026-03-29 01:30 (02:30 BST after the jump) to 03:30 BST: one row, credited once to the 28th.
    const s = sessionAt(Date.UTC(2026, 2, 29, 0, 30), 25 * MIN);
    expect(s.dayKey).toBe('2026-03-28');
    const t = dayTotals([s]);
    expect([...t.keys()]).toEqual(['2026-03-28']);
    expect(t.get('2026-03-28')?.ms).toBe(25 * MIN);
  });

  it('dst fall-back hour not double counted', () => {
    // 2026-10-25 01:30 happens twice (BST, then GMT): two real sessions, each counted once.
    const first = sessionAt(Date.UTC(2026, 9, 25, 0, 30), 25 * MIN);
    const second = sessionAt(Date.UTC(2026, 9, 25, 1, 30), 20 * MIN);
    const t = dayTotals([first, second]);
    expect([...t.keys()]).toEqual(['2026-10-24']);
    expect(t.get('2026-10-24')?.ms).toBe(45 * MIN);
  });
});

describe('streaks', () => {
  it('streak counts 25:00 but not 24:59', () => {
    const counted = dayTotals([on('2026-11-08', 25), on('2026-11-07', 25)]);
    expect(currentStreak(counted, ctx)).toBe(2);
    const short = dayTotals([
      on('2026-11-08', 25),
      sessionAt(Date.parse('2026-11-07T10:00:00Z'), 25 * MIN - 1000),
    ]);
    expect(currentStreak(short, ctx)).toBe(1);
  });

  it("today below threshold doesn't break streak", () => {
    expect(currentStreak(totalsOf({ '2026-11-08': 10, '2026-11-07': 30, '2026-11-06': 30 }), ctx)).toBe(2);
    expect(currentStreak(totalsOf({ '2026-11-07': 30, '2026-11-06': 30 }), ctx)).toBe(2);
    expect(currentStreak(totalsOf({ '2026-11-08': 30, '2026-11-07': 30, '2026-11-06': 30 }), ctx)).toBe(3);
  });

  it('gap of one day resets current streak', () => {
    expect(currentStreak(totalsOf({ '2026-11-08': 30, '2026-11-06': 30, '2026-11-05': 30 }), ctx)).toBe(1);
    expect(currentStreak(totalsOf({ '2026-11-06': 30, '2026-11-05': 30 }), ctx)).toBe(0);
    expect(currentStreak(new Map(), ctx)).toBe(0);
  });

  it('streak uses the 04:00 rollover for today', () => {
    // 03:00 on the 9th is still the 8th.
    const early = { ...ctx, now: Date.UTC(2026, 10, 9, 3) };
    expect(currentStreak(totalsOf({ '2026-11-08': 30, '2026-11-07': 30 }), early)).toBe(2);
  });

  it('streak threshold follows streakMinutes', () => {
    const t = totalsOf({ '2026-11-08': 40, '2026-11-07': 40 });
    expect(currentStreak(t, { ...ctx, streakMinutes: 45 })).toBe(0);
    expect(currentStreak(t, { ...ctx, streakMinutes: 40 })).toBe(2);
  });

  it('longest streak over history', () => {
    const t = totalsOf({
      '2026-01-30': 30,
      '2026-01-31': 30,
      '2026-02-01': 30,
      '2026-02-02': 30, // four across a month edge
      '2026-02-03': 24, // below threshold
      '2026-02-04': 30,
      '2026-11-07': 30,
      '2026-11-08': 30,
    });
    expect(longestStreak(t, ctx)).toBe(4);
    expect(longestStreak(new Map(), ctx)).toBe(0);
  });
});

describe('heatmap', () => {
  it("heatmap has 371 cells ending on this week's Sunday and shades by SHADE_MINUTES", () => {
    expect(SHADE_MINUTES).toEqual([0, 30, 60, 120]);
    const t = totalsOf({
      '2026-11-02': 29,
      '2026-11-03': 30,
      '2026-11-04': 59,
      '2026-11-05': 60,
      '2026-11-06': 119,
      '2026-11-07': 120,
      '2026-11-08': 1,
    });
    // A Wednesday: the map still runs to the coming Sunday.
    const cells = heatmap(t, { ...ctx, now: Date.UTC(2026, 10, 4, 12) });
    expect(cells).toHaveLength(371);
    expect(cells[0]?.dayKey).toBe('2025-11-03'); // a Monday, 52 weeks before this week
    expect(cells[370]?.dayKey).toBe('2026-11-08');
    const byKey = new Map(cells.map((c) => [c.dayKey, c]));
    expect(byKey.get('2026-11-01')?.shade).toBe(0);
    expect(byKey.get('2026-11-01')?.ms).toBe(0);
    expect(['02', '03', '04', '05', '06', '07'].map((d) => byKey.get(`2026-11-${d}`)?.shade)).toEqual([
      1, 2, 2, 3, 3, 4,
    ]);
    expect(byKey.get('2026-11-08')?.shade).toBe(1);
  });

  it('goalHit at 180 min not 179', () => {
    const t = totalsOf({ '2026-11-07': 180, '2026-11-06': 179 });
    const byKey = new Map(heatmap(t, ctx).map((c) => [c.dayKey, c]));
    expect(byKey.get('2026-11-07')?.goalHit).toBe(true);
    expect(byKey.get('2026-11-06')?.goalHit).toBe(false);
  });

  it('streakDay marks days that reach the streak threshold', () => {
    const t = totalsOf({ '2026-11-07': 25, '2026-11-06': 24 });
    const byKey = new Map(heatmap(t, ctx).map((c) => [c.dayKey, c]));
    expect(byKey.get('2026-11-07')?.streakDay).toBe(true);
    expect(byKey.get('2026-11-06')?.streakDay).toBe(false);
  });
});

describe('weekBars and trend', () => {
  it('weekBars stacks bySubject', () => {
    const t = dayTotals([
      on('2026-11-02', 30, 1),
      on('2026-11-02', 15, 2),
      on('2026-11-04', 20),
      on('2026-11-09', 50, 1),
    ]);
    const bars = weekBars(t, '2026-11-02');
    expect(bars.weekStart).toBe('2026-11-02');
    expect(bars.days.map((d) => d.dayKey)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(bars.days[0]).toEqual({
      dayKey: '2026-11-02',
      ms: 45 * MIN,
      bySubject: { '1': 30 * MIN, '2': 15 * MIN },
    });
    expect(bars.days[1]).toEqual({ dayKey: '2026-11-03', ms: 0, bySubject: {} });
    expect(bars.days[2]?.bySubject).toEqual({ [NO_SUBJECT_KEY]: 20 * MIN });
  });

  it('trend returns 12 weeks oldest first', () => {
    const t = totalsOf({
      '2026-11-08': 30,
      '2026-11-02': 10,
      '2026-10-26': 60,
      '2026-08-17': 5,
      '2026-08-16': 99,
    });
    const points = trend(t, ctx);
    expect(points).toHaveLength(12);
    expect(points[0]).toEqual({ weekStart: '2026-08-17', ms: 5 * MIN });
    expect(points[10]).toEqual({ weekStart: '2026-10-26', ms: 60 * MIN });
    expect(points[11]).toEqual({ weekStart: '2026-11-02', ms: 40 * MIN });
    expect(trend(t, ctx, 4).map((p) => p.weekStart)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });
});

describe('bySubject', () => {
  const sessions = [
    on('2026-11-08', 30, 1),
    on('2026-11-03', 20, 2),
    on('2026-11-03', 10),
    on('2026-11-01', 40, 3), // last week, this month
    on('2026-10-30', 50, 2), // last month
  ];

  it('totals the current week, sorted desc, untagged as "No subject"', () => {
    expect(bySubject(sessions, subjects, 'week', ctx)).toEqual([
      { subjectId: 1, name: 'Networks', colour: '#5ccfb0', ms: 30 * MIN },
      { subjectId: 2, name: 'AI', colour: '#e57aa8', ms: 20 * MIN },
      { subjectId: null, name: 'No subject', colour: '#8a8f98', ms: 10 * MIN },
    ]);
    expect([NO_SUBJECT_NAME, NO_SUBJECT_COLOUR]).toEqual(['No subject', '#8a8f98']);
  });

  it('month is the calendar month of today, all is everything; archived subjects keep their name', () => {
    expect(bySubject(sessions, subjects, 'month', ctx).map((s) => [s.subjectId, s.ms])).toEqual([
      [3, 40 * MIN],
      [1, 30 * MIN],
      [2, 20 * MIN],
      [null, 10 * MIN],
    ]);
    expect(bySubject(sessions, subjects, 'all', ctx).map((s) => [s.name, s.ms])).toEqual([
      ['AI', 70 * MIN],
      ['Data Science', 40 * MIN],
      ['Networks', 30 * MIN],
      ['No subject', 10 * MIN],
    ]);
  });

  it('a session whose subject no longer exists counts as "No subject"', () => {
    expect(bySubject([on('2026-11-08', 30, 99)], subjects, 'all', ctx)).toEqual([
      { subjectId: null, name: 'No subject', colour: '#8a8f98', ms: 30 * MIN },
    ]);
  });
});

describe('overview', () => {
  it('reports today, week, last week, streaks, all time and goal', () => {
    const o = overview(
      [
        on('2026-11-08', 90),
        on('2026-11-07', 30),
        on('2026-11-03', 30),
        on('2026-10-28', 100),
        on('2025-01-01', 20),
      ],
      ctx,
    );
    expect(o).toEqual({
      todayMs: 90 * MIN,
      weekMs: 150 * MIN,
      lastWeekMs: 100 * MIN,
      weekDeltaPct: 50,
      currentStreak: 2,
      longestStreak: 2,
      allTimeMs: 270 * MIN,
      goalMs: 180 * MIN,
      goalProgress: 0.5,
    });
  });

  it('weekDeltaPct null when last week is 0', () => {
    expect(overview([on('2026-11-08', 30)], ctx).weekDeltaPct).toBeNull();
    expect(overview([on('2026-10-28', 30)], ctx).weekDeltaPct).toBe(-100);
  });

  it('goalProgress is capped at 1', () => {
    expect(overview([on('2026-11-08', 240)], ctx).goalProgress).toBe(1);
    expect(overview([], ctx).goalProgress).toBe(0);
  });
});

describe('recap', () => {
  it('recap of empty week has zeros and bestDay null', () => {
    expect(recapFor('2026-10-26', [on('2026-11-03', 30)], subjects, ctx)).toEqual({
      weekStart: '2026-10-26',
      totalMs: 0,
      prevTotalMs: 0,
      daysStudied: 0,
      bestDay: null,
      topSubjects: [],
      longestSessionMs: 0,
      streakAtEnd: 0,
      goalDaysHit: 0,
    });
  });

  it('recap topSubjects max 3 sorted desc', () => {
    const sessions = [
      on('2026-10-26', 10, 1),
      on('2026-10-27', 40, 2),
      on('2026-10-28', 30, 4),
      on('2026-10-29', 20),
      on('2026-10-30', 5, 3),
      on('2026-11-02', 500, 3), // next week, ignored
    ];
    const r = recapFor('2026-10-26', sessions, subjects, ctx);
    expect(r.topSubjects).toEqual([
      { subjectId: 2, name: 'AI', ms: 40 * MIN },
      { subjectId: 4, name: 'Software Engineering', ms: 30 * MIN },
      { subjectId: null, name: 'No subject', ms: 20 * MIN },
    ]);
  });

  it('recap totals, best day, longest session, goal days and streak at the end of the week', () => {
    const sessions = [
      on('2026-10-20', 15), // previous week
      on('2026-10-24', 30), // previous week (Sat)
      on('2026-10-25', 30), // previous week (Sun)
      on('2026-10-26', 25, 1, 'a'),
      on('2026-10-26', 20, 2, 'a'), // same pomodoro, subject changed: one 45-min session
      on('2026-10-27', 100),
      on('2026-10-27', 100),
      on('2026-11-01', 30),
    ];
    const r = recapFor('2026-10-26', sessions, subjects, ctx);
    expect(r.weekStart).toBe('2026-10-26');
    expect(r.totalMs).toBe(275 * MIN);
    expect(r.prevTotalMs).toBe(75 * MIN);
    expect(r.daysStudied).toBe(3);
    expect(r.bestDay).toEqual({ dayKey: '2026-10-27', ms: 200 * MIN });
    expect(r.longestSessionMs).toBe(100 * MIN);
    expect(r.goalDaysHit).toBe(1);
    expect(r.streakAtEnd).toBe(1); // only Sunday 1 Nov; Wed–Sat empty

    const longest = recapFor(
      '2026-10-26',
      [on('2026-10-26', 25, 1, 'a'), on('2026-10-26', 24, 2, 'a')],
      subjects,
      ctx,
    );
    expect(longest.longestSessionMs).toBe(49 * MIN);
  });

  it('streakAtEnd counts back from Sunday and is 0 if Sunday missed the threshold', () => {
    const run = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d) => on(d, 25));
    expect(recapFor('2026-10-26', run, subjects, ctx).streakAtEnd).toBe(4);
    expect(
      recapFor('2026-10-26', [...run.slice(0, 3), on('2026-11-01', 24)], subjects, ctx).streakAtEnd,
    ).toBe(0);
  });

  it('finishedWeeksSince excludes the current week', () => {
    // Since the last stored recap: the weeks after it, up to last week.
    expect(finishedWeeksSince('2026-10-12', '2026-01-05', ctx)).toEqual(['2026-10-19', '2026-10-26']);
    // No recap yet: from the first session's week.
    expect(finishedWeeksSince(null, '2026-10-21', ctx)).toEqual(['2026-10-19', '2026-10-26']);
    // First session this week, or none at all: nothing finished yet.
    expect(finishedWeeksSince(null, '2026-11-03', ctx)).toEqual([]);
    expect(finishedWeeksSince(null, null, ctx)).toEqual([]);
    // Last recap is last week: up to date.
    expect(finishedWeeksSince('2026-10-26', '2026-01-05', ctx)).toEqual([]);
    // Monday 03:59 is still Sunday, so last week isn't finished yet.
    expect(finishedWeeksSince(null, '2026-11-03', { ...ctx, now: Date.UTC(2026, 10, 9, 3, 59) })).toEqual([]);
    expect(finishedWeeksSince(null, '2026-11-03', { ...ctx, now: Date.UTC(2026, 10, 9, 4, 0) })).toEqual([
      '2026-11-02',
    ]);
    expect(addDays('2026-11-02', 7)).toBe('2026-11-09');
  });
});
