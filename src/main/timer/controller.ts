// The main-process timer (spec §3.4, appplan §4.4 and §5; study-dev rules 1–4). It drives the pure
// machine with a 250 ms tick and turns its effects into session rows: a row is inserted when a
// focus segment starts, checkpointed every 15 s and on every pause, and closed (or deleted if under
// a minute) when it ends. Suspend and lock pause it; idle time over the threshold becomes an away
// prompt that is discarded if not answered in 2 minutes, renderer or not, unless the away prompt
// is switched off (v1.1 spec §3.1). A Countdown is a focus segment like a Pomodoro focus (spec
// §3.2). No clock inside: time, intervals and idle seconds are injected.
import {
  initialState,
  lengthOf,
  step,
  type MachineState,
  type TimerConfig,
  type TimerEvent,
} from '../../core/timer/machine';
import { dayKeyOf } from '../../core/time';
import { isFocusMode } from '../../shared/modes';
import type { AwayPrompt, Mode, SegmentEnd, TimerState } from '../../shared/types';
import type { Db } from '../db/db';
import { sessionsRepo, type SessionsRepo } from '../db/repos/sessions';
import { settingsRepo, type SettingsRepo } from '../db/repos/settings';
import { clearAwayMarker, readAwayMarker, writeAwayMarker } from './away-marker';
import { AWAY_AUTO_DISCARD_MS, FocusLedger, IDLE_POLL_MS, IdleWatch } from './idle';

export const TICK_MS = 250;
/** Running focus rows are written at least this often (≤ 15 s lost on a crash, spec §3.3). */
export const CHECKPOINT_MS = 15_000;
/**
 * While running, a gap longer than this between two steps of the machine is a sleep Electron did
 * not report (Modern Standby): the timer pauses for `suspend` at the last step and the gap never
 * accrues (Sam's ruling A4, 2026-11-08). Ticks come every 250 ms, so a live process never gets near it.
 */
export const SLEEP_GAP_MS = 30_000;
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
    /** `segmentMs` is the length of the segment that ended (a Countdown's notification shows it). */
    segmentEnd(e: SegmentEnd, segmentMs: number): void;
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
  taskId: number | null;
  second: number;
  at: number;
}

export class TimerController {
  private readonly sessions: SessionsRepo;
  private readonly settings: SettingsRepo;
  private cfg!: TimerConfig;
  private idleThresholdMs = 10 * MINUTE;
  /** Off: idle time is never polled, so no away period, prompt or discard (spec §3.1). */
  private awayPrompt = true;
  /**
   * When the away prompt last went from off to on. An away period never reaches back before it, so
   * focus accrued while the switch was off stays kept (spec §3.1: "applies from the next poll").
   */
  private awayPromptOnSince = Number.NEGATIVE_INFINITY;
  private rolloverHour = 4;
  private machine: MachineState;
  private subjectId: number | null = null;
  /** The task held on the timer and its text as chosen (spec §3.3); kept even if later ticked off. */
  private taskId: number | null = null;
  private taskText: string | null = null;
  /** The focus row of the current segment, open from focus start to its end. */
  private open: Row | null = null;
  /** Rows the ledger or a pending prompt can still charge, plus the open one. */
  private readonly rows = new Map<number, Row>();
  /** The current and previous pomodoro ids, newest last; their ledger spans are always kept. */
  private recentPomodoros: string[] = [];
  private readonly ledger = new FocusLedger();
  private readonly idle = new IdleWatch();
  private pending: Pending | null = null;
  /** This run has an away marker in `meta` (R39) that resolving the period must clear. */
  private markerOpen = false;
  private lastCheckpointAt = 0;
  private lastEmitted: Emitted | null = null;
  private dirty = false;
  /** Set by `dispose` (and so by `quit`): no interval, command or poll steps the machine again. */
  private disposed = false;
  /** Set once `quit` has run its discard and close; only then is a further `quit` a no-op. */
  private quitDone = false;
  /** The state answered once disposed, so a late IPC call never reads a database that may be closed. */
  private frozen: TimerState | null = null;
  private lastTodayFocusMs = 0;
  private tickTimer: Handle | null = null;
  private pollTimer: Handle | null = null;
  private awayTimer: Handle | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.sessions = sessionsRepo(deps.db);
    this.settings = settingsRepo(deps.db);
    this.loadSettings();
    this.machine = initialState(this.cfg);
  }

  /**
   * Spec §3.4 rule 7: closes every `running` row at its last checkpoint, then rule 6 applies. A row
   * named by an away marker left by a crash loses its away time, which becomes discarded time,
   * running or already closed (R39: an unanswered period is discarded). An unnoticed period takes
   * the focus accrued after it began; a period whose prompt was pending takes the prompt's fixed
   * charge, so focus earned after Sam came back is kept.
   */
  recoverOrphans(): void {
    if (this.disposed) return;
    const marker = this.markerOpen ? null : readAwayMarker(this.deps.db);
    // Per marked row: how much of its focus the away period took.
    const taken = new Map<number, (focusMs: number) => number>();
    if (marker && 'charges' in marker)
      for (const { rowId, ms } of marker.charges) taken.set(rowId, (f) => Math.min(ms, f));
    else if (marker)
      for (const { rowId, focusMsAtSince: cap } of marker.rows) taken.set(rowId, (f) => Math.max(0, f - cap));
    const capped = (focusMs: number, discardedMs: number, id: number): [number, number] => {
      const take = Math.max(0, taken.get(id)?.(focusMs) ?? 0);
      return [focusMs - take, discardedMs + take];
    };
    for (const row of this.sessions.listRunning()) {
      if (row.id === this.open?.id) continue;
      const [focusMs, discardedMs] = capped(row.focusMs, row.discardedMs, row.id);
      this.sessions.close(row.id, row.checkpointAt, focusMs, discardedMs);
      this.sessions.deleteIfShort(row.id);
      taken.delete(row.id);
      this.dirty = true;
    }
    // Rows that closed during the away period (a segment end or a subject split) before the crash.
    for (const id of taken.keys()) {
      const row = this.sessions.get(id);
      if (!row || row.status !== 'done') continue;
      const [focusMs, discardedMs] = capped(row.focusMs, row.discardedMs, id);
      if (focusMs === row.focusMs) continue;
      this.sessions.close(id, row.endedAt ?? row.checkpointAt, focusMs, discardedMs);
      this.sessions.deleteIfShort(id);
      this.dirty = true;
    }
    if (marker) {
      clearAwayMarker(this.deps.db);
      this.dirty = true;
    }
    this.settle(this.deps.now());
  }

  getState(): TimerState {
    if (this.disposed && this.frozen) return this.frozen;
    return this.liveState(this.deps.now());
  }

  private liveState(now: number): TimerState {
    this.lastTodayFocusMs = this.todayFocusMs(now, isFocusMode(this.machine.mode) ? this.liveMs(now) : 0);
    return this.snapshot(now, this.lastTodayFocusMs);
  }

  private liveMs(now: number): number {
    const m = this.machine;
    return m.status === 'running' && m.runningSince !== null
      ? Math.min(m.remainingMs, Math.max(0, now - m.runningSince))
      : 0;
  }

  /** The state from memory alone; `todayFocusMs` is passed in because computing it reads the DB. */
  private snapshot(now: number, todayFocusMs: number): TimerState {
    const m = this.machine;
    const live = this.liveMs(now);
    return {
      mode: m.mode,
      status: m.status,
      remainingMs: m.remainingMs - live,
      segmentMs: m.segmentMs,
      completedFocusCount: m.completedFocusCount,
      subjectId: this.subjectId,
      pauseReason: m.pauseReason,
      todayFocusMs,
      taskId: this.taskId,
      taskText: this.taskText,
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
      this.split(now);
    });
  }

  /**
   * Spec §3.3: a task change splits the row exactly like a subject change. `text` is the task's
   * text now, recorded on the row so Stats keeps its old name. The same id again changes nothing.
   */
  setTask(id: number | null, text: string | null): TimerState {
    return this.command((now) => {
      if (id === this.taskId) return;
      this.taskId = id;
      this.taskText = id === null ? null : text;
      this.split(now);
    });
  }

  /** Mid-segment, closes the open row and opens one on the same pomodoro and day key. */
  private split(now: number): void {
    if (!this.open) return;
    // The whole pomodoro is credited to its start day, even if the change comes after the
    // rollover (Sam's ruling A3, 2026-11-08).
    const { pomodoroId, dayKey } = this.open;
    this.closeOpen(now);
    this.openRow(pomodoroId, now, dayKey);
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

  /**
   * Re-reads settings; a fresh idle segment takes the new length now rather than at its start. The
   * away prompt switched off drops an unprompted away period (its time is kept); a prompt already
   * showing still resolves (spec §3.1).
   */
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

  /**
   * Rule 3: the timer stays paused until Sam resumes it. A timer still running here missed the
   * suspend event, so it pauses for `suspend` at the last step and the sleep is not accrued (A4).
   */
  onResume(): void {
    this.command(() => undefined, true);
  }

  onUnlock(): void {
    this.command(() => undefined);
  }

  /**
   * Rule 9: ends the running row as in rule 6, flushes, and stops every interval. It still does so
   * after a plain `dispose`, so an away period is never left in a `running` row for crash recovery
   * to close as study time (A1). Only a completed `quit` makes a second call a no-op.
   */
  async quit(): Promise<void> {
    if (this.quitDone) return;
    const now = this.deps.now();
    this.tick(now);
    // No answer is possible after quitting, so an away period still open, prompted or not yet
    // noticed, is discarded (rule 4's honesty default; Sam's ruling A1, 2026-11-08).
    if (!this.pending && this.idle.since !== null) {
      this.pending = {
        prompt: { awayMs: 0, deadline: now },
        charges: this.ledger.covered(this.idle.since, now),
      };
    }
    this.idle.clear();
    if (this.pending) this.resolveAway('discard', now);
    if (this.open) this.closeOpen(now);
    this.quitDone = true; // everything above is synchronous, so a second call can't interleave
    const final = this.liveState(now); // read while the database is surely open
    this.dispose();
    this.frozen = final;
    await this.deps.db.flushNow();
  }

  /** Stops intervals, polling and further commands; `quit` may still run afterwards. */
  dispose(): void {
    if (!this.disposed) this.frozen = this.snapshot(this.deps.now(), this.lastTodayFocusMs);
    this.disposed = true;
    for (const h of [this.tickTimer, this.pollTimer, this.awayTimer])
      if (h !== null) this.deps.clearInterval(h);
    this.tickTimer = this.pollTimer = this.awayTimer = null;
  }

  // ── Driving the machine ────────────────────────────────────────────────────

  /**
   * Every command first ticks at `now` (R8), so a segment that ran out between ticks ends properly.
   * After quit or dispose nothing steps or writes: a late command would otherwise open a row that
   * becomes an orphan.
   */
  private command(fn: (now: number) => void, slept = false): TimerState {
    if (this.disposed) return this.getState();
    const now = this.deps.now();
    this.tick(now, slept);
    fn(now);
    this.settle(now, true);
    return this.getState();
  }

  private apply(event: TimerEvent, now: number): void {
    const before = this.machine;
    if (
      event.type === 'skip' ||
      event.type === 'reset' ||
      event.type === 'setMode' ||
      this.willEnd(event, now)
    ) {
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
          this.deps.emit.segmentEnd({ mode: effect.mode, next: effect.next }, before.segmentMs);
          break;
      }
    }
  }

  /**
   * Steps the machine to `now`, unless the gap since its last step says the PC slept unreported
   * (or `slept` says so): then it pauses for `suspend` at that last step, accruing nothing (A4).
   */
  private tick(now: number, slept = false): void {
    const m = this.machine;
    if (m.status === 'running' && m.runningSince !== null && (slept || now - m.runningSince > SLEEP_GAP_MS)) {
      this.pauseFor('suspend', m.runningSince);
      return;
    }
    this.apply({ type: 'tick' }, now);
  }

  private willEnd(event: TimerEvent, now: number): boolean {
    const m = this.machine;
    return (
      event.type === 'tick' &&
      m.status === 'running' &&
      m.runningSince !== null &&
      now - m.runningSince >= m.remainingMs
    );
  }

  private pauseFor(reason: 'user' | 'suspend' | 'lock', now: number): void {
    if (this.machine.status !== 'running') return;
    this.apply({ type: 'pause', reason }, now);
    if (this.open) this.checkpoint(now);
  }

  private onTick(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    this.tick(now);
    // A clock set backwards must not hold checkpoints back until it catches up.
    const due = now - this.lastCheckpointAt >= CHECKPOINT_MS || now < this.lastCheckpointAt;
    if (this.open && this.machine.status === 'running' && due) this.checkpoint(now);
    this.settle(now);
  }

  /** Writes what changed, starts or stops intervals, and emits state if it changed (or always). */
  private settle(now: number, always = false): void {
    this.dropAwayIfOff();
    this.pruneLedger(now);
    this.syncTimers();
    if (this.dirty) {
      this.dirty = false;
      this.deps.db
        .flushNow()
        .catch((err: unknown) => console.error('StudyAt: could not save the session', err));
    }
    const m = this.machine;
    const remaining =
      m.status === 'running' && m.runningSince !== null
        ? m.remainingMs - Math.max(0, now - m.runningSince)
        : m.remainingMs;
    const next: Emitted = {
      mode: m.mode,
      status: m.status,
      pauseReason: m.pauseReason,
      completedFocusCount: m.completedFocusCount,
      subjectId: this.subjectId,
      taskId: this.taskId,
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
      last.taskId !== next.taskId ||
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
    // With the away prompt off there is nothing to poll for (spec §3.1).
    const poll = this.awayPrompt && (running || this.idle.since !== null);
    this.pollTimer = this.keep(this.pollTimer, poll, IDLE_POLL_MS, () => this.onPoll());
    // The auto-discard runs here in main, whether or not any renderer is listening.
    this.awayTimer = this.keep(this.awayTimer, this.pending !== null, AWAY_CHECK_MS, () =>
      this.onAwayCheck(),
    );
  }

  private keep(handle: Handle | null, on: boolean, ms: number, fn: () => void): Handle | null {
    if (on && handle === null) return this.deps.setInterval(fn, ms);
    if (!on && handle !== null) this.deps.clearInterval(handle);
    return on ? handle : null;
  }

  // ── Session rows ───────────────────────────────────────────────────────────

  /** `dayKey` is given for a subject split, which stays on its pomodoro's start day (A3). */
  private openRow(pomodoroId: string, now: number, dayKey = dayKeyOf(now, this.rolloverHour)): void {
    const s = this.sessions.insertRunning({
      pomodoroId,
      subjectId: this.subjectId,
      taskId: this.taskId,
      taskText: this.taskText,
      startedAt: now,
      dayKey,
    });
    const row: Row = {
      id: s.id,
      pomodoroId,
      dayKey,
      endedAt: null,
      focusMs: 0,
      discardedMs: 0,
      deleted: false,
    };
    this.rows.set(row.id, row);
    this.open = row;
    if (this.recentPomodoros.at(-1) !== pomodoroId)
      this.recentPomodoros = [...this.recentPomodoros, pomodoroId].slice(-2);
    this.lastCheckpointAt = now;
    this.dirty = true;
    // A row opened during an away period (a split or an auto-started focus) joins its marker.
    if (this.idle.since !== null) this.writeMarker(this.idle.since, now);
  }

  private checkpoint(now: number): void {
    if (!this.open) return;
    this.sessions.checkpoint(this.open.id, this.open.focusMs, now, this.open.discardedMs);
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
    for (const s of this.sessions.list({ from: today, to: today }))
      if (s.id !== this.open?.id) total += s.focusMs;
    if (this.open?.dayKey === today) total += this.open.focusMs + live;
    return total;
  }

  // ── Idle and away (rule 4) ─────────────────────────────────────────────────

  private onPoll(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    if (this.pending) return;
    if (!this.awayPrompt) {
      this.syncTimers();
      return;
    }
    const result = this.idle.poll(
      this.deps.idleSeconds(),
      now,
      this.machine.status === 'running',
      this.idleThresholdMs,
    );
    if (result.kind === 'away') {
      // Idle time from before the switch went on is not away time: the period starts no earlier
      // than the switch-on, and the marker and the later prompt use that same start.
      const since = Math.max(result.since, this.awayPromptOnSince);
      this.idle.since = since;
      // R39: the row and the marker reach the disk now, so a crash from here on never credits
      // the away time.
      this.tick(now);
      this.checkpoint(now);
      this.writeMarker(since, now);
      this.settle(now);
    } else if (result.kind === 'back') {
      this.tick(now);
      const pending = this.raiseAway(result.since, now);
      if (pending) {
        // From here a crash discards exactly the prompt's charges and keeps what Sam earns after
        // coming back; the row reaches the disk with the marker so the two agree.
        this.checkpoint(now);
        this.writeChargeMarker(result.since, pending.charges);
      } else {
        // Nothing ran while away, so there is no prompt and nothing left to discard on a crash.
        this.clearMarker();
      }
      this.settle(now, true);
    } else {
      this.syncTimers();
    }
  }

  /** Each row the away period since `since` can charge, with its focus at `since` (R39). */
  private writeMarker(since: number, now: number): void {
    const charged = new Map(this.ledger.covered(since, now).map((c) => [c.rowId, c.ms]));
    const rows: Array<{ rowId: number; focusMsAtSince: number }> = [];
    for (const row of this.rows.values()) {
      if (row.deleted || (row !== this.open && !charged.has(row.id))) continue;
      rows.push({ rowId: row.id, focusMsAtSince: Math.max(0, row.focusMs - (charged.get(row.id) ?? 0)) });
    }
    writeAwayMarker(this.deps.db, { since, rows });
    this.markerOpen = true;
    this.dirty = true;
  }

  /** The pending prompt's fixed per-row charges replace the unnoticed period's caps (R39). */
  private writeChargeMarker(since: number, charges: Pending['charges']): void {
    writeAwayMarker(this.deps.db, { since, charges: charges.map(({ rowId, ms }) => ({ rowId, ms })) });
    this.markerOpen = true;
    this.dirty = true;
  }

  /**
   * Spec §3.1: with the away prompt off, an away period not yet prompted is dropped, its time kept,
   * and its crash marker cleared. A pending prompt is left to resolve as normal.
   */
  private dropAwayIfOff(): void {
    if (this.awayPrompt || this.pending || this.idle.since === null) return;
    this.idle.clear();
    this.clearMarker();
  }

  private clearMarker(): void {
    if (!this.markerOpen) return;
    clearAwayMarker(this.deps.db);
    this.markerOpen = false;
    this.dirty = true;
  }

  /**
   * The away time is the focus time at stake: the focus that actually ran between `since` and now,
   * which is `now − since` when the timer ran throughout and less if it was paused, locked or
   * between segments meanwhile. The prompt's "{n} min" shows this figure (Sam's ruling A2,
   * 2026-11-08), not the wall-clock absence.
   */
  private raiseAway(since: number, now: number): Pending | null {
    const charges = this.ledger.covered(since, now);
    const awayMs = charges.reduce((sum, c) => sum + c.ms, 0);
    if (awayMs <= 0) return null; // no focus time ran while away: nothing to keep or discard
    this.pending = { prompt: { awayMs, deadline: now + AWAY_AUTO_DISCARD_MS }, charges };
    this.deps.emit.away(this.pending.prompt);
    return this.pending;
  }

  private onAwayCheck(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    if (!this.pending || now < this.pending.prompt.deadline) return;
    this.tick(now);
    this.resolveAway('discard', now);
    this.settle(now, true);
  }

  private resolveAway(answer: 'keep' | 'discard', now: number): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (answer === 'discard') this.discard(pending.charges, now);
    this.clearMarker();
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

  /**
   * Keeps the spans an away period could still reach back to: every span of the current and the
   * previous pomodoro (so a late poll or a lowered threshold can't reach past them), and every span
   * inside the open away period or the idle window. Rows no span refers to are then forgotten.
   * Nothing is dropped while a prompt is pending: its charges name rows.
   */
  private pruneLedger(now: number): void {
    if (this.pending) return;
    const cutoff = this.idle.since ?? now - this.idleThresholdMs - IDLE_POLL_MS - MINUTE;
    const recent = (rowId: number): boolean => {
      const pomodoroId = this.rows.get(rowId)?.pomodoroId;
      return pomodoroId !== undefined && this.recentPomodoros.includes(pomodoroId);
    };
    this.ledger.prune((span) => span.to >= cutoff || recent(span.rowId));
    const charged = this.ledger.rowIds();
    for (const id of this.rows.keys()) if (id !== this.open?.id && !charged.has(id)) this.rows.delete(id);
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
      countdownMs: s.countdownMinutes * MINUTE,
    };
    if (s.awayPrompt && !this.awayPrompt) this.awayPromptOnSince = this.deps.now();
    this.awayPrompt = s.awayPrompt;
    this.idleThresholdMs = s.idleMinutes * MINUTE;
    this.rolloverHour = s.rolloverHour;
  }

  /** A fresh (untouched) idle segment takes the configured length of its mode. */
  private resizeIdle(): void {
    const m = this.machine;
    if (m.status !== 'idle' || m.remainingMs !== m.segmentMs) return;
    const len = lengthOf(m.mode, this.cfg);
    this.machine = { ...m, segmentMs: len, remainingMs: len };
  }
}
