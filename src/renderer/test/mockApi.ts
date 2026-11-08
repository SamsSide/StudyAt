// A complete in-memory `window.studyat` for UI tests: every method is a vi.fn resolving a sensible
// default, and the emit* helpers drive the event subscriptions.
import { vi } from 'vitest';
import type { StudyAtApi, Unsubscribe } from '../../shared/ipc';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { SEED_SUBJECTS } from '../../shared/subjects';
import type {
  AwayPrompt,
  NowPlaying,
  SegmentEnd,
  StatsOverview,
  Subject,
  TimerState,
  WeekBars,
} from '../../shared/types';

export type MockApi = StudyAtApi & {
  emitState(s: TimerState): void;
  emitAway(p: AwayPrompt | null): void;
  emitSegmentEnd(e: SegmentEnd): void;
  emitFullscreen(on: boolean): void;
};

const MINUTE = 60_000;

export const idleTimerState = (): TimerState => ({
  mode: 'focus',
  status: 'idle',
  remainingMs: 25 * MINUTE,
  segmentMs: 25 * MINUTE,
  completedFocusCount: 0,
  subjectId: null,
  pauseReason: null,
  todayFocusMs: 0,
});

export const seedSubjects = (): Subject[] =>
  SEED_SUBJECTS.map((s, i) => ({ id: i + 1, name: s.name, colour: s.colour, archived: false, sort: i }));

const emptyOverview = (): StatsOverview => ({
  todayMs: 0,
  weekMs: 0,
  lastWeekMs: 0,
  weekDeltaPct: null,
  currentStreak: 0,
  longestStreak: 0,
  allTimeMs: 0,
  goalMs: DEFAULT_SETTINGS.goalMinutes * MINUTE,
  goalProgress: 0,
});

const emptyWeek = (): WeekBars => ({ weekStart: '1970-01-05', days: [] });

const emptyPlaying = (): NowPlaying => ({ state: 'unconfigured' });

/** Subscribe helper: returns the subscribe fn for the API and a way to fire it. */
function channel<T>() {
  const listeners = new Set<(v: T) => void>();
  return {
    subscribe: (cb: (v: T) => void): Unsubscribe => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    emit: (v: T): void => {
      for (const cb of [...listeners]) cb(v);
    },
  };
}

type Overrides = { [G in keyof StudyAtApi]?: Partial<StudyAtApi[G]> };

export function mockApi(overrides: Overrides = {}): MockApi {
  const state = channel<TimerState>();
  const away = channel<AwayPrompt | null>();
  const segmentEnd = channel<SegmentEnd>();
  const fullscreen = channel<boolean>();
  const timer = (): Promise<TimerState> => Promise.resolve(idleTimerState());
  const resolves = <T>(value: T) => vi.fn(() => Promise.resolve(value));

  const base: StudyAtApi = {
    timer: {
      get: vi.fn(timer),
      start: vi.fn(timer),
      pause: vi.fn(timer),
      resume: vi.fn(timer),
      reset: vi.fn(timer),
      skip: vi.fn(timer),
      setMode: vi.fn(timer),
      setSubject: vi.fn(timer),
      answerAway: vi.fn(timer),
      onState: vi.fn(state.subscribe),
      onAwayPrompt: vi.fn(away.subscribe),
      onSegmentEnd: vi.fn(segmentEnd.subscribe),
    },
    stats: {
      overview: resolves(emptyOverview()),
      heatmap: resolves([]),
      week: resolves(emptyWeek()),
      trend: resolves([]),
      bySubject: resolves([]),
      sessions: resolves([]),
      updateSession: resolves(undefined),
      deleteSession: resolves(undefined),
    },
    recaps: {
      list: resolves([]),
      pending: resolves(null),
      markShown: resolves(undefined),
    },
    subjects: {
      list: vi.fn(() => Promise.resolve(seedSubjects())),
      create: vi.fn(() => Promise.resolve(seedSubjects())),
      update: vi.fn(() => Promise.resolve(seedSubjects())),
      archive: vi.fn(() => Promise.resolve(seedSubjects())),
    },
    tasks: {
      list: resolves([]),
      create: resolves([]),
      update: resolves([]),
      reorder: resolves([]),
      clearDone: resolves([]),
    },
    spaces: {
      list: resolves([]),
      addFiles: resolves([]),
      addYouTube: resolves([]),
      update: resolves([]),
      remove: resolves([]),
      relocate: resolves([]),
      setActive: resolves([]),
    },
    sounds: {
      list: resolves([]),
      addFiles: resolves([]),
      remove: resolves([]),
    },
    mixes: {
      list: resolves([]),
      save: resolves([]),
      remove: resolves([]),
    },
    settings: {
      get: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_SETTINGS))),
      set: vi.fn((patch) => Promise.resolve({ ...structuredClone(DEFAULT_SETTINGS), ...patch })),
    },
    data: {
      exportJson: resolves(true),
      exportCsv: resolves(true),
      listBackups: resolves([]),
      restoreBackup: resolves(true),
      openDataFolder: resolves(undefined),
    },
    spotify: {
      status: resolves({ configured: false, connected: false }),
      connect: resolves({ configured: false, connected: false }),
      disconnect: resolves({ configured: false, connected: false }),
      nowPlaying: resolves(emptyPlaying()),
      play: resolves(undefined),
      pause: resolves(undefined),
      next: resolves(undefined),
      previous: resolves(undefined),
      playlists: resolves([]),
      playContext: resolves(undefined),
      devices: resolves([]),
      transfer: resolves(undefined),
    },
    app: {
      toggleFullscreen: resolves(undefined),
      showMini: resolves(undefined),
      onFullscreen: vi.fn(fullscreen.subscribe),
    },
  };

  const api: StudyAtApi = {
    timer: { ...base.timer, ...overrides.timer },
    stats: { ...base.stats, ...overrides.stats },
    recaps: { ...base.recaps, ...overrides.recaps },
    subjects: { ...base.subjects, ...overrides.subjects },
    tasks: { ...base.tasks, ...overrides.tasks },
    spaces: { ...base.spaces, ...overrides.spaces },
    sounds: { ...base.sounds, ...overrides.sounds },
    mixes: { ...base.mixes, ...overrides.mixes },
    settings: { ...base.settings, ...overrides.settings },
    data: { ...base.data, ...overrides.data },
    spotify: { ...base.spotify, ...overrides.spotify },
    app: { ...base.app, ...overrides.app },
  };

  return Object.assign(api, {
    emitState: state.emit,
    emitAway: away.emit,
    emitSegmentEnd: segmentEnd.emit,
    emitFullscreen: fullscreen.emit,
  });
}

/** Makes `api` the `window.studyat` the component under test sees. */
export function installMockApi(api: StudyAtApi): void {
  window.studyat = api;
}
