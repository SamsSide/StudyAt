// The main-process timer (spec §3.4, appplan §4.4 and §5; study-dev rules 1–4). It drives the pure
// machine with a 250 ms tick and turns its effects into session rows: a row is inserted when a
// focus segment starts, checkpointed every 15 s and on every pause, and closed (or deleted if under
// a minute) when it ends. Suspend and lock pause it; idle time over the threshold becomes an away
// prompt that is discarded if not answered in 2 minutes, renderer or not. No clock inside: time,
// intervals and idle seconds are injected.
import { initialState, step, type MachineState, type TimerConfig, type TimerEvent } from '../../core/timer/machine';
import { dayKeyOf } from '../../core/time';
import type { AwayPrompt, Mode, SegmentEnd, TimerState } from '../../shared/types';
import type { Db } from '../db/db';
import { sessionsRepo, type SessionsRepo } from '../db/repos/sessions';
import { settingsRepo, type SettingsRepo } from '../db/repos/settings';
import { AWAY_AUTO_DISCARD_MS, FocusLedger, IDLE_POLL_MS, IdleWatch } from './idle';

export const TICK_MS = 250;
/** Running focus rows are written at least this often (≤ 15 s lost on a crash, spec §3.3). */
export const CHECKPOINT_MS = 15_000;
/** How often an open away prompt checks its deadline. */
const AWAY_CHECK_MS = 1_000;
/** While running, state is emitted on each new second, and at least this often. */
const EMIT_EVERY_MS = 1_000;
const MINUTE = 60_000;

export interface ControllerDeps {
  db: Db;
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  uuid: () => string;
  /** System idle time in seconds (`powerMonitor.getSystemIdleTime()`). */
  idleSeconds: () => number;
  emit: {
    state(s: TimerState): void;
    away(p: AwayPrompt | null): void;
    segmentEnd(e: SegmentEnd): void;
  };
}

type Handle = ReturnType<typeof setInterval>;

/** A session row this run has written; the in-memory copy is the truth while it is open. */
interface Row {
  id: number;
  pomodoroId: string;
  dayKey: string;
  endedAt: number | null;
  focusMs: number;
  discardedMs: number;
  deleted: boolean;
}

interface Pending {
  prompt: AwayPrompt;
  /** Focus ms the away period covered, per row, newest first. */
  charges: Array<{ rowId: number; ms: number }>;
}

interface Emitted {
  mode: Mode;
  status: MachineState['status'];
  pauseReason: MachineState['pauseReason'];
  completedFocusCount: number;
  subjectId: number | null;
  second: number;
  at: number;
}

export class TimerController {
  private readonly sessions: SessionsRepo;
  private readonly settings: SettingsRepo;
  private cfg!: TimerConfig;
  private idleThresholdMs = 10 * MINUTE;
  private rolloverHour = 4;
  private machine: MachineState;
  private subjectId: number | null = null;
  /** The focus row of the current segment, open from focus start to its end. */
  private open: Row | null = null;
  private readonly rows = new Map<number, Row>();
  private readonly ledger = new FocusLedger();
  private readonly idle = new IdleWatch();
  private pending: Pending | null = null;
  private lastCheckpointAt = 0;
  private lastEmitted: Emitted | null = null;
  private dirty = false;
  private disposed = false;
  private tickTimer: Handle | null = null;
  private pollTimer: Handle | null = null;
  private awayTimer: Handle | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.sessions = sessionsRepo(deps.db);
    this.settings = settingsRepo(deps.db);
    this.loadSettings();
    this.machine = initialState(this.cfg);
  }

  /** Spec §3.4 rule 7: closes every `running` row at its last checkpoint, then rule 6 applies. */
  recoverOrphans(): void {
    for (const row of this.sessions.listRunning()) {
      if (row.id === this.open?.id) continue;
      this.sessions.close(row.id, row.checkpointAt, row.focusMs, row.discardedMs);
      this.sessions.deleteIfShort(row.id);
      this.dirty = true;
    }
    this.settle(this.deps.now());
  }

  getState(): TimerState {
    const now = this.deps.now();
    const m = this.machine;
    const live = m.status === 'running' && m.runningSince !== null ? Math.min(m.remainingMs, Math.max(0, now - m.runningSince)) : 0;
    return {
      mode: m.mode,
      status: m.status,
      remainingMs: m.remainingMs - live,
      segmentMs: m.segmentMs,
      completedFocusCount: m.completedFocusCount,
      subjectId: this.subjectId,
      pauseReason: m.pauseReason,
      todayFocusMs: this.todayFocusMs(now, m.mode === 'focus' ? live : 0),
    };
  }

  start(): TimerState {
    return this.command((now) => {
      if (this.machine.status === 'idle') {
        // Settings are read at each segment start, so a changed length applies to a fresh segment.
        this.loadSettings();
        this.resizeIdle();
      }
      this.apply({ type: 'start' }, now);
    });
  }

  pause(): TimerState {
    return this.command((now) => this.pauseFor('user', now));
  }

  resume(): TimerState {
    return this.command((now) => this.apply({ type: 'resume' }, now));
  }

  /** Ends the row (rule 6) and returns the current mode to full length, idle. No chime. */
  reset(): TimerState {
    return this.command((now) => this.apply({ type: 'reset' }, now));
  }

  /** Ends the row (rule 6) and moves to the next mode, idle. No chime, no auto-start. */
  skip(): TimerState {
    return this.command((now) => this.apply({ type: 'skip' }, now));
  }

  setMode(mode: Mode): TimerState {
    return this.command((now) => this.apply({ type: 'setMode', mode }, now));
  }

  /** Rule 5: mid-segment, closes the row and opens one with the same pomodoro; the countdown is unaffected. */
  setSubject(id: number | null): TimerState {
    return this.command((now) => {
      if (id === this.subjectId) return;
      this.subjectId = id;
      if (!this.open) return;
      const pomodoroId = this.open.pomodoroId;
      this.closeOpen(now);
      this.openRow(pomodoroId, now);
    });
  }

  /** Keep changes nothing; discard takes the away time out of the rows it covered (rule 4). */
  answerAway(answer: 'keep' | 'discard'): TimerState {
    return this.command((now) => this.resolveAway(answer, now));
  }

  /** idle → start, running → pause, paused → resume (whatever paused it). For the hotkey and Space. */
  toggle(): TimerState {
    if (this.machine.status === 'idle') return this.start();
    return this.machine.status === 'running' ? this.pause() : this.resume();
  }

  /** Re-reads settings; a fresh idle segment takes the new length now rather than at its start. */
  applySettings(): TimerState {
    return this.command(() => {
      this.loadSettings();
      this.resizeIdle();
    });
  }

  onSuspend(): void {
    this.command((now) => this.pauseFor('suspend', now));
  }

  onLock(): void {
    this.command((now) => this.pauseFor('lock', now));
  }

  /** Rule 3: the timer stays paused until Sam resumes it. */
  onResume(): void {
    this.command(() => undefined);
  }

  onUnlock(): void {
    this.command(() => undefined);
  }

  /** Rule 9: ends the running row as in rule 6, flushes, and stops every interval. */
  async quit(): Promise<void> {
    const now = this.deps.now();
    this.apply({ type: 'tick' }, now);
    // No answer is possible after quitting, so an away period still open is discarded (rule 4's
    // honesty default).
    if (!this.pending && this.idle.since !== null) {
      this.pending = { prompt: { awayMs: 0, deadline: now }, charges: this.ledger.covered(this.idle.since, now) };
    }
    this.idle.clear();
    if (this.pending) this.resolveAway('discard', now);
    if (this.open) this.closeOpen(now);
    this.dispose();
    await this.deps.db.flushNow();
  }

  dispose(): void {
    this.disposed = true;
    for (const h of [this.tickTimer, this.pollTimer, this.awayTimer]) if (h !== null) this.deps.clearInterval(h);
    this.tickTimer = this.pollTimer = this.awayTimer = null;
  }

  // ── Driving the machine ────────────────────────────────────────────────────

  /** Every command first ticks at `now` (R8), so a segment that ran out between ticks ends properly. */
  private command(fn: (now: number) => void): TimerState {
    const now = this.deps.now();
    this.apply({ type: 'tick' }, now);
    fn(now);
    this.settle(now, true);
    return this.getState();
  }

  private apply(event: TimerEvent, now: number): void {
    const before = this.machine;
    if (event.type === 'skip' || event.type === 'reset' || event.type === 'setMode' || this.willEnd(event, now)) {
      // The next segment (idle or auto-started) is built from the settings as they are now.
      this.loadSettings();
    }
    const { state, effects } = step(before, event, now, this.cfg);
    this.machine = state;
    for (const effect of effects) {
      switch (effect.type) {
        case 'accrue': {
          if (!this.open) break;
          const from = before.runningSince ?? now - effect.ms;
          this.open.focusMs += effect.ms;
          this.ledger.add(this.open.id, from, from + effect.ms);
          break;
        }
        case 'focusStopped':
          if (this.open) this.closeOpen(now);
          break;
        case 'focusStarted':
          this.openRow(this.deps.uuid(), now);
          break;
        case 'segmentEnded':
          this.deps.emit.segmentEnd({ mode: effect.mode, next: effect.next });
          break;
      }
    }
  }

  private willEnd(event: TimerEvent, now: number): boolean {
    const m = this.machine;
    return event.type === 'tick' && m.status === 'running' && m.runningSince !== null && now - m.runningSince >= m.remainingMs;
  }

  private pauseFor(reason: 'user' | 'suspend' | 'lock', now: number): void {
    if (this.machine.status !== 'running') return;
    this.apply({ type: 'pause', reason }, now);
    if (this.open) this.checkpoint(now);
  }

  private onTick(): void {
    const now = this.deps.now();
    this.apply({ type: 'tick' }, now);
    // A clock set backwards must not hold checkpoints back until it catches up.
    const due = now - this.lastCheckpointAt >= CHECKPOINT_MS || now < this.lastCheckpointAt;
    if (this.open && this.machine.status === 'running' && due) this.checkpoint(now);
    this.settle(now);
  }

  /** Writes what changed, starts or stops intervals, and emits state if it changed (or always). */
  private settle(now: number, always = false): void {
    this.pruneLedger(now);
    this.syncTimers();
    if (this.dirty) {
      this.dirty = false;
      this.deps.db.flushNow().catch((err: unknown) => console.error('StudyAt: could not save the session', err));
    }
    const m = this.machine;
    const remaining = m.status === 'running' && m.runningSince !== null ? m.remainingMs - Math.max(0, now - m.runningSince) : m.remainingMs;
    const next: Emitted = {
      mode: m.mode,
      status: m.status,
      pauseReason: m.pauseReason,
      completedFocusCount: m.completedFocusCount,
      subjectId: this.subjectId,
      second: Math.ceil(Math.max(0, remaining) / 1000),
      at: now,
    };
    const last = this.lastEmitted;
    const changed =
      !last ||
      last.mode !== next.mode ||
      last.status !== next.status ||
      last.pauseReason !== next.pauseReason ||
      last.completedFocusCount !== next.completedFocusCount ||
      last.subjectId !== next.subjectId ||
      last.second !== next.second ||
      now - last.at >= EMIT_EVERY_MS;
    if (!always && !changed) return;
    this.lastEmitted = next;
    this.deps.emit.state(this.getState());
  }

  private syncTimers(): void {
    if (this.disposed) return;
    const running = this.machine.status === 'running';
    this.tickTimer = this.keep(this.tickTimer, running, TICK_MS, () => this.onTick());
    // Polling goes on after a pause or a segment end while away, so the return is still noticed.
    this.pollTimer = this.keep(this.pollTimer, running || this.idle.since !== null, IDLE_POLL_MS, () => this.onPoll());
    // The auto-discard runs here in main, whether or not any renderer is listening.
    this.awayTimer = this.keep(this.awayTimer, this.pending !== null, AWAY_CHECK_MS, () => this.onAwayCheck());
  }

  private keep(handle: Handle | null, on: boolean, ms: number, fn: () => void): Handle | null {
    if (on && handle === null) return this.deps.setInterval(fn, ms);
    if (!on && handle !== null) this.deps.clearInterval(handle);
    return on ? handle : null;
  }

  // ── Session rows ───────────────────────────────────────────────────────────

  private openRow(pomodoroId: string, now: number): void {
    const dayKey = dayKeyOf(now, this.rolloverHour);
    const s = this.sessions.insertRunning({ pomodoroId, subjectId: this.subjectId, startedAt: now, dayKey });
    const row: Row = { id: s.id, pomodoroId, dayKey, endedAt: null, focusMs: 0, discardedMs: 0, deleted: false };
    this.rows.set(row.id, row);
    this.open = row;
    this.lastCheckpointAt = now;
    this.dirty = true;
  }

  private checkpoint(now: number): void {
    if (!this.open) return;
    this.sessions.checkpoint(this.open.id, this.open.focusMs, now);
    this.lastCheckpointAt = now;
    this.dirty = true;
  }

  /** Rule 6: `ended_at = now`, `status done`; under a minute is deleted. */
  private closeOpen(now: number): void {
    const row = this.open;
    if (!row) return;
    row.endedAt = now;
    this.sessions.close(row.id, now, row.focusMs, row.discardedMs);
    row.deleted = this.sessions.deleteIfShort(row.id);
    this.open = null;
    this.dirty = true;
  }

  private todayFocusMs(now: number, live: number): number {
    const today = dayKeyOf(now, this.rolloverHour);
    let total = 0;
    for (const s of this.sessions.list({ from: today, to: today })) if (s.id !== this.open?.id) total += s.focusMs;
    if (this.open?.dayKey === today) total += this.open.focusMs + live;
    return total;
  }

  // ── Idle and away (rule 4) ─────────────────────────────────────────────────

  private onPoll(): void {
    const now = this.deps.now();
    if (this.pending) return;
    const result = this.idle.poll(this.deps.idleSeconds(), now, this.machine.status === 'running', this.idleThresholdMs);
    if (result.kind === 'back') {
      this.apply({ type: 'tick' }, now);
      this.raiseAway(result.since, now);
      this.settle(now, true);
    } else {
      this.syncTimers();
    }
  }

  /**
   * The away time is the focus time that actually ran between `since` and now: `now − since` when
   * the timer ran throughout, less if it was paused, locked or between segments meanwhile.
   */
  private raiseAway(since: number, now: number): void {
    const charges = this.ledger.covered(since, now);
    const awayMs = charges.reduce((sum, c) => sum + c.ms, 0);
    if (awayMs <= 0) return; // no focus time ran while away: nothing to keep or discard
    this.pending = { prompt: { awayMs, deadline: now + AWAY_AUTO_DISCARD_MS }, charges };
    this.deps.emit.away(this.pending.prompt);
  }

  private onAwayCheck(): void {
    const now = this.deps.now();
    if (!this.pending || now < this.pending.prompt.deadline) return;
    this.apply({ type: 'tick' }, now);
    this.resolveAway('discard', now);
    this.settle(now, true);
  }

  private resolveAway(answer: 'keep' | 'discard', now: number): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (answer === 'discard') this.discard(pending.charges, now);
    this.deps.emit.away(null);
  }

  /**
   * R9: each covered row loses what it accrued while away (never below zero) and gains it as
   * discarded time. A closed row is re-closed and deleted if now under a minute; the countdown
   * gets back only what came out of the still-current focus segment.
   */
  private discard(charges: Pending['charges'], now: number): void {
    let giveBack = 0;
    for (const { rowId, ms } of charges) {
      const row = this.rows.get(rowId);
      if (!row || row.deleted) continue;
      const take = Math.min(ms, row.focusMs);
      if (take <= 0) continue;
      row.focusMs -= take;
      row.discardedMs += take;
      if (row === this.open) {
        this.checkpoint(now);
      } else {
        this.sessions.close(row.id, row.endedAt ?? now, row.focusMs, row.discardedMs);
        row.deleted = this.sessions.deleteIfShort(row.id);
      }
      if (this.open && row.pomodoroId === this.open.pomodoroId) giveBack += take;
      this.dirty = true;
    }
    if (giveBack > 0) this.apply({ type: 'giveBack', ms: giveBack }, now);
  }

  /** Keeps only the spans an away period could still reach back to. */
  private pruneLedger(now: number): void {
    if (this.pending) return;
    if (this.idle.since !== null) this.ledger.prune(this.idle.since);
    else this.ledger.prune(now - this.idleThresholdMs - IDLE_POLL_MS - MINUTE);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  private loadSettings(): void {
    const s = this.settings.get();
    this.cfg = {
      focusMs: s.focusMinutes * MINUTE,
      shortMs: s.shortMinutes * MINUTE,
      longMs: s.longMinutes * MINUTE,
      longEvery: s.longEvery,
      autoStartBreaks: s.autoStartBreaks,
      autoStartFocus: s.autoStartFocus,
    };
    this.idleThresholdMs = s.idleMinutes * MINUTE;
    this.rolloverHour = s.rolloverHour;
  }

  /** A fresh (untouched) idle segment takes the configured length of its mode. */
  private resizeIdle(): void {
    const m = this.machine;
    if (m.status !== 'idle' || m.remainingMs !== m.segmentMs) return;
    const len = m.mode === 'focus' ? this.cfg.focusMs : m.mode === 'short' ? this.cfg.shortMs : this.cfg.longMs;
    this.machine = { ...m, segmentMs: len, remainingMs: len };
  }
}
