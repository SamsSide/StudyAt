import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WeeklyRecap } from '../../../shared/types';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { recapsRepo } from './recaps';

const recap = (weekStart: string, totalMs: number): WeeklyRecap => ({
  weekStart,
  totalMs,
  prevTotalMs: 0,
  daysStudied: 3,
  bestDay: { dayKey: weekStart, ms: totalMs },
  topSubjects: [{ subjectId: 1, name: 'COMP2181 Theory of Computation', ms: totalMs }],
  longestSessionMs: 1_500_000,
  streakAtEnd: 2,
  goalDaysHit: 0,
});

describe('recapsRepo', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir);
  });
  afterEach(async () => {
    await db.close();
    cleanup();
  });

  it('upserts, marks shown (kept across upsert) and round-trips', async () => {
    const repo = recapsRepo(db);
    expect(repo.get('2026-10-26')).toBeNull();
    repo.upsert(recap('2026-11-02', 3_600_000));
    repo.upsert(recap('2026-10-26', 7_200_000));
    expect(repo.list().map((r) => r.weekStart)).toEqual(['2026-10-26', '2026-11-02']);
    repo.markShown('2026-11-02', NOW);
    repo.upsert(recap('2026-11-02', 4_000_000));
    expect(repo.get('2026-11-02')).toEqual({ recap: recap('2026-11-02', 4_000_000), shownAt: NOW });
    await db.close();
    db = await openTestDb(dir);
    expect(recapsRepo(db).get('2026-10-26')).toEqual({
      recap: recap('2026-10-26', 7_200_000),
      shownAt: null,
    });
    expect(recapsRepo(db).list()).toHaveLength(2);
  });
});
