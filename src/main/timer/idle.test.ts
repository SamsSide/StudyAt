import { describe, expect, it } from 'vitest';
import { FocusLedger, IdleWatch } from './idle';

const MIN = 60_000;

describe('IdleWatch', () => {
  it('starts an away period at the threshold, dated back to the last input', () => {
    const w = new IdleWatch();
    expect(w.poll(599, 1_000_000, true, 10 * MIN)).toEqual({ kind: 'none' });
    expect(w.poll(600, 1_000_000, true, 10 * MIN)).toEqual({ kind: 'away', since: 400_000 });
  });

  it('does not start one while the timer is not running', () => {
    expect(new IdleWatch().poll(3_600, 1_000_000, false, 10 * MIN)).toEqual({ kind: 'none' });
  });

  it('ends it when idle drops below 5 s, running or not', () => {
    const w = new IdleWatch();
    w.poll(600, 1_000_000, true, 10 * MIN);
    expect(w.poll(5, 1_100_000, false, 10 * MIN)).toEqual({ kind: 'none' });
    expect(w.poll(4.9, 1_100_000, false, 10 * MIN)).toEqual({ kind: 'back', since: 400_000 });
    expect(w.since).toBeNull();
  });
});

describe('FocusLedger', () => {
  it('charges only overlapping focus time, per row, newest first', () => {
    const l = new FocusLedger();
    l.add(1, 0, 250);
    l.add(1, 250, 500); // merged
    l.add(1, 700, 1_000); // a pause from 500 to 700
    l.add(2, 1_000, 2_000);
    expect(l.covered(400, 1_500)).toEqual([
      { rowId: 2, ms: 500 },
      { rowId: 1, ms: 400 },
    ]);
  });

  it('prunes the spans a predicate rejects and lists the rows still referenced', () => {
    const l = new FocusLedger();
    l.add(1, 0, 100);
    l.add(2, 200, 300);
    l.add(3, 300, 400);
    l.prune((s) => s.to >= 150 && s.rowId !== 3);
    expect(l.covered(0, 1_000)).toEqual([{ rowId: 2, ms: 100 }]);
    expect([...l.rowIds()]).toEqual([2]);
  });

  it('ignores empty spans', () => {
    const l = new FocusLedger();
    l.add(1, 100, 100);
    expect(l.covered(0, 1_000)).toEqual([]);
  });
});
