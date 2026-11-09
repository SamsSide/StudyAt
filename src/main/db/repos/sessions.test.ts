import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { sessionsRepo } from './sessions';

describe('sessionsRepo', () => {
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

  const start = (
    over: Partial<{
      pomodoroId: string;
      subjectId: number | null;
      taskId: number | null;
      taskText: string | null;
      startedAt: number;
      dayKey: string;
    }> = {},
  ) =>
    sessionsRepo(db).insertRunning({
      pomodoroId: 'p-1',
      subjectId: 1,
      taskId: null,
      taskText: null,
      startedAt: NOW,
      dayKey: '2026-11-08',
      ...over,
    });

  // v1.1 spec §3.3: a row keeps the task it was studied for, id and text.
  it('stores and reads taskId and taskText', () => {
    const s = start({ taskId: 7, taskText: 'Lab 3' });
    expect(s).toMatchObject({ taskId: 7, taskText: 'Lab 3' });
    expect(sessionsRepo(db).list({})).toEqual([
      expect.objectContaining({ id: s.id, taskId: 7, taskText: 'Lab 3' }),
    ]);
  });

  it('inserts a running row, checkpoints and closes it', () => {
    const repo = sessionsRepo(db);
    const markDirty = vi.spyOn(db, 'markDirty');
    const s = start();
    expect(s).toEqual({
      id: s.id,
      pomodoroId: 'p-1',
      subjectId: 1,
      startedAt: NOW,
      endedAt: null,
      checkpointAt: NOW,
      focusMs: 0,
      discardedMs: 0,
      dayKey: '2026-11-08',
      status: 'running',
      taskId: null,
      taskText: null,
    });
    expect(markDirty).toHaveBeenCalled();
    repo.checkpoint(s.id, 15_000, NOW + 15_000);
    expect(repo.listRunning()).toEqual([{ ...s, focusMs: 15_000, checkpointAt: NOW + 15_000 }]);
    repo.close(s.id, NOW + 120_000, 110_000, 10_000);
    expect(repo.listRunning()).toEqual([]);
    expect(repo.all()[0]).toMatchObject({
      status: 'done',
      endedAt: NOW + 120_000,
      focusMs: 110_000,
      discardedMs: 10_000,
    });
  });

  it('a checkpoint writes discarded time when given and leaves it alone otherwise', () => {
    const repo = sessionsRepo(db);
    const s = start();
    repo.checkpoint(s.id, 60_000, NOW + 15_000, 30_000);
    expect(repo.listRunning()[0]).toMatchObject({
      focusMs: 60_000,
      discardedMs: 30_000,
      checkpointAt: NOW + 15_000,
    });
    repo.checkpoint(s.id, 75_000, NOW + 30_000);
    expect(repo.listRunning()[0]).toMatchObject({
      focusMs: 75_000,
      discardedMs: 30_000,
      checkpointAt: NOW + 30_000,
    });
  });

  it('ignores a checkpoint on a closed row', () => {
    const repo = sessionsRepo(db);
    const s = start();
    repo.close(s.id, NOW + 90_000, 90_000, 0);
    repo.checkpoint(s.id, 1, NOW + 95_000);
    expect(repo.all()[0]).toMatchObject({ focusMs: 90_000, checkpointAt: NOW });
  });

  it('close can re-apply a discard to a just-finished row', () => {
    const repo = sessionsRepo(db);
    const s = start();
    repo.close(s.id, NOW + 1_500_000, 1_500_000, 0);
    repo.close(s.id, NOW + 1_500_000, 1_200_000, 300_000);
    expect(repo.all()[0]).toMatchObject({ focusMs: 1_200_000, discardedMs: 300_000, status: 'done' });
  });

  it('deleteIfShort removes 59 999 ms rows and keeps 60 000 ms rows', () => {
    const repo = sessionsRepo(db);
    const short = start();
    const long = start({ pomodoroId: 'p-2' });
    repo.close(short.id, NOW + 59_999, 59_999, 0);
    repo.close(long.id, NOW + 60_000, 60_000, 0);
    expect(repo.deleteIfShort(short.id)).toBe(true);
    expect(repo.deleteIfShort(long.id)).toBe(false);
    expect(repo.all().map((s) => s.id)).toEqual([long.id]);
  });

  it('gets one row by id, or null', () => {
    const a = start();
    expect(sessionsRepo(db).get(a.id)).toEqual(a);
    expect(sessionsRepo(db).get(a.id + 99)).toBeNull();
  });

  it('deleteIfShort never deletes a running row', () => {
    const repo = sessionsRepo(db);
    const s = start();
    expect(repo.deleteIfShort(s.id)).toBe(false);
    expect(repo.listRunning()).toHaveLength(1);
  });

  it('lists by inclusive day-key range and subject, oldest first', () => {
    const repo = sessionsRepo(db);
    const a = start({ dayKey: '2026-11-06', startedAt: NOW - 2 * 86_400_000, subjectId: 1 });
    const b = start({ dayKey: '2026-11-07', startedAt: NOW - 86_400_000, subjectId: null });
    const c = start({ dayKey: '2026-11-08', subjectId: 2 });
    expect(repo.list({}).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(repo.list({ from: '2026-11-07' }).map((s) => s.id)).toEqual([b.id, c.id]);
    expect(repo.list({ to: '2026-11-07' }).map((s) => s.id)).toEqual([a.id, b.id]);
    expect(repo.list({ from: '2026-11-07', to: '2026-11-07' }).map((s) => s.id)).toEqual([b.id]);
    expect(repo.list({ subjectId: 2 }).map((s) => s.id)).toEqual([c.id]);
    expect(repo.list({ subjectId: null }).map((s) => s.id)).toEqual([b.id]);
  });

  it('changes a subject and removes a row', () => {
    const repo = sessionsRepo(db);
    const s = start();
    repo.close(s.id, NOW + 600_000, 600_000, 0);
    repo.updateSubject(s.id, null);
    expect(repo.all()[0]).toMatchObject({ subjectId: null, focusMs: 600_000 });
    repo.updateSubject(s.id, 3);
    expect(repo.all()[0]!.subjectId).toBe(3);
    repo.remove(s.id);
    expect(repo.all()).toEqual([]);
  });

  it('round-trips a running row through the file', async () => {
    const s = start();
    sessionsRepo(db).checkpoint(s.id, 30_000, NOW + 30_000);
    await db.close();
    db = await openTestDb(dir);
    expect(sessionsRepo(db).listRunning()).toEqual([{ ...s, focusMs: 30_000, checkpointAt: NOW + 30_000 }]);
  });
});
