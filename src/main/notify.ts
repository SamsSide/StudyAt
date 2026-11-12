// Desktop notifications (spec §3.7, §3.11): a segment end, when `settings.notifications` is on, a
// task reminder (v1.2 spec §3.6), and the one-time tray notice. They are silent: the chime is the sound (spec §3.9), so a toast never
// doubles it. Electron's `Notification` is injected so this runs under a unit test.
import { reminderTitle } from '../core/planner/reminders';
import type { SegmentEnd, Settings } from '../shared/types';

export const FOCUS_DONE = 'Focus done — time for a break.';
export const BREAK_DONE = 'Break over — ready to focus?';
export const TRAY_NOTICE = 'StudyAt is still running in the tray.';
/** A Countdown end (spec §3.2): this title, and the body from `countdownBody`. */
export const COUNTDOWN_DONE_TITLE = 'Countdown done';
const countdownBody = (minutes: number): string => `${minutes} min of focus.`;

export interface NotificationLike {
  on(event: 'click' | 'close', listener: () => void): void;
  show(): void;
}

export interface NotifyDeps {
  create(opts: { title: string; body: string; icon: string; silent: boolean }): NotificationLike;
  isSupported(): boolean;
  /** The app icon (`assets/icons/icon.png`). */
  icon: string;
  settings(): Pick<Settings, 'notifications'>;
  /** True while Sam is looking at StudyAt: the widget already says the segment ended. */
  isMainFocused(): boolean;
  /** A click on any notification brings StudyAt forward. */
  onClick(): void;
  /** A click on a reminder then opens its task (v1.2 spec §3.6). */
  onOpenTask?(taskId: number): void;
}

export function createNotifier(deps: NotifyDeps) {
  // Electron drops a notification's click handler once the object is collected; hold each one
  // until it is clicked or closed.
  const live = new Set<NotificationLike>();

  const show = (body: string, title = 'StudyAt', taskId?: number): boolean => {
    if (!deps.isSupported()) return false;
    const n = deps.create({ title, body, icon: deps.icon, silent: true });
    live.add(n);
    n.on('click', () => {
      live.delete(n);
      deps.onClick();
      if (taskId !== undefined) deps.onOpenTask?.(taskId);
    });
    n.on('close', () => live.delete(n));
    n.show();
    return true;
  };

  return {
    /**
     * Spec §3.11 `notifications`; true when a notification was shown. `segmentMs` is the length of
     * the segment that ended, which a Countdown reports as its minutes of focus.
     */
    notifySegmentEnd(e: SegmentEnd, segmentMs: number): boolean {
      if (!deps.settings().notifications || deps.isMainFocused()) return false;
      if (e.mode === 'countdown') return show(countdownBody(Math.round(segmentMs / 60_000)), COUNTDOWN_DONE_TITLE);
      return show(e.mode === 'focus' ? FOCUS_DONE : BREAK_DONE);
    },
    /**
     * v1.2 spec §3.6: "Reminder · <title>", following `notifications`. Shown while StudyAt is
     * focused too: nothing else on screen says the time came. True when shown.
     */
    notifyReminder(taskId: number, title: string): boolean {
      if (!deps.settings().notifications) return false;
      return show('', reminderTitle(title), taskId);
    },
    /**
     * The first close to the tray (spec §3.7, §3.14). Shown whatever `notifications` says: it is
     * the one hint of where the window went.
     */
    notifyTrayNotice(): void {
      show(TRAY_NOTICE);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
