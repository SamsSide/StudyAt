// A fake clock and interval scheduler for the timer controller tests. `advance` moves time forward
// and fires every due interval in time order, with `now()` equal to each firing time.
interface Job {
  id: number;
  fn: () => void;
  every: number;
  next: number;
}

export class FakeClock {
  private jobs = new Map<number, Job>();
  private nextId = 1;

  constructor(public time: number) {}

  now = (): number => this.time;

  setInterval = ((fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.jobs.set(id, { id, fn, every: ms, next: this.time + ms });
    return id as unknown as NodeJS.Timeout;
  }) as unknown as typeof setInterval;

  clearInterval = ((handle: unknown) => {
    this.jobs.delete(handle as number);
  }) as unknown as typeof clearInterval;

  /** Intervals currently scheduled, by period. */
  periods(): number[] {
    return [...this.jobs.values()].map((j) => j.every).sort((a, b) => a - b);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let due: Job | null = null;
      for (const j of this.jobs.values()) if (j.next <= target && (!due || j.next < due.next)) due = j;
      if (!due) break;
      this.time = due.next;
      due.next += due.every;
      due.fn();
    }
    this.time = target;
  }

  /** Sets the wall clock by `ms` (either way) while intervals keep their monotonic pace. */
  shift(ms: number): void {
    this.time += ms;
    for (const j of this.jobs.values()) j.next += ms;
  }

  /** Moves the clock without firing anything (a suspended machine). */
  jump(ms: number): void {
    this.time += ms;
    for (const j of this.jobs.values()) j.next = Math.max(j.next, this.time);
  }
}
