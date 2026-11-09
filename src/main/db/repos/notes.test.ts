import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { NOW, openTestDb, tempDir } from '../test-helpers';
import { NOTE_MAX_CHARS, notesRepo } from './notes';

describe('notesRepo', () => {
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

  it('creates empty notes at the end, yellow by default, and returns the whole list', () => {
    const repo = notesRepo(db);
    expect(repo.list()).toEqual([]);
    const first = repo.create({}, NOW);
    expect(first).toEqual([{ id: first[0]!.id, text: '', colour: 'yellow', sort: 0, createdAt: NOW, updatedAt: NOW }]);
    const second = repo.create({ colour: 'purple' }, NOW + 1);
    expect(second.map((n) => [n.colour, n.sort, n.createdAt])).toEqual([
      ['yellow', 0, NOW],
      ['purple', 1, NOW + 1],
    ]);
    expect(repo.list()).toEqual(second);
  });

  it('updates text and colour, stamps updatedAt, cuts text to 5000 chars, and returns null for an unknown id', () => {
    const repo = notesRepo(db);
    const id = repo.create({}, NOW)[0]!.id;
    expect(repo.update(id, { text: 'Ask about lab 4' }, NOW + 10)).toEqual([
      { id, text: 'Ask about lab 4', colour: 'yellow', sort: 0, createdAt: NOW, updatedAt: NOW + 10 },
    ]);
    expect(repo.update(id, { colour: 'green' }, NOW + 20)![0]).toMatchObject({
      text: 'Ask about lab 4',
      colour: 'green',
      updatedAt: NOW + 20,
    });

    expect(NOTE_MAX_CHARS).toBe(5000);
    const long = repo.update(id, { text: 'x'.repeat(5001) }, NOW + 30)![0]!;
    expect(long.text).toHaveLength(5000);
    // An emoji straddling the cut is dropped whole, never left as half a surrogate pair.
    const emoji = repo.update(id, { text: `${'x'.repeat(4999)}\u{1F600}` }, NOW + 40)![0]!;
    expect(emoji.text).toBe('x'.repeat(4999));
    const lone = repo.update(id, { text: `ab\uD83D` }, NOW + 50)![0]!;
    expect(lone.text).toBe('ab');

    expect(repo.update(9999, { text: 'nope' }, NOW)).toBeNull();
  });

  it('removes and reorders (by sort, then id) and the result survives a reopen', async () => {
    const repo = notesRepo(db);
    repo.create({}, NOW);
    repo.create({ colour: 'pink' }, NOW + 1);
    const [a, b, c] = repo.create({ colour: 'blue' }, NOW + 2);
    expect(repo.reorder([c!.id, a!.id, b!.id]).map((n) => n.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(repo.remove(a!.id).map((n) => n.id)).toEqual([c!.id, b!.id]);
    expect(repo.remove(9999).map((n) => n.id)).toEqual([c!.id, b!.id]);

    // Equal sorts fall back to id order.
    db.raw.run('UPDATE notes SET sort = 0');
    expect(repo.list().map((n) => n.id)).toEqual([b!.id, c!.id]);
    repo.reorder([c!.id, b!.id]);

    await db.close();
    db = await openTestDb(dir);
    expect(
      notesRepo(db)
        .list()
        .map((n) => [n.id, n.sort, n.colour]),
    ).toEqual([
      [c!.id, 0, 'blue'],
      [b!.id, 1, 'pink'],
    ]);
  });

  it('marks the database dirty after every write', () => {
    const repo = notesRepo(db);
    const spy = vi.spyOn(db, 'markDirty');
    const id = repo.create({}, NOW)[0]!.id;
    repo.update(id, { text: 'a' }, NOW);
    repo.reorder([id]);
    repo.remove(id);
    expect(spy).toHaveBeenCalledTimes(4);
  });
});
