import { describe, expect, it } from 'vitest';
import type { Deadline } from '../../shared/types';
import { examLine, nextRepeatDay, revisionSchedule, rollForwardMoves, upcomingExam } from './schedule';

describe('nextRepeatDay', () => {
  it('daily, weekdays, weekly and every N after the task day', () => {
    expect(nextRepeatDay({ kind: 'daily' }, '2026-11-11', '2026-11-11')).toBe('2026-11-12');
    expect(nextRepeatDay({ kind: 'weekdays' }, '2026-11-13', '2026-11-13')).toBe('2026-11-16');
    expect(nextRepeatDay({ kind: 'weekly' }, '2026-11-11', '2026-11-11')).toBe('2026-11-18');
    expect(nextRepeatDay({ kind: 'every', days: 3 }, '2026-11-11', '2026-11-11')).toBe('2026-11-14');
  });
  it('a past task day jumps to the first matching day on or after today', () => {
    expect(nextRepeatDay({ kind: 'daily' }, '2026-11-02', '2026-11-11')).toBe('2026-11-11');
    expect(nextRepeatDay({ kind: 'weekdays' }, '2026-11-02', '2026-11-14')).toBe('2026-11-16');
    expect(nextRepeatDay({ kind: 'weekly' }, '2026-11-02', '2026-11-11')).toBe('2026-11-16');
    expect(nextRepeatDay({ kind: 'every', days: 5 }, '2026-11-01', '2026-11-12')).toBe('2026-11-16');
  });
  it('crosses a DST change and a month end on day keys', () => {
    expect(nextRepeatDay({ kind: 'daily' }, '2026-10-24', '2026-10-24')).toBe('2026-10-25');
    expect(nextRepeatDay({ kind: 'weekly' }, '2026-10-29', '2026-10-29')).toBe('2026-11-05');
    expect(nextRepeatDay({ kind: 'weekly' }, '2026-03-22', '2026-03-22')).toBe('2026-03-29');
    expect(nextRepeatDay({ kind: 'daily' }, '2026-01-31', '2026-01-31')).toBe('2026-02-01');
  });
  it('a weekday today is itself the match when the task day is past', () => {
    expect(nextRepeatDay({ kind: 'weekdays' }, '2026-11-02', '2026-11-11')).toBe('2026-11-11');
  });
});

describe('rollForwardMoves', () => {
  it('moves only open past-day tasks and keeps the first rolledFrom', () => {
    expect(rollForwardMoves([
      { id: 1, day: '2026-11-10', done: false, rolledFrom: null },
      { id: 2, day: '2026-11-10', done: true, rolledFrom: null },
      { id: 3, day: '2026-11-11', done: false, rolledFrom: null },
      { id: 4, day: '2026-11-09', done: false, rolledFrom: '2026-11-05' },
      { id: 5, day: null, done: false, rolledFrom: null },
    ], '2026-11-11')).toEqual([
      { id: 1, day: '2026-11-11', rolledFrom: '2026-11-10' },
      { id: 4, day: '2026-11-11', rolledFrom: '2026-11-05' },
    ]);
  });
  it('is idempotent', () => {
    expect(rollForwardMoves([{ id: 1, day: '2026-11-11', done: false, rolledFrom: '2026-11-10' }], '2026-11-11')).toEqual([]);
  });
});

describe('revisionSchedule', () => {
  it('adds each n to the tick day', () => {
    expect(revisionSchedule('2026-11-11', [1, 3, 7, 21], null)).toEqual(['2026-11-12', '2026-11-14', '2026-11-18', '2026-12-02']);
  });
  it('drops reviews after the exam and adds one the day before it', () => {
    expect(revisionSchedule('2026-11-11', [1, 3, 7, 21], '2026-11-20')).toEqual(['2026-11-12', '2026-11-14', '2026-11-18', '2026-11-19']);
  });
  it('adds nothing when a review already falls the day before the exam', () => {
    expect(revisionSchedule('2026-11-11', [1, 3, 21], '2026-11-15')).toEqual(['2026-11-12', '2026-11-14']);
  });
  it('adds nothing when the day before the exam is not after the tick day', () => {
    expect(revisionSchedule('2026-11-11', [3, 7], '2026-11-12')).toEqual([]);
  });
  it('keeps a review on the exam day itself', () => {
    expect(revisionSchedule('2026-11-11', [1, 3], '2026-11-14')).toEqual(['2026-11-12', '2026-11-14']);
  });
  it('sorts unsorted input without mutating it', () => {
    const days = Object.freeze([7, 1, 3]);
    expect(revisionSchedule('2026-11-11', days, null)).toEqual(['2026-11-12', '2026-11-14', '2026-11-18']);
    expect(days).toEqual([7, 1, 3]);
  });
});

const dl = (id: number, kind: Deadline['kind'], subjectId: number | null, due: string, done = false): Deadline =>
  ({ id, title: `d${id}`, kind, subjectId, due, note: '', done, createdAt: 0, updatedAt: 0 });
const deadlines = [
  dl(1, 'exam', 3, '2026-12-14T09:00'),
  dl(2, 'exam', 3, '2026-11-20T09:00', true),
  dl(3, 'coursework', 3, '2026-11-12T12:00'),
  dl(4, 'exam', 3, '2026-11-01T09:00'),
];

it('upcomingExam picks the soonest open exam of the subject after now', () => {
  expect(upcomingExam(deadlines, 3, '2026-11-11T10:00')?.due).toBe('2026-12-14T09:00');
  expect(upcomingExam(deadlines, null, '2026-11-11T10:00')).toBeNull();
  expect(upcomingExam(deadlines, 4, '2026-11-11T10:00')).toBeNull();
});

it('examLine', () => {
  expect(examLine('2026-12-04', '2026-11-11')).toBe('Exam in 23 days');
  expect(examLine('2026-11-12', '2026-11-11')).toBe('Exam in 1 day');
  expect(examLine('2026-11-11', '2026-11-11')).toBe('Exam today');
});
