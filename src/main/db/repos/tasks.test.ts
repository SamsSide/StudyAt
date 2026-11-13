import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { onTasksChanged, tasksRepo } from './tasks';

describe('tasksRepo', () => {
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

  it('creates, ticks off, reorders, clears done and round-trips', async () => {
    const repo = tasksRepo(db);
    const a = repo.create({ text: 'Read chapter 3', colour: 'yellow' }, NOW);
    const b = repo.create({ text: 'Lab sheet', colour: 'pink' }, NOW + 1);
    const c = repo.create({ text: 'Past paper', colour: 'blue' }, NOW + 2);
    expect(a).toEqual({
      id: a.id,
      text: 'Read chapter 3',
      colour: 'yellow',
      done: false,
      sort: 0,
      createdAt: NOW,
      doneAt: null,
    });
    expect([b.sort, c.sort]).toEqual([1, 2]);

    expect(repo.update(b.id, { done: true }, NOW + 10)).toMatchObject({ done: true, doneAt: NOW + 10 });
    expect(repo.update(b.id, { done: false }, NOW + 20)).toMatchObject({ done: false, doneAt: null });
    expect(repo.update(a.id, { text: 'Read chapter 4', colour: 'green' }, NOW)).toMatchObject({
      text: 'Read chapter 4',
      colour: 'green',
    });
    expect(repo.update(9999, { text: 'x' }, NOW)).toBeNull();

    repo.reorder([c.id, a.id, b.id]);
    expect(repo.list().map((t) => t.id)).toEqual([c.id, a.id, b.id]);

    repo.update(a.id, { done: true }, NOW + 30);
    repo.clearDone();
    await db.close();
    db = await openTestDb(dir);
    expect(
      tasksRepo(db)
        .list()
        .map((t) => [t.id, t.sort]),
    ).toEqual([
      [c.id, 0],
      [b.id, 2],
    ]);
  });

  it('get returns one task by id, or null', () => {
    const repo = tasksRepo(db);
    const a = repo.create({ text: 'Read chapter 3', colour: 'yellow' }, NOW);
    const b = repo.create({ text: 'Lab sheet', colour: 'pink' }, NOW + 1);
    expect(repo.get(b.id)).toEqual(b);
    expect(repo.get(a.id)).toEqual(a);
    expect(repo.get(9999)).toBeNull();
    repo.update(b.id, { done: true }, NOW + 2);
    repo.clearDone();
    expect(repo.get(b.id)).toBeNull();
  });

  it('tells listeners of the same database when a task is ticked, unticked or cleared', () => {
    const heard = vi.fn();
    const stop = onTasksChanged(db, heard);
    const writer = tasksRepo(db); // another repo of the same database, as the IPC handlers use
    const a = writer.create({ text: 'A', colour: 'yellow' }, NOW);
    writer.update(a.id, { text: 'A edited' }, NOW);
    writer.reorder([a.id]);
    expect(heard).not.toHaveBeenCalled();
    writer.update(a.id, { done: true }, NOW);
    writer.update(a.id, { done: true }, NOW); // no change, no call
    writer.update(a.id, { done: false }, NOW);
    writer.clearDone();
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    writer.update(a.id, { done: true }, NOW);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('never lets a throwing listener fail a write or hide it from the next listener', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stopBad = onTasksChanged(db, () => {
      throw new Error('listener broke');
    });
    const heard = vi.fn();
    const stop = onTasksChanged(db, heard);
    const writer = tasksRepo(db);
    const a = writer.create({ text: 'A', colour: 'yellow' }, NOW);
    expect(writer.update(a.id, { done: true }, NOW)?.done).toBe(true);
    expect(() => writer.clearDone()).not.toThrow();
    expect(writer.list()).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    stopBad();
    stop();
    log.mockRestore();
  });
});
