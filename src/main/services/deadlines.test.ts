import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/db';
import { subjectsRepo } from '../db/repos/subjects';
import { openTestDb, tempDir } from '../db/test-helpers';
import { deadlinesService } from './deadlines';
import { IpcValidationError } from './validate';

let cleanup: () => void;
let db: Db;
/** 2026-11-11 15:00 local. */
const NOW = new Date(2026, 10, 11, 15, 0).getTime();

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir, NOW);
});
afterEach(async () => {
  await db.close();
  cleanup();
});

const svc = () => deadlinesService({ db, now: () => NOW });
const make = (s: ReturnType<typeof svc>, title: string, kind: 'exam' | 'coursework', due: string) => {
  s.create({ title, kind, subjectId: null, due });
  return s.view().upcoming.concat(s.view().past).find((d) => d.title === title)!;
};

describe('deadlinesService', () => {
  function seed() {
    const s = svc();
    const a = make(s, 'A', 'coursework', '2026-11-11T09:00');
    const b = make(s, 'B', 'coursework', '2026-11-12T12:00');
    const c = make(s, 'C', 'exam', '2026-12-14T09:00');
    const d = make(s, 'D', 'coursework', '2026-11-10T09:00');
    const e = make(s, 'E', 'coursework', '2026-11-13T12:00');
    s.update(e.id, { done: true });
    return { s, a, b, c, d, e };
  }

  it('lists upcoming soonest first, keeping earlier today, and past latest first', () => {
    const { s, a, b, c, d, e } = seed();
    expect(s.list(false).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(s.list(true).map((x) => x.id)).toEqual([e.id, d.id]);
    expect(s.view().upcoming.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it('caps the past list at 10', () => {
    const s = svc();
    for (let i = 0; i < 12; i++) make(s, `Old ${i}`, 'exam', `2026-10-${String(i + 1).padStart(2, '0')}T09:00`);
    const past = s.list(true);
    expect(past).toHaveLength(10);
    expect(past[0]?.title).toBe('Old 11');
  });

  it('moves a deadline to past once it is done', () => {
    const { s, b } = seed();
    const view = s.update(b.id, { done: true });
    expect(view.past.map((x) => x.id)).toContain(b.id);
    expect(view.upcoming.map((x) => x.id)).not.toContain(b.id);
  });

  it('rejects an unknown subject, a bad due and a missing id', () => {
    const s = svc();
    expect(() => s.create({ title: 'X', kind: 'exam', subjectId: 77, due: '2026-12-01T09:00' })).toThrow('No such subject');
    expect(() => s.create({ title: 'X', kind: 'exam', subjectId: null, due: '2026-12-01' })).toThrow(IpcValidationError);
    expect(() => s.create({ title: ' ', kind: 'exam', subjectId: null, due: '2026-12-01T09:00' })).toThrow(IpcValidationError);
    expect(() => s.remove(9999)).toThrow('No such deadline');
    expect(() => s.update(9999, { done: true })).toThrow('No such deadline');
  });

  it('accepts a real subject and removes', () => {
    const subject = subjectsRepo(db).create({ name: 'MATH', colour: '#112233' });
    const s = svc();
    const view = s.create({ title: 'Quiz', kind: 'coursework', subjectId: subject.id, due: '2026-12-01T12:00', note: 'n' });
    expect(view.upcoming[0]).toMatchObject({ subjectId: subject.id, note: 'n' });
    expect(s.remove(view.upcoming[0]!.id).upcoming).toEqual([]);
  });

  it('accepts a 5000-character note and rejects 5001, on create and update', () => {
    const s = svc();
    const base = { title: 'X', kind: 'exam', subjectId: null, due: '2026-12-01T09:00' } as const;
    const view = s.create({ ...base, note: 'a'.repeat(5000) });
    expect(view.upcoming[0]!.note).toHaveLength(5000);
    expect(() => s.create({ ...base, note: 'a'.repeat(5001) })).toThrow(IpcValidationError);
    const id = view.upcoming[0]!.id;
    expect(s.update(id, { note: 'b'.repeat(5000) }).upcoming[0]!.note).toHaveLength(5000);
    expect(() => s.update(id, { note: 'b'.repeat(5001) })).toThrow(IpcValidationError);
  });

  it('rejects impossible due dates', () => {
    const s = svc();
    for (const due of ['2026-02-30T09:00', '2026-11-12T24:00', '2026-13-01T09:00']) {
      expect(() => s.create({ title: 'X', kind: 'exam', subjectId: null, due })).toThrow(IpcValidationError);
    }
    expect(() => s.create({ title: 'X', kind: 'exam', subjectId: null, due: '2028-02-29T09:00' })).not.toThrow();
  });
});
