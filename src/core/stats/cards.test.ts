import { describe, expect, it } from 'vitest';
import type { Session, Subject } from '../../shared/types';
import { estimatesCard, goalCard, rangeDays, subjectsCard, totalCard } from './cards';
import { NO_SUBJECT_COLOUR } from './totals';
import type { StatsContext } from './totals';

const MIN = 60_000;

// Wednesday 2026-11-11, 15:00 local.
const ctx: StatsContext = {
  now: new Date(2026, 10, 11, 15).getTime(),
  rolloverHour: 4,
  streakMinutes: 25,
  goalMinutes: 180,
};

const subjects: Subject[] = [
  { id: 1, name: 'Networks', colour: '#5ccfb0', archived: false, sort: 0 },
  { id: 2, name: 'AI', colour: '#e57aa8', archived: false, sort: 1 },
  { id: 3, name: 'Data Science', colour: '#9ad06b', archived: false, sort: 2 },
  { id: 4, name: 'COMP2261 Software Engineering', colour: '#b48cf2', archived: false, sort: 3 },
  { id: 5, name: 'Maths', colour: '#f2c14e', archived: false, sort: 4 },
  { id: 6, name: 'Other things', colour: '#6aa9f2', archived: false, sort: 5 },
];

/** Local time in 2026. */
const at = (month: number, day: number, hour: number, minute = 0): number =>
  new Date(2026, month - 1, day, hour, minute).getTime();

let nextId = 1;
function row(dayKey: string, startedAt: number, focusMin: number, subjectId: number | null): Session {
  return {
    id: nextId++,
    pomodoroId: `p${nextId}`,
    subjectId,
    startedAt,
    endedAt: startedAt + focusMin * MIN,
    checkpointAt: startedAt + focusMin * MIN,
    focusMs: focusMin * MIN,
    discardedMs: 0,
    dayKey,
    status: 'done',
    taskId: null,
    taskText: null,
    intention: null,
    outcome: null,
  };
}

describe('rangeDays', () => {
  it('today, Mon-Sun and the whole month', () => {
    expect(rangeDays('today', ctx)).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(rangeDays('week', ctx)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(rangeDays('month', ctx)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('uses the rollover hour: 02:00 Monday still belongs to Sunday', () => {
    const early = { ...ctx, now: new Date(2026, 10, 9, 2).getTime() };
    expect(rangeDays('today', early).from).toBe('2026-11-08');
    expect(rangeDays('week', early)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });
});

describe('totalCard', () => {
  it('today compares with yesterday by this time of day', () => {
    const rows = [
      row('2026-11-11', at(11, 11, 9), 60, 1),
      row('2026-11-10', at(11, 10, 9), 60, 1),
      row('2026-11-10', at(11, 10, 14, 30), 60, 1),
    ];
    expect(totalCard(rows, 'today', ctx)).toEqual({
      card: 'total',
      range: 'today',
      totalMs: 60 * MIN,
      previousMs: 90 * MIN,
      deltaPct: -33,
      todayMs: 60 * MIN,
    });
  });
  it('a row yesterday that started after this time of day adds nothing', () => {
    const rows = [row('2026-11-10', at(11, 10, 16), 60, 1)];
    expect(totalCard(rows, 'today', ctx).previousMs).toBe(0);
  });
  it('week compares Mon to Wed with last Mon to Wed', () => {
    const rows = [row('2026-11-09', 0, 100, 1), row('2026-11-02', 0, 50, 1), row('2026-11-06', 0, 999, 1)];
    expect(totalCard(rows, 'week', ctx)).toMatchObject({
      totalMs: 100 * MIN,
      previousMs: 50 * MIN,
      deltaPct: 100,
    });
  });
  it('on a Monday the week is one day against last Monday', () => {
    const monday = { ...ctx, now: new Date(2026, 10, 9, 15).getTime() };
    const rows = [row('2026-11-09', 0, 40, 1), row('2026-11-02', 0, 20, 1), row('2026-11-03', 0, 500, 1)];
    expect(totalCard(rows, 'week', monday)).toMatchObject({
      totalMs: 40 * MIN,
      previousMs: 20 * MIN,
      deltaPct: 100,
    });
  });
  it('month compares the 1st to today with last month 1st to the same date', () => {
    const rows = [
      row('2026-11-01', 0, 30, 1),
      row('2026-10-01', 0, 10, 1),
      row('2026-10-11', 0, 10, 1),
      row('2026-10-12', 0, 999, 1),
    ];
    expect(totalCard(rows, 'month', ctx)).toMatchObject({
      totalMs: 30 * MIN,
      previousMs: 20 * MIN,
      deltaPct: 50,
    });
  });
  it('on the 1st the month is one day against last month 1st', () => {
    const first = { ...ctx, now: new Date(2026, 10, 1, 15).getTime() };
    const rows = [row('2026-11-01', 0, 30, 1), row('2026-10-01', 0, 60, 1), row('2026-10-02', 0, 60, 1)];
    expect(totalCard(rows, 'month', first)).toMatchObject({
      totalMs: 30 * MIN,
      previousMs: 60 * MIN,
      deltaPct: -50,
    });
  });
  it('month clamps to the previous month length', () => {
    const march31 = { ...ctx, now: new Date(2027, 2, 31, 15).getTime() };
    const rows = [row('2027-03-31', 0, 30, 1), row('2027-02-28', 0, 30, 1)];
    expect(totalCard(rows, 'month', march31)).toMatchObject({
      totalMs: 30 * MIN,
      previousMs: 30 * MIN,
      deltaPct: 0,
    });
  });
  it('month clamp leaves out the days after the previous month ends (28-day February)', () => {
    const march31 = { ...ctx, now: new Date(2027, 2, 31, 15).getTime() };
    const rows = [
      row('2027-03-31', 0, 30, 1),
      row('2027-02-28', 0, 30, 1),
      row('2027-03-01', 0, 500, 1),
      row('2027-03-02', 0, 500, 1),
    ];
    expect(totalCard(rows, 'month', march31).previousMs).toBe(30 * MIN);
  });
  it('month clamp: 31 May against 30-day April stops at 30 April', () => {
    const may31 = { ...ctx, now: new Date(2027, 4, 31, 15).getTime() };
    const rows = [
      row('2027-05-31', 0, 30, 1),
      row('2027-04-30', 0, 40, 1),
      row('2027-05-01', 0, 500, 1),
    ];
    expect(totalCard(rows, 'month', may31).previousMs).toBe(40 * MIN);
  });
  it('today cut-off is a fixed 24 h, so on a 25 h DST day it is an hour later on the wall clock', () => {
    // London 2026-10-25: clocks go back at 02:00, so 15:00 GMT; 24 h earlier is 16:00 BST on the 24th.
    const london = { ...ctx, tz: 'Europe/London', now: Date.UTC(2026, 9, 25, 15) };
    const rows = [row('2026-10-24', Date.UTC(2026, 9, 24, 14), 120, 1)]; // 15:00 BST, two hours
    expect(totalCard(rows, 'today', london).previousMs).toBe(60 * MIN);
  });
  it('null delta when the previous period is empty', () => {
    expect(totalCard([row('2026-11-11', 0, 10, 1)], 'week', ctx).deltaPct).toBeNull();
  });
  it('todayMs is today even for the week range', () => {
    const rows = [row('2026-11-11', 0, 10, 1), row('2026-11-10', 0, 20, 1)];
    expect(totalCard(rows, 'week', ctx)).toMatchObject({ totalMs: 30 * MIN, todayMs: 10 * MIN });
  });
  it('a 01:00 session is credited to the day before and counts as today before rollover', () => {
    const early = { ...ctx, now: new Date(2026, 10, 12, 2).getTime() };
    const rows = [row('2026-11-11', at(11, 12, 1), 30, 1)];
    expect(totalCard(rows, 'today', early).totalMs).toBe(30 * MIN);
  });
});

describe('subjectsCard', () => {
  it('top 6 plus Other', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      name: `S${i + 1}`,
      colour: '#000000',
      archived: false,
      sort: i,
    }));
    const rows = [80, 70, 60, 50, 40, 30, 20, 10].map((min, i) => row('2026-11-10', 0, min, i + 1));
    const bars = subjectsCard(rows, eight, 'week', ctx).bars;
    expect(bars.map((b) => [b.key, b.ms / MIN])).toEqual([
      ['1', 80],
      ['2', 70],
      ['3', 60],
      ['4', 50],
      ['5', 40],
      ['6', 30],
      ['other', 30],
    ]);
    expect(bars[6]).toMatchObject({ name: 'Other', colour: NO_SUBJECT_COLOUR });
  });
  it('no Other bar with six or fewer; no-subject rows use key none; range filters', () => {
    const rows = [row('2026-11-10', 0, 20, null), row('2026-11-10', 0, 30, 1), row('2026-11-02', 0, 99, 2)];
    const bars = subjectsCard(rows, subjects, 'week', ctx).bars;
    expect(bars).toEqual([
      { key: '1', name: 'Networks', colour: '#5ccfb0', ms: 30 * MIN },
      { key: 'none', name: 'No subject', colour: NO_SUBJECT_COLOUR, ms: 20 * MIN },
    ]);
    expect(subjectsCard(rows, subjects, 'today', ctx).bars).toEqual([]);
  });
});

describe('goalCard', () => {
  const rows = [row('2026-11-09', 0, 200, 1), row('2026-11-10', 0, 10, 1), row('2026-11-11', 0, 190, 1)];
  it('week dots, hits and streak', () => {
    const g = goalCard(rows, 'week', ctx);
    expect(g.days.map((d) => [d.dayKey, d.hit, d.future])).toEqual([
      ['2026-11-09', true, false],
      ['2026-11-10', false, false],
      ['2026-11-11', true, false],
      ['2026-11-12', false, true],
      ['2026-11-13', false, true],
      ['2026-11-14', false, true],
      ['2026-11-15', false, true],
    ]);
    expect(g).toMatchObject({ hitDays: 2, elapsedDays: 3, streak: 1, goalMs: 180 * MIN, todayMs: 190 * MIN });
    expect(goalCard(rows, 'today', ctx).days).toEqual([{ dayKey: '2026-11-11', hit: true, future: false }]);
  });
  it('exactly the goal hits; one minute under does not', () => {
    const edge = [row('2026-11-10', 0, 180, 1), row('2026-11-11', 0, 179, 1)];
    expect(
      goalCard(edge, 'week', ctx)
        .days.slice(1, 3)
        .map((d) => d.hit),
    ).toEqual([true, false]);
  });
  it('month has a dot per day of the month', () => {
    const g = goalCard(rows, 'month', ctx);
    expect(g.days).toHaveLength(30);
    expect(g.elapsedDays).toBe(11);
  });
});

describe('estimatesCard', () => {
  it('ratio, overruns and per-subject ratio', () => {
    const tasks = [
      { id: 1, title: 'A', day: '2026-11-10', estimateMin: 60, effectiveSubjectId: 4 },
      { id: 2, title: 'B', day: '2026-11-11', estimateMin: 30, effectiveSubjectId: 4 },
      { id: 3, title: 'C', day: '2026-11-11', estimateMin: 30, effectiveSubjectId: null },
      { id: 4, title: 'D', day: '2026-10-01', estimateMin: 30, effectiveSubjectId: null },
    ];
    const actual = new Map([
      [1, 96 * MIN],
      [2, 48 * MIN],
      [3, 15 * MIN],
      [4, 99 * MIN],
    ]);
    expect(estimatesCard(tasks, actual, subjects, 'week', ctx)).toEqual({
      card: 'estimates',
      range: 'week',
      tasks: 3,
      plannedMs: 120 * MIN,
      focusedMs: 159 * MIN,
      ratio: 1.3,
      overruns: [
        { taskId: 1, title: 'A', estimateMs: 60 * MIN, actualMs: 96 * MIN },
        { taskId: 2, title: 'B', estimateMs: 30 * MIN, actualMs: 48 * MIN },
      ],
      bySubject: [
        { subjectId: 4, label: 'COMP2261', ratio: 1.6 },
        { subjectId: null, label: 'No subject', ratio: 0.5 },
      ],
    });
    expect(estimatesCard([], new Map(), subjects, 'week', ctx)).toMatchObject({
      tasks: 0,
      ratio: null,
      overruns: [],
      bySubject: [],
    });
  });
  it('keeps the 3 largest overruns and treats a task with no focus as 0', () => {
    const tasks = [1, 2, 3, 4].map((id) => ({
      id,
      title: `T${id}`,
      day: '2026-11-11',
      estimateMin: 10,
      effectiveSubjectId: 1,
    }));
    const actual = new Map([
      [1, 20 * MIN],
      [2, 50 * MIN],
      [3, 30 * MIN],
    ]);
    const card = estimatesCard(tasks, actual, subjects, 'today', ctx);
    expect(card.overruns.map((o) => o.taskId)).toEqual([2, 3, 1]);
    expect(card.focusedMs).toBe(100 * MIN);
  });
});
