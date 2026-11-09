import { describe, expect, it, vi } from 'vitest';
import {
  BREAK_DONE,
  COUNTDOWN_DONE_TITLE,
  createNotifier,
  FOCUS_DONE,
  TRAY_NOTICE,
  type NotificationLike,
  type NotifyDeps,
} from './notify';

const MIN = 60_000;

function setup(over: Partial<NotifyDeps> = {}) {
  const made: {
    opts: Parameters<NotifyDeps['create']>[0];
    n: NotificationLike & { fire(e: string): void };
  }[] = [];
  const settings = { notifications: true };
  const deps: NotifyDeps = {
    create: (opts) => {
      const handlers = new Map<string, () => void>();
      const n = {
        on: vi.fn((e: string, l: () => void) => void handlers.set(e, l)),
        show: vi.fn(),
        fire: (e: string) => handlers.get(e)?.(),
      };
      made.push({ opts, n });
      return n;
    },
    isSupported: () => true,
    icon: '/assets/icons/icon.png',
    settings: () => settings,
    isMainFocused: () => false,
    onClick: vi.fn(),
    ...over,
  };
  return { notifier: createNotifier(deps), made, settings, deps };
}

describe('notifier', () => {
  it('announces the end of a focus segment and of a break, with the app icon', () => {
    const { notifier, made } = setup();
    expect(notifier.notifySegmentEnd({ mode: 'focus', next: 'short' }, 25 * MIN)).toBe(true);
    expect(notifier.notifySegmentEnd({ mode: 'long', next: 'focus' }, 15 * MIN)).toBe(true);
    expect(made.map((m) => m.opts.body)).toEqual([FOCUS_DONE, BREAK_DONE]);
    expect(FOCUS_DONE).toBe('Focus done — time for a break.');
    expect(BREAK_DONE).toBe('Break over — ready to focus?');
    expect(made[0]?.opts).toMatchObject({ title: 'StudyAt', icon: '/assets/icons/icon.png', silent: true });
    expect(made[0]?.n.show).toHaveBeenCalled();
  });

  it('segment end notification skipped when notifications false', () => {
    const { notifier, made, settings } = setup();
    settings.notifications = false;
    expect(notifier.notifySegmentEnd({ mode: 'focus', next: 'short' }, 25 * MIN)).toBe(false);
    expect(made).toHaveLength(0);
  });

  it('is skipped while StudyAt is the focused window (the widget already shows it)', () => {
    const { notifier, made } = setup({ isMainFocused: () => true });
    expect(notifier.notifySegmentEnd({ mode: 'focus', next: 'short' }, 25 * MIN)).toBe(false);
    expect(made).toHaveLength(0);
  });

  it('is skipped where the OS has no notifications', () => {
    const { notifier, made } = setup({ isSupported: () => false });
    expect(notifier.notifySegmentEnd({ mode: 'focus', next: 'short' }, 25 * MIN)).toBe(false);
    notifier.notifyTrayNotice();
    expect(made).toHaveLength(0);
  });

  it('clicking a notification opens StudyAt', () => {
    const { notifier, made, deps } = setup();
    notifier.notifySegmentEnd({ mode: 'short', next: 'focus' }, 5 * MIN);
    made[0]?.n.fire('click');
    expect(deps.onClick).toHaveBeenCalledTimes(1);
  });

  it('the tray notice uses the spec copy and ignores the segment-end setting', () => {
    const { notifier, made, settings } = setup();
    settings.notifications = false;
    notifier.notifyTrayNotice();
    expect(made[0]?.opts.body).toBe('StudyAt is still running in the tray.');
    expect(TRAY_NOTICE).toBe('StudyAt is still running in the tray.');
  });

  it('announces the end of a countdown with its minutes of focus (spec §3.2)', () => {
    const { notifier, made } = setup();
    expect(notifier.notifySegmentEnd({ mode: 'countdown', next: 'countdown' }, 60 * MIN)).toBe(true);
    expect(made[0]?.opts).toMatchObject({ title: 'Countdown done', body: '60 min of focus.', silent: true });
    expect(COUNTDOWN_DONE_TITLE).toBe('Countdown done');
    notifier.notifySegmentEnd({ mode: 'countdown', next: 'countdown' }, 90 * MIN);
    expect(made[1]?.opts.body).toBe('90 min of focus.');
  });

  it('a countdown end is skipped like any other when notifications are off', () => {
    const { notifier, made, settings } = setup();
    settings.notifications = false;
    expect(notifier.notifySegmentEnd({ mode: 'countdown', next: 'countdown' }, 60 * MIN)).toBe(false);
    expect(made).toHaveLength(0);
  });
});
