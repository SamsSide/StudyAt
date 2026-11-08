// Idle detection and away-time bookkeeping for the timer controller (spec §3.4 rule 4, appplan §5).
// Pure: no clock and no Electron; the controller passes `now` and the system idle seconds in.

/** How often the system idle time is polled while the timer runs. */
export const IDLE_POLL_MS = 5_000;
/** Idle below this many seconds means Sam is back. */
export const BACK_BELOW_SECONDS = 5;
/** An unanswered away prompt is discarded after this long (the honesty default, spec §3.13). */
export const AWAY_AUTO_DISCARD_MS = 120_000;

export type IdlePoll = { kind: 'none' } | { kind: 'away'; since: number } | { kind: 'back'; since: number };

/**
 * Tracks one away period. `since` is set retroactively (`now − idleSeconds·1000`) once the idle
 * time reaches the threshold while the timer runs, and is handed back when Sam returns.
 */
export class IdleWatch {
  since: number | null = null;

  poll(idleSeconds: number, now: number, running: boolean, thresholdMs: number): IdlePoll {
    if (this.since === null) {
      if (!running || idleSeconds * 1000 < thresholdMs) return { kind: 'none' };
      this.since = now - idleSeconds * 1000;
      return { kind: 'away', since: this.since };
    }
    if (idleSeconds >= BACK_BELOW_SECONDS) return { kind: 'none' };
    const since = this.since;
    this.since = null;
    return { kind: 'back', since };
  }

  clear(): void {
    this.since = null;
  }
}

interface Span {
  rowId: number;
  from: number;
  to: number;
}

/**
 * When focus time was accrued, and to which session row. An away period is charged only for the
 * focus time that actually ran inside it, row by row (so a period that straddles a segment end or
 * a subject-change split is charged to each row it covered).
 */
export class FocusLedger {
  private spans: Span[] = [];

  add(rowId: number, from: number, to: number): void {
    if (to <= from) return;
    const last = this.spans[this.spans.length - 1];
    if (last && last.rowId === rowId && last.to === from) last.to = to;
    else this.spans.push({ rowId, from, to });
  }

  /** Drops spans that ended before `before`. */
  prune(before: number): void {
    this.spans = this.spans.filter((s) => s.to >= before);
  }

  /** Focus ms per row inside `[from, to]`, newest row first. */
  covered(from: number, to: number): Array<{ rowId: number; ms: number }> {
    const byRow = new Map<number, number>();
    for (const s of this.spans) {
      const ms = Math.min(s.to, to) - Math.max(s.from, from);
      if (ms > 0) byRow.set(s.rowId, (byRow.get(s.rowId) ?? 0) + ms);
    }
    return [...byRow.entries()].map(([rowId, ms]) => ({ rowId, ms })).reverse();
  }
}
