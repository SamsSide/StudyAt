// The renderer's one store (Zustand): what main says (timer state, settings, the stats overview,
// subjects) plus what is open on screen. Main owns the timer and every number (appplan §5,
// study-dev rule 4); this store only mirrors it and sends commands through `window.studyat`.
import { create } from 'zustand';
import type { Unsubscribe } from '../../shared/ipc';
import { logIpcError } from '../lib/ipcError';
import type {
  PublicSettings,
  SettingsPatch,
  StatsOverview,
  Subject,
  TimerState,
  WidgetId,
  WidgetPos,
} from '../../shared/types';

export type PanelId = 'spaces' | 'sounds';
export type OverlayId = 'stats' | 'settings' | 'help';

export interface StudyState {
  timer: TimerState;
  overview: StatsOverview | null;
  settings: PublicSettings | null;
  /** Every subject, archived included; loaded on init. */
  subjects: Subject[];
  openPanel: PanelId | null;
  overlay: OverlayId | null;
  fullscreen: boolean;
  /** What this window last asked of the mini timer; main has no event for it. */
  miniShown: boolean;
  /** The dock's Widgets popover (widgets addendum §1). */
  widgetsPopover: boolean;
  /** A Settings section a deep link asked for; the Settings overlay takes it and clears it. */
  settingsSection: string | null;
  /** Settings couldn't be loaded at launch, even after retrying; the shell offers "Try again". */
  settingsFailed: boolean;

  setPanel(panel: PanelId | null): void;
  /** Opens `panel`, or closes it if it is already open. */
  togglePanel(panel: PanelId): void;
  setOverlay(overlay: OverlayId | null): void;
  /** Opens `overlay`, or closes it if it is already on top. Opening one closes the Widgets popover. */
  toggleOverlay(overlay: OverlayId): void;
  /** Opens Settings, on `section` (a section name, e.g. 'Calendar') when given. */
  openSettings(section?: string): void;
  setWidgetsPopover(open: boolean): void;
  toggleWidgetsPopover(): void;
  refreshOverview(): Promise<void>;
  refreshSettings(): Promise<void>;
  refreshSubjects(): Promise<void>;
  /** Loads settings, trying three times with a backoff (on launch and from "Try again"). Never
   *  rejects: if every try fails it sets `settingsFailed`. */
  retrySettings(): Promise<void>;
  /** Sends a patch to main and keeps what main returns (main sanitises and merges). */
  updateSettings(patch: SettingsPatch): Promise<void>;
  /** Changes one widget's open/position, optimistically, then persists it; a failed save is undone. */
  patchWidget(id: WidgetId, patch: Partial<WidgetPos>): Promise<void>;
  toggleWidget(id: WidgetId): Promise<void>;
  toggleMini(): Promise<void>;
}

const MINUTE = 60_000;

/** Shown until `timer.get()` answers; matches main's idle focus state. */
const initialTimer = (): TimerState => ({
  mode: 'focus',
  status: 'idle',
  remainingMs: 25 * MINUTE,
  segmentMs: 25 * MINUTE,
  completedFocusCount: 0,
  subjectId: null,
  pauseReason: null,
  todayFocusMs: 0,
  taskId: null,
  taskText: null,
});

const initialData = () => ({
  timer: initialTimer(),
  overview: null,
  settings: null,
  subjects: [],
  openPanel: null,
  overlay: null,
  fullscreen: false,
  miniShown: false,
  widgetsPopover: false,
  settingsSection: null,
  settingsFailed: false,
});

/** Waits before the second and third tries at loading settings on launch. */
const SETTINGS_RETRY_MS = [400, 1200] as const;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The settings that change what the overview counts (goal, streak day, day boundary, appplan §5). */
const changesOverview = (a: PublicSettings, b: PublicSettings): boolean =>
  a.goalMinutes !== b.goalMinutes || a.streakMinutes !== b.streakMinutes || a.rolloverHour !== b.rolloverHour;

const api = () => window.studyat;

export const useStudyStore = create<StudyState>()((set, get) => ({
  ...initialData(),

  setPanel: (openPanel) => set({ openPanel }),
  togglePanel: (panel) => set((s) => ({ openPanel: s.openPanel === panel ? null : panel })),
  // A full-window overlay covers the dock, so the popover beside it goes.
  setOverlay: (overlay) => set(overlay ? { overlay, widgetsPopover: false } : { overlay }),
  toggleOverlay: (overlay) =>
    set((s) => (s.overlay === overlay ? { overlay: null } : { overlay, widgetsPopover: false })),
  openSettings: (section) =>
    set({ overlay: 'settings', widgetsPopover: false, settingsSection: section ?? null }),
  setWidgetsPopover: (widgetsPopover) => set({ widgetsPopover }),
  toggleWidgetsPopover: () => set((s) => ({ widgetsPopover: !s.widgetsPopover })),

  refreshOverview: async () => set({ overview: await api().stats.overview() }),
  refreshSettings: async () => set({ settings: await api().settings.get() }),
  refreshSubjects: async () => set({ subjects: await api().subjects.list() }),

  retrySettings: async () => {
    set({ settingsFailed: false });
    for (let attempt = 0; ; attempt++) {
      try {
        const settings = await api().settings.get();
        set({ settings, settingsFailed: false });
        return;
      } catch (err) {
        logIpcError('Loading settings failed', err);
        const delay = SETTINGS_RETRY_MS[attempt];
        if (delay === undefined) break;
        await wait(delay);
      }
    }
    // A push from main may have landed meanwhile; only then is there nothing to report.
    if (!get().settings) set({ settingsFailed: true });
  },

  updateSettings: async (patch) => set({ settings: await api().settings.set(patch) }),

  patchWidget: async (id, patch) => {
    const settings = get().settings;
    if (!settings) return;
    const previous = settings.widgets[id];
    const next: WidgetPos = { ...previous, ...patch };
    set({ settings: { ...settings, widgets: { ...settings.widgets, [id]: next } } });
    try {
      await get().updateSettings({ widgets: { [id]: next } });
    } catch (err) {
      // The change didn't stick: show what main has, or failing that put the widget back.
      logIpcError('Saving the widget failed', err);
      try {
        await get().refreshSettings();
      } catch {
        const now = get().settings;
        if (now) set({ settings: { ...now, widgets: { ...now.widgets, [id]: previous } } });
      }
    }
  },

  toggleWidget: async (id) => {
    const open = get().settings?.widgets[id].open ?? false;
    await get().patchWidget(id, { open: !open });
  },

  toggleMini: async () => {
    const show = !get().miniShown;
    set({ miniShown: show });
    await api().app.showMini(show);
  },
}));

/**
 * Loads everything the shell shows and subscribes to main's pushes. The overview is re-fetched
 * when today's focus time crosses a whole minute and at every segment end, so the goal ring
 * follows a running focus without an IPC call per tick, and again whenever the window comes back
 * (focus or visible), so a day that rolled over while it was hidden shows. Returns the unsubscribe.
 */
export function initStudyStore(): Unsubscribe {
  const studyat = api();
  const store = useStudyStore.getState();
  let lastMinute = -1;
  let pushed = false;

  const onState = (timer: TimerState): void => {
    useStudyStore.setState({ timer });
    const minute = Math.floor(timer.todayFocusMs / MINUTE);
    if (lastMinute !== -1 && minute !== lastMinute) refresh();
    lastMinute = minute;
  };

  const stops = [
    studyat.timer.onState((timer) => {
      pushed = true;
      onState(timer);
    }),
    studyat.timer.onSegmentEnd(() => refresh()),
    studyat.app.onFullscreen((fullscreen) => useStudyStore.setState({ fullscreen })),
    // Main pushes every settings write, wherever it came from (a widget, Settings, another window).
    studyat.settings.onChanged((settings) => useStudyStore.setState({ settings, settingsFailed: false })),
    // A new goal, streak threshold or rollover hour changes today's numbers: ask main again,
    // whether the change came from a push or from this window's updateSettings.
    useStudyStore.subscribe((now, before) => {
      if (now.settings && before.settings && changesOverview(now.settings, before.settings)) refresh();
    }),
  ];

  function refresh(): void {
    store.refreshOverview().catch((err: unknown) => logIpcError('Loading the overview failed', err));
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisibility);
  stops.push(
    () => window.removeEventListener('focus', refresh),
    () => document.removeEventListener('visibilitychange', onVisibility),
  );

  // A push that lands first is newer than the answer to get().
  void studyat.timer.get().then((timer) => {
    if (!pushed) onState(timer);
  });
  void store.retrySettings();
  refresh();
  store.refreshSubjects().catch((err: unknown) => logIpcError('Loading subjects failed', err));

  return () => {
    for (const stop of stops) stop();
  };
}

/** Back to the first-launch state; for tests. */
export function resetStudyStore(): void {
  useStudyStore.setState(initialData());
}
