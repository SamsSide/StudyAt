import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMINDER_CHECK_MS } from '../core/planner/reminders';
import type { Db } from './db/db';
import { plannerTasksRepo, type PlannerTasksRepo } from './db/repos/plannerTasks';
import { openTestDb, tempDir } from './db/test-helpers';
import { checkReminders, startReminders, type RemindersDeps } from './reminders';
import { FakeClock } from './timer/test-clock';

const SEC = 1000;
const MIN = 60 * SEC;
const at = (d: number, h: number, m: number, s = 0): number => new Date(2026, 10, d, h, m, s).getTime();

describe('reminders', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;
  let repo: PlannerTasksRepo;
  let clock: FakeClock;
  let notify: ReturnType<typeof vi.fn<(taskId: number, title: string) => void>>;
  let settings: { notifications: boolean; rolloverHour: number };
  let stop: (() => void) | null;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir);
    repo = plannerTasksRepo(db);
    notify = vi.fn<(taskId: number, title: string) => void>();
    settings = { notifications: true, rolloverHour: 4 };
    stop = null;
  });
  afterEach(async () => {
    stop?.();
    await db.close();
    cleanup();
  });

  const deps = (): RemindersDeps => ({
    db,
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    settings: () => settings,
    notify,
  });
  const task = (title: string, reminder: string, day = '2026-11-11') =>
    repo.create({ title, day, listId: null, reminder }, at(10, 12, 0));

  it('fires once at its time and marks the day', () => {
    const t = task('Read ch. 4', '18:30');
    clock = new FakeClock(at(11, 18, 29, 50));
    stop = startReminders(deps());
    expect(clock.periods()).toEqual([REMINDER_CHECK_MS]);
    expect(notify).not.toHaveBeenCalled();
    clock.advance(30 * SEC);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(t.id, 'Read ch. 4');
    clock.advance(10 * MIN);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(repo.get(t.id)?.remindedDay).toBe('2026-11-11');
  });

  it('at launch fires up to 60 min late and drops later', () => {
    const late = task('Read ch. 4', '18:30');
    const old = task('Flashcards', '17:00');
    clock = new FakeClock(at(11, 19, 20));
    stop = startReminders(deps());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(late.id, 'Read ch. 4');
    expect(repo.get(old.id)?.remindedDay).toBe('2026-11-11');
    clock.advance(10 * MIN);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('reports what it fired and dropped', () => {
    const late = task('Read ch. 4', '18:30');
    const old = task('Flashcards', '17:00');
    clock = new FakeClock(at(11, 19, 20));
    expect(checkReminders(deps())).toEqual({ fired: [late.id], dropped: [old.id] });
    expect(checkReminders(deps())).toEqual({ fired: [], dropped: [] });
  });

  it('a before-rollover reminder fires on the next calendar date', () => {
    const t = task('Night review', '02:00');
    clock = new FakeClock(at(11, 2, 0));
    stop = startReminders(deps());
    expect(notify).not.toHaveBeenCalled(); // the 11th at 02:00 is still the 10th's study day
    clock.jump(at(12, 2, 0) - clock.time);
    clock.advance(REMINDER_CHECK_MS);
    expect(notify).toHaveBeenCalledWith(t.id, 'Night review');
    expect(repo.get(t.id)?.remindedDay).toBe('2026-11-11');
  });

  it('a before-rollover reminder fires exactly at 02:00 on the next calendar date', () => {
    const t = task('Night review', '02:00');
    clock = new FakeClock(at(12, 2, 0));
    expect(checkReminders(deps()).fired).toEqual([t.id]);
  });

  it('a reminder on yesterday’s study day still fires when ≤ 60 min late after the rollover', () => {
    const t = task('Night review', '03:30');
    clock = new FakeClock(at(12, 4, 15)); // the 12th's study day; 45 min late
    expect(checkReminders(deps()).fired).toEqual([t.id]);
  });

  it('notifications off: due reminders are marked and nothing shows', () => {
    const t = task('Read ch. 4', '18:30');
    settings.notifications = false;
    clock = new FakeClock(at(11, 18, 30));
    stop = startReminders(deps());
    expect(notify).not.toHaveBeenCalled();
    expect(repo.get(t.id)?.remindedDay).toBe('2026-11-11');
    settings.notifications = true;
    clock.advance(REMINDER_CHECK_MS);
    expect(notify).not.toHaveBeenCalled();
  });

  it('done tasks and list tasks never fire', () => {
    const done = task('Read ch. 4', '18:30');
    repo.update(done.id, { done: true }, at(11, 12, 0));
    const listed = repo.create({ title: 'Someday', day: null, listId: 1, reminder: '18:30' }, at(10, 12, 0));
    clock = new FakeClock(at(11, 18, 31));
    expect(checkReminders(deps())).toEqual({ fired: [], dropped: [] });
    expect(notify).not.toHaveBeenCalled();
    expect(repo.get(done.id)?.remindedDay).toBeNull();
    expect(repo.get(listed.id)?.remindedDay).toBeNull();
  });

  it('a task moved to a new day fires again on that day', () => {
    const t = task('Read ch. 4', '18:30');
    clock = new FakeClock(at(11, 18, 30));
    checkReminders(deps());
    repo.update(t.id, { day: '2026-11-12' }, at(11, 19, 0));
    clock = new FakeClock(at(12, 18, 30));
    expect(checkReminders(deps()).fired).toEqual([t.id]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('a failing notification is not retried (once per task-day) and the others still fire', () => {
    const a = task('A', '18:30');
    const b = task('B', '18:30');
    notify.mockImplementationOnce(() => {
      throw new Error('toast failed');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clock = new FakeClock(at(11, 18, 30));
    expect(checkReminders(deps()).fired).toEqual([a.id, b.id]);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    expect(repo.get(a.id)?.remindedDay).toBe('2026-11-11');
    log.mockRestore();
  });

  it('stop clears the interval', () => {
    clock = new FakeClock(at(11, 12, 0));
    const s = startReminders(deps());
    s();
    expect(clock.periods()).toEqual([]);
  });
});
