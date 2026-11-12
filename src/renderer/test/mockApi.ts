// A complete in-memory `window.studyat` for UI tests: every method is a vi.fn resolving a sensible
// default, and the emit* helpers drive the event subscriptions.
import { vi } from 'vitest';
import type { StudyAtApi, Unsubscribe } from '../../shared/ipc';
import { DEFAULT_SETTINGS, mergeSettings } from '../../shared/settings';
import { SEED_SUBJECTS } from '../../shared/subjects';
import type { CalendarAgenda, CalendarStatus, WeatherReport } from '../../shared/widgets';
import type {
  AwayPrompt,
  CardData,
  DeadlinesView,
  ListsView,
  NowPlaying,
  PlannerRange,
  PlannerTask,
  PublicSettings,
  SegmentEnd,
  Settings,
  SettingsPatch,
  StatCard,
  StatRange,
  StatsOverview,
  StatWidget,
  Subject,
  TimerState,
  WeekBars,
} from '../../shared/types';

export type MockApi = StudyAtApi & {
  emitState(s: TimerState): void;
  emitAway(p: AwayPrompt | null): void;
  emitSegmentEnd(e: SegmentEnd): void;
  emitFullscreen(on: boolean): void;
  emitMini(shown: boolean): void;
  emitVisibility(visible: boolean): void;
  emitSettings(settings: PublicSettings): void;
  /** As the preload does on `app:flush`: runs every `app.onFlush` callback and awaits them. */
  emitFlush(): Promise<void>;
  /** As main does when a reminder is clicked: runs every `planner.onOpenTask` callback. */
  emitOpenTask(taskId: number): void;
  /** As main does when it changes tasks itself: runs every `planner.onChanged` callback. */
  emitPlannerChanged(): void;
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
  taskId: null,
  taskText: null,
  intention: null,
  askOutcome: null,
});

export const seedSubjects = (): Subject[] =>
  SEED_SUBJECTS.map((s, i) => ({ id: i + 1, name: s.name, colour: s.colour, archived: false, sort: i }));

/** A card with nothing in it, of the kind and range asked for. */
const emptyCard = (card: StatCard, range: StatRange): CardData => {
  switch (card) {
    case 'total':
      return { card, range, totalMs: 0, previousMs: 0, deltaPct: null, todayMs: 0 };
    case 'subjects':
      return { card, range, bars: [] };
    case 'goal':
      return { card, range, goalMs: 0, todayMs: 0, days: [], hitDays: 0, elapsedDays: 0, streak: 0 };
    case 'estimates':
      return { card, range, tasks: 0, plannedMs: 0, focusedMs: 0, ratio: null, overruns: [], bySubject: [] };
  }
};

const emptyDeadlines = (): DeadlinesView => ({ upcoming: [], past: [] });

/** A Total time · This week widget at the first cascade step. */
const defaultStatWidget = (): StatWidget => ({
  id: 1,
  card: 'total',
  range: 'week',
  x: 0.5,
  y: 0.3,
  scale: 1,
  bare: false,
});

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

/** Seven zero days, Monday 1970-01-05 .. Sunday 1970-01-11, as WeekBars promises. */
const emptyWeek = (): WeekBars => ({
  weekStart: '1970-01-05',
  days: Array.from({ length: 7 }, (_, i) => ({
    dayKey: `1970-01-${String(5 + i).padStart(2, '0')}`,
    ms: 0,
    bySubject: {},
  })),
});

/** Drops the main-only keys, as the real settings channel does. */
function publicSettings(s: Settings): PublicSettings {
  const {
    spotifyTokens: _tokens,
    calendarUrls: _urls,
    calendarCache: _agenda,
    weatherCache: _weather,
    ...rest
  } = structuredClone(s);
  return rest;
}

const emptyRange = (from: string, to: string): PlannerRange => ({
  from,
  to,
  tasks: [],
  deadlines: [],
  studiedMs: {},
});
const emptyLists = (): ListsView => ({ lists: [], tasks: [], deadlines: [] });

/** The smallest valid planner task, a day task with nothing set. */
export const minimalPlannerTask = (over: Partial<PlannerTask> = {}): PlannerTask => ({
  id: 1,
  title: 'Task',
  note: '',
  done: false,
  doneAt: null,
  colour: null,
  day: '1970-01-05',
  listId: null,
  subjectId: null,
  effectiveSubjectId: null,
  estimateMin: null,
  tags: [],
  subtasks: [],
  repeat: null,
  reminder: null,
  kind: 'task',
  originTaskId: null,
  rolledFrom: null,
  sort: 0,
  createdAt: 0,
  updatedAt: 0,
  actualMs: 0,
  ...over,
});

const emptyPlaying = (): NowPlaying => ({ state: 'unconfigured' });
const noWeather = (): WeatherReport => ({ state: 'unconfigured', place: null, fetchedAt: null });
const noCalendar = (): CalendarStatus => ({ configured: false, calendars: [] });
const noAgenda = (): CalendarAgenda => ({ state: 'unconfigured', fetchedAt: null, events: [] });

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
  const mini = channel<boolean>();
  const visibility = channel<boolean>();
  const settingsChanged = channel<PublicSettings>();
  const openTask = channel<number>();
  const plannerChanged = channel<undefined>();
  const flushers = new Set<() => Promise<void> | void>();
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
      setTask: vi.fn(timer),
      startTask: vi.fn(timer),
      setIntention: vi.fn(timer),
      setOutcome: vi.fn(timer),
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
      byTask: resolves([]),
      card: vi.fn((card: StatCard, range: StatRange) => Promise.resolve(emptyCard(card, range))),
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
    planner: {
      week: vi.fn((day: string) => Promise.resolve(emptyRange(day, day))),
      month: vi.fn((month: string) => Promise.resolve(emptyRange(`${month}-01`, `${month}-01`))),
      day: vi.fn((day: string) => Promise.resolve(emptyRange(day, day))),
      lists: vi.fn(() => Promise.resolve(emptyLists())),
      task: vi.fn(() => Promise.resolve(null)),
      onOpenTask: vi.fn(openTask.subscribe),
      onChanged: vi.fn((cb: () => void) => plannerChanged.subscribe(() => cb())),
    },
    tasks: {
      create: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
      update: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
      move: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
      remove: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
      duplicate: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
      scheduleRevision: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
    },
    subtasks: {
      add: vi.fn(() => Promise.resolve(minimalPlannerTask())),
      update: vi.fn(() => Promise.resolve(minimalPlannerTask())),
      remove: vi.fn(() => Promise.resolve(minimalPlannerTask())),
      reorder: vi.fn(() => Promise.resolve(minimalPlannerTask())),
    },
    lists: {
      create: resolves([]),
      update: resolves([]),
      reorder: resolves([]),
      remove: vi.fn(() => Promise.resolve({ lists: [], removed: [] })),
      clearDone: vi.fn(() => Promise.resolve({ tasks: [], removed: [] })),
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
    images: {
      list: resolves([]),
      addFile: resolves({ error: '' }),
      addUrl: resolves({ error: '' }),
      update: resolves(null),
      remove: resolves(undefined),
    },
    sounds: {
      list: resolves([]),
      addFiles: resolves([]),
      remove: resolves([]),
      relocate: resolves([]),
    },
    mixes: {
      list: resolves([]),
      save: resolves([]),
      remove: resolves([]),
    },
    settings: {
      get: vi.fn(() => Promise.resolve(publicSettings(DEFAULT_SETTINGS))),
      set: vi.fn((patch: SettingsPatch) =>
        Promise.resolve(publicSettings(mergeSettings(structuredClone(DEFAULT_SETTINGS), patch))),
      ),
      onChanged: vi.fn(settingsChanged.subscribe),
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
    weather: {
      searchPlaces: resolves([]),
      setPlace: vi.fn(() => Promise.resolve(publicSettings(DEFAULT_SETTINGS))),
      current: vi.fn(() => Promise.resolve(noWeather())),
    },
    calendar: {
      status: vi.fn(() => Promise.resolve(noCalendar())),
      setUrls: vi.fn(() => Promise.resolve(noCalendar())),
      agenda: vi.fn(() => Promise.resolve(noAgenda())),
    },
    notes: {
      list: resolves([]),
      create: resolves([]),
      update: resolves([]),
      remove: resolves([]),
      popOut: resolves([]),
      dockBack: resolves([]),
    },
    deadlines: {
      list: resolves([]),
      create: vi.fn(() => Promise.resolve(emptyDeadlines())),
      update: vi.fn(() => Promise.resolve(emptyDeadlines())),
      remove: vi.fn(() => Promise.resolve(emptyDeadlines())),
    },
    statWidgets: {
      list: resolves([]),
      add: vi.fn(() => Promise.resolve(defaultStatWidget())),
      update: resolves(null),
      remove: resolves(undefined),
    },
    app: {
      toggleFullscreen: resolves(undefined),
      showMini: resolves(undefined),
      onFullscreen: vi.fn(fullscreen.subscribe),
      onMini: vi.fn(mini.subscribe),
      onVisibility: vi.fn(visibility.subscribe),
      onFlush: vi.fn((cb: () => Promise<void> | void): Unsubscribe => {
        flushers.add(cb);
        return () => flushers.delete(cb);
      }),
      flushed: resolves(undefined),
    },
  };

  const api: StudyAtApi = {
    timer: { ...base.timer, ...overrides.timer },
    stats: { ...base.stats, ...overrides.stats },
    recaps: { ...base.recaps, ...overrides.recaps },
    subjects: { ...base.subjects, ...overrides.subjects },
    planner: { ...base.planner, ...overrides.planner },
    tasks: { ...base.tasks, ...overrides.tasks },
    subtasks: { ...base.subtasks, ...overrides.subtasks },
    lists: { ...base.lists, ...overrides.lists },
    spaces: { ...base.spaces, ...overrides.spaces },
    images: { ...base.images, ...overrides.images },
    sounds: { ...base.sounds, ...overrides.sounds },
    mixes: { ...base.mixes, ...overrides.mixes },
    settings: { ...base.settings, ...overrides.settings },
    data: { ...base.data, ...overrides.data },
    spotify: { ...base.spotify, ...overrides.spotify },
    weather: { ...base.weather, ...overrides.weather },
    calendar: { ...base.calendar, ...overrides.calendar },
    notes: { ...base.notes, ...overrides.notes },
    deadlines: { ...base.deadlines, ...overrides.deadlines },
    statWidgets: { ...base.statWidgets, ...overrides.statWidgets },
    app: { ...base.app, ...overrides.app },
  };

  return Object.assign(api, {
    emitState: state.emit,
    emitAway: away.emit,
    emitSegmentEnd: segmentEnd.emit,
    emitFullscreen: fullscreen.emit,
    emitMini: mini.emit,
    emitVisibility: visibility.emit,
    emitSettings: settingsChanged.emit,
    emitOpenTask: openTask.emit,
    emitPlannerChanged: (): void => plannerChanged.emit(undefined),
    emitFlush: async (): Promise<void> => {
      await Promise.allSettled([...flushers].map((cb) => Promise.resolve().then(cb)));
    },
  });
}

/** Makes `api` the `window.studyat` the component under test sees. */
export function installMockApi(api: StudyAtApi): void {
  window.studyat = api;
}
