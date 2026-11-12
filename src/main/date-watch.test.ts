import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateKey } from './db/backup';
import { DATE_CHECK_MS, watchDateChange, type DateWatchDeps } from './date-watch';
import { FakeClock } from './timer/test-clock';

const HOUR = 3_600_000;

describe('watchDateChange', () => {
  const start = new Date(2026, 10, 9, 22, 30, 0).getTime(); // Monday 22:30
  let clock: FakeClock;
  let power: EventEmitter;
  let backup: ReturnType<typeof vi.fn<(now: number) => Promise<void>>>;
  let recaps: ReturnType<typeof vi.fn<(now: number) => void>>;
  let log: ReturnType<typeof vi.fn<(msg: string, err: unknown) => void>>;
  let stop: () => void;

  const deps = (over: Partial<DateWatchDeps> = {}): DateWatchDeps => ({
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    power,
    lastBackupDay: localDateKey(start),
    studyDay: (now) => localDateKey(now - 4 * HOUR), // a 04:00 rollover
    backup,
    recaps,
    log,
    ...over,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    clock = new FakeClock(start);
    power = new EventEmitter();
    backup = vi.fn<(now: number) => Promise<void>>(() => Promise.resolve());
    recaps = vi.fn<(now: number) => void>();
    log = vi.fn<(msg: string, err: unknown) => void>();
  });
  afterEach(() => stop());

  it('checks hourly and backs up once the local date changes, with that moment', async () => {
    stop = watchDateChange(deps());
    expect(clock.periods()).toEqual([DATE_CHECK_MS]);
    clock.advance(HOUR); // 23:30
    expect(backup).not.toHaveBeenCalled();
    clock.advance(HOUR); // 00:30 the next day
    await flush();
    expect(backup).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledWith(start + 2 * HOUR);
    clock.advance(HOUR);
    await flush();
    expect(backup).toHaveBeenCalledTimes(1); // already done today
  });

  it('computes pending recaps when the study day changes (after the rollover)', async () => {
    stop = watchDateChange(deps());
    clock.advance(4 * HOUR); // 02:30: still Monday's study day
    expect(recaps).not.toHaveBeenCalled();
    clock.advance(2 * HOUR); // 04:30: Tuesday's
    expect(recaps).toHaveBeenCalledTimes(1);
    expect(recaps).toHaveBeenCalledWith(start + 6 * HOUR);
    await flush();
  });

  it('checks on resume and unlock as well', async () => {
    stop = watchDateChange(deps());
    clock.time = start + 3 * HOUR; // asleep across midnight: no interval fired
    power.emit('resume');
    await flush();
    expect(backup).toHaveBeenCalledWith(start + 3 * HOUR);
    clock.time = start + 27 * HOUR;
    power.emit('unlock-screen');
    await flush();
    expect(backup).toHaveBeenCalledTimes(2);
  });

  it('logs a failed backup, never throws, and retries at the next check', async () => {
    backup.mockRejectedValueOnce(new Error('disk full'));
    stop = watchDateChange(deps());
    clock.advance(2 * HOUR);
    await flush();
    expect(log).toHaveBeenCalledWith('StudyAt: daily backup failed', expect.any(Error));
    clock.advance(HOUR);
    await flush();
    expect(backup).toHaveBeenCalledTimes(2);
  });

  it('logs a backup that throws synchronously, never throws, and retries at the next check', async () => {
    backup.mockImplementation(() => {
      throw new Error('EPERM');
    });
    stop = watchDateChange(deps({ lastBackupDay: null }));
    for (let i = 0; i < 6; i++) {
      expect(() => clock.advance(HOUR)).not.toThrow(); // 23:30 … 04:30, every check fails
      await flush();
    }
    expect(backup).toHaveBeenCalledTimes(6);
    expect(log).toHaveBeenCalledTimes(6);
    expect(log).toHaveBeenCalledWith('StudyAt: daily backup failed', expect.any(Error));
    expect(recaps).toHaveBeenCalledTimes(1); // the 04:30 study-day change still ran
  });

  it('logs a failing recap computation and keeps checking', async () => {
    recaps.mockImplementation(() => {
      throw new Error('boom');
    });
    stop = watchDateChange(deps());
    expect(() => clock.advance(6 * HOUR)).not.toThrow();
    expect(log).toHaveBeenCalledWith('StudyAt: computing weekly recaps failed', expect.any(Error));
    await flush();
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it('newStudyDay runs on a study-day change, and its failure is logged', async () => {
    const order: string[] = [];
    recaps.mockImplementation(() => void order.push('recaps'));
    const newStudyDay = vi.fn<(now: number) => void>(() => {
      order.push('newStudyDay');
      throw new Error('roll forward failed');
    });
    stop = watchDateChange(deps({ newStudyDay }));
    clock.advance(4 * HOUR); // 02:30: still Monday's study day
    expect(newStudyDay).not.toHaveBeenCalled();
    clock.advance(2 * HOUR); // 04:30: Tuesday's
    expect(newStudyDay).toHaveBeenCalledTimes(1);
    expect(newStudyDay).toHaveBeenCalledWith(start + 6 * HOUR);
    expect(order).toEqual(['recaps', 'newStudyDay']);
    expect(log).toHaveBeenCalledWith('StudyAt: starting the new study day failed', expect.any(Error));
    clock.advance(HOUR);
    expect(newStudyDay).toHaveBeenCalledTimes(1);
    await flush();
  });

  it('newStudyDay still runs when the recaps fail', async () => {
    recaps.mockImplementation(() => {
      throw new Error('no recaps');
    });
    const newStudyDay = vi.fn<(now: number) => void>();
    stop = watchDateChange(deps({ newStudyDay }));
    clock.advance(6 * HOUR);
    expect(newStudyDay).toHaveBeenCalledTimes(1);
    await flush();
  });

  it('never runs two backups at once', async () => {
    let release!: () => void;
    backup.mockImplementation(() => new Promise<void>((r) => (release = r)));
    stop = watchDateChange(deps());
    clock.advance(2 * HOUR);
    power.emit('resume');
    expect(backup).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it('a launch whose backup failed backs up at the first check', async () => {
    stop = watchDateChange(deps({ lastBackupDay: null }));
    clock.advance(HOUR);
    await flush();
    expect(backup).toHaveBeenCalledWith(start + HOUR);
  });

  it('stop removes the interval and the power listeners', () => {
    stop = watchDateChange(deps());
    stop();
    expect(clock.periods()).toEqual([]);
    expect(power.listenerCount('resume') + power.listenerCount('unlock-screen')).toBe(0);
  });
});
