// Desktop notifications (spec §3.7, §3.11): a segment end, when `settings.notifications` is on, and
// the one-time tray notice. They are silent: the chime is the sound (spec §3.9), so a toast never
// doubles it. Electron's `Notification` is injected so this runs under a unit test.
import type { SegmentEnd, Settings } from '../shared/types';

export const FOCUS_DONE = 'Focus done — time for a break.';
export const BREAK_DONE = 'Break over — ready to focus?';
export const TRAY_NOTICE = 'StudyAt is still running in the tray.';

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
}

export function createNotifier(deps: NotifyDeps) {
  // Electron drops a notification's click handler once the object is collected; hold each one
  // until it is clicked or closed.
  const live = new Set<NotificationLike>();

  const show = (body: string): boolean => {
    if (!deps.isSupported()) return false;
    const n = deps.create({ title: 'StudyAt', body, icon: deps.icon, silent: true });
    live.add(n);
    n.on('click', () => {
      live.delete(n);
      deps.onClick();
    });
    n.on('close', () => live.delete(n));
    n.show();
    return true;
  };

  return {
    /** Spec §3.11 `notifications`; true when a notification was shown. */
    notifySegmentEnd(e: SegmentEnd): boolean {
      if (!deps.settings().notifications || deps.isMainFocused()) return false;
      return show(e.mode === 'focus' ? FOCUS_DONE : BREAK_DONE);
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
