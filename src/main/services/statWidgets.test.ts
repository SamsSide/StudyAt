import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/db';
import { openTestDb, tempDir } from '../db/test-helpers';
import { statWidgetsService } from './statWidgets';
import { IpcValidationError } from './validate';

let cleanup: () => void;
let db: Db;
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

describe('statWidgetsService', () => {
  it('adds a Total time · This week card, cascading each next one', () => {
    const svc = statWidgetsService({ db, now: () => NOW });
    const first = svc.add();
    expect(first).toMatchObject({ card: 'total', range: 'week', x: 0.5, y: 0.3, scale: 1, bare: false });
    const second = svc.add();
    expect(second.x).toBeCloseTo(0.53, 10);
    expect(second.y).toBeCloseTo(0.34, 10);
    expect(svc.list().map((w) => w.id)).toEqual([first.id, second.id]);
  });

  it('refuses a 7th with the limit copy', () => {
    const svc = statWidgetsService({ db, now: () => NOW });
    for (let i = 0; i < 6; i++) svc.add();
    expect(() => svc.add()).toThrow('Up to 6 stats widgets');
    expect(svc.list()).toHaveLength(6);
  });

  it('updates, clamping position and scale', () => {
    const svc = statWidgetsService({ db, now: () => NOW });
    const w = svc.add();
    const out = svc.update(w.id, { card: 'goal', range: 'month', x: 2, y: -1, scale: 9, bare: true });
    expect(out).toMatchObject({ card: 'goal', range: 'month', x: 1, y: 0, scale: 2, bare: true });
    expect(svc.update(w.id, { scale: 0.1 })?.scale).toBe(0.5);
    expect(svc.update(9999, { bare: true })).toBeNull();
  });

  it('rejects non-finite numbers and unknown enums before the repo', () => {
    const svc = statWidgetsService({ db, now: () => NOW });
    const w = svc.add();
    expect(() => svc.update(w.id, { x: Number.NaN })).toThrow(IpcValidationError);
    expect(() => svc.update(w.id, { scale: Infinity })).toThrow(IpcValidationError);
    expect(() => svc.update(w.id, { card: 'nope' as 'total' })).toThrow(IpcValidationError);
    expect(svc.list()[0]).toMatchObject({ x: 0.5, scale: 1 });
  });

  it('removes, and a missing id is a no-op', () => {
    const svc = statWidgetsService({ db, now: () => NOW });
    const w = svc.add();
    svc.remove(w.id);
    svc.remove(w.id);
    expect(svc.list()).toEqual([]);
  });
});
