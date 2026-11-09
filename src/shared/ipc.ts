// The typed IPC table (spec §3.6). `StudyAtApi` is what the preload exposes as `window.studyat`;
// `CHANNELS` names every channel. Main validates every payload (ids integers, strings <= 500 chars,
// enums checked).
import type {
  AwayPrompt,
  BackupInfo,
  Device,
  HeatmapCell,
  Mix,
  Mode,
  Note,
  NowPlaying,
  Playlist,
  PublicSettings,
  SegmentEnd,
  Session,
  SettingsPatch,
  Sound,
  Space,
  SpaceOpts,
  SpotifyStatus,
  StatsOverview,
  Subject,
  SubjectRange,
  SubjectTotal,
  Task,
  TaskColour,
  TaskTotal,
  TimerState,
  TrendPoint,
  WeekBars,
  WeeklyRecap,
} from './types';
import type { CalendarAgenda, CalendarStatus, Place, WeatherReport } from './widgets';

export type Unsubscribe = () => void;

/** `from` and `to` are inclusive day keys (`YYYY-MM-DD`). */
export interface SessionFilter {
  from?: string;
  to?: string;
  subjectId?: number | null;
}

export interface SubjectPatch {
  name?: string;
  colour?: string;
  sort?: number;
}

export interface TaskPatch {
  text?: string;
  colour?: TaskColour;
  done?: boolean;
}

/** Widgets addendum §4b: text is at most 5000 chars (longer is rejected). */
export interface NotePatch {
  text?: string;
  colour?: TaskColour;
}

export interface SpacePatch {
  name?: string;
  favourite?: boolean;
  opts?: Partial<SpaceOpts>;
  /** A captured video frame (`data:image/jpeg;base64,…`) or a YouTube thumb URL (spec §3.8). */
  thumb?: string | null;
}

export interface StudyAtApi {
  timer: {
    get(): Promise<TimerState>;
    start(): Promise<TimerState>;
    pause(): Promise<TimerState>;
    resume(): Promise<TimerState>;
    reset(): Promise<TimerState>;
    skip(): Promise<TimerState>;
    setMode(mode: Mode): Promise<TimerState>;
    setSubject(subjectId: number | null): Promise<TimerState>;
    /** A task from the list, or `null` for none; main snapshots its text (v1.1 spec §3.3). */
    setTask(taskId: number | null): Promise<TimerState>;
    answerAway(answer: 'keep' | 'discard'): Promise<TimerState>;
    onState(cb: (state: TimerState) => void): Unsubscribe;
    onAwayPrompt(cb: (prompt: AwayPrompt | null) => void): Unsubscribe;
    onSegmentEnd(cb: (end: SegmentEnd) => void): Unsubscribe;
  };
  stats: {
    overview(): Promise<StatsOverview>;
    heatmap(): Promise<HeatmapCell[]>;
    week(weekStart?: string): Promise<WeekBars>;
    trend(): Promise<TrendPoint[]>;
    bySubject(range: SubjectRange): Promise<SubjectTotal[]>;
    /** Top 10 tasks for the range, largest first; untagged rows are left out (v1.1 spec §3.3). */
    byTask(range: SubjectRange): Promise<TaskTotal[]>;
    sessions(filter?: SessionFilter): Promise<Session[]>;
    updateSession(id: number, patch: { subjectId: number | null }): Promise<void>;
    deleteSession(id: number): Promise<void>;
  };
  recaps: {
    list(): Promise<WeeklyRecap[]>;
    pending(): Promise<WeeklyRecap | null>;
    markShown(weekStart: string): Promise<void>;
  };
  subjects: {
    list(): Promise<Subject[]>;
    create(input: { name: string; colour: string }): Promise<Subject[]>;
    update(id: number, patch: SubjectPatch): Promise<Subject[]>;
    archive(id: number): Promise<Subject[]>;
  };
  tasks: {
    list(): Promise<Task[]>;
    create(input: { text: string; colour: TaskColour }): Promise<Task[]>;
    update(id: number, patch: TaskPatch): Promise<Task[]>;
    reorder(ids: number[]): Promise<Task[]>;
    clearDone(): Promise<Task[]>;
  };
  spaces: {
    list(): Promise<Space[]>;
    addFiles(): Promise<Space[]>;
    addYouTube(url: string): Promise<Space[]>;
    update(id: number, patch: SpacePatch): Promise<Space[]>;
    remove(id: number): Promise<Space[]>;
    relocate(id: number): Promise<Space[]>;
    setActive(id: number): Promise<Space[]>;
  };
  sounds: {
    list(): Promise<Sound[]>;
    addFiles(): Promise<Sound[]>;
    remove(id: number): Promise<Sound[]>;
    /** Opens a file dialog and points a moved sound at its new path, keeping its id. */
    relocate(id: number): Promise<Sound[]>;
  };
  mixes: {
    list(): Promise<Mix[]>;
    save(name: string, levels: Record<string, number>): Promise<Mix[]>;
    remove(id: number): Promise<Mix[]>;
  };
  settings: {
    get(): Promise<PublicSettings>;
    set(patch: SettingsPatch): Promise<PublicSettings>;
    /**
     * Main saved settings the renderer can see (settings:set, a weather place, the active space, a
     * chime reset when its sound goes), whoever asked, so every window shows the same values.
     */
    onChanged(cb: (settings: PublicSettings) => void): Unsubscribe;
  };
  data: {
    exportJson(): Promise<boolean>;
    exportCsv(): Promise<boolean>;
    listBackups(): Promise<BackupInfo[]>;
    restoreBackup(name: string): Promise<boolean>;
    openDataFolder(): Promise<void>;
  };
  spotify: {
    status(): Promise<SpotifyStatus>;
    connect(): Promise<SpotifyStatus>;
    disconnect(): Promise<SpotifyStatus>;
    nowPlaying(): Promise<NowPlaying>;
    play(): Promise<void>;
    pause(): Promise<void>;
    next(): Promise<void>;
    previous(): Promise<void>;
    playlists(): Promise<Playlist[]>;
    playContext(uri: string): Promise<void>;
    devices(): Promise<Device[]>;
    transfer(deviceId: string): Promise<void>;
  };
  /** Widgets addendum §3: Open-Meteo, fetched in main. Temperatures are Celsius. */
  weather: {
    /** Up to five places; `q` is 2–100 chars after trimming. Rejects with a readable message offline. */
    searchPlaces(q: string): Promise<Place[]>;
    /** Stores the place (null clears it); a different place drops the cached report. */
    setPlace(place: Place | null): Promise<PublicSettings>;
    /** The cached report if under 30 min old for this place, else a fresh fetch. Never rejects. */
    current(): Promise<WeatherReport>;
  };
  /** Widgets addendum §2: read-only Google Calendar via private iCal addresses, which never come back. */
  calendar: {
    status(): Promise<CalendarStatus>;
    /** At most 5 https addresses of at most 2000 chars; blanks are dropped, [] removes them all. */
    setUrls(urls: string[]): Promise<CalendarStatus>;
    /** The cached agenda if under 15 min old, else a fresh fetch. Never rejects. */
    agenda(): Promise<CalendarAgenda>;
  };
  /** Widgets addendum §4b: sticky notes. Every call returns the whole list. */
  notes: {
    list(): Promise<Note[]>;
    /** An empty note at the end, yellow unless a colour is given. */
    create(input?: { colour?: TaskColour }): Promise<Note[]>;
    /** Rejects for an unknown id or text over 5000 chars. */
    update(id: number, patch: NotePatch): Promise<Note[]>;
    remove(id: number): Promise<Note[]>;
  };
  app: {
    toggleFullscreen(): Promise<void>;
    showMini(show: boolean): Promise<void>;
    onFullscreen(cb: (fullscreen: boolean) => void): Unsubscribe;
    /** The mini timer window was shown (true) or hidden (false), whatever the cause (spec §3.7). */
    onMini(cb: (shown: boolean) => void): Unsubscribe;
    /** The main window became visible (shown, restored) or not (hidden to the tray, minimised). */
    onVisibility(cb: (visible: boolean) => void): Unsubscribe;
    /**
     * Quitting (or Windows signing out) asks every window to save what it still holds, such as
     * note text, before the database closes. Each callback may return a promise; once all have
     * settled the preload acks with `flushed()` itself. Main waits about 1 s at most.
     */
    onFlush(cb: () => Promise<void> | void): Unsubscribe;
    /** The ack of an `app:flush`; sent by the preload, so the renderer never needs to call it. */
    flushed(): Promise<void>;
  };
}

/**
 * Channel names, `'<group>:<method>'`. Request channels go through `ipcRenderer.invoke`; `events`
 * are main-to-renderer pushes (`webContents.send`) behind the `on*` subscriptions.
 */
export const CHANNELS = {
  timer: {
    get: 'timer:get',
    start: 'timer:start',
    pause: 'timer:pause',
    resume: 'timer:resume',
    reset: 'timer:reset',
    skip: 'timer:skip',
    setMode: 'timer:setMode',
    setSubject: 'timer:setSubject',
    setTask: 'timer:setTask',
    answerAway: 'timer:answerAway',
  },
  stats: {
    overview: 'stats:overview',
    heatmap: 'stats:heatmap',
    week: 'stats:week',
    trend: 'stats:trend',
    bySubject: 'stats:bySubject',
    byTask: 'stats:byTask',
    sessions: 'stats:sessions',
    updateSession: 'stats:updateSession',
    deleteSession: 'stats:deleteSession',
  },
  recaps: { list: 'recaps:list', pending: 'recaps:pending', markShown: 'recaps:markShown' },
  subjects: {
    list: 'subjects:list',
    create: 'subjects:create',
    update: 'subjects:update',
    archive: 'subjects:archive',
  },
  tasks: {
    list: 'tasks:list',
    create: 'tasks:create',
    update: 'tasks:update',
    reorder: 'tasks:reorder',
    clearDone: 'tasks:clearDone',
  },
  spaces: {
    list: 'spaces:list',
    addFiles: 'spaces:addFiles',
    addYouTube: 'spaces:addYouTube',
    update: 'spaces:update',
    remove: 'spaces:remove',
    relocate: 'spaces:relocate',
    setActive: 'spaces:setActive',
  },
  sounds: {
    list: 'sounds:list',
    addFiles: 'sounds:addFiles',
    remove: 'sounds:remove',
    relocate: 'sounds:relocate',
  },
  mixes: { list: 'mixes:list', save: 'mixes:save', remove: 'mixes:remove' },
  settings: { get: 'settings:get', set: 'settings:set' },
  data: {
    exportJson: 'data:exportJson',
    exportCsv: 'data:exportCsv',
    listBackups: 'data:listBackups',
    restoreBackup: 'data:restoreBackup',
    openDataFolder: 'data:openDataFolder',
  },
  spotify: {
    status: 'spotify:status',
    connect: 'spotify:connect',
    disconnect: 'spotify:disconnect',
    nowPlaying: 'spotify:nowPlaying',
    play: 'spotify:play',
    pause: 'spotify:pause',
    next: 'spotify:next',
    previous: 'spotify:previous',
    playlists: 'spotify:playlists',
    playContext: 'spotify:playContext',
    devices: 'spotify:devices',
    transfer: 'spotify:transfer',
  },
  weather: { searchPlaces: 'weather:searchPlaces', setPlace: 'weather:setPlace', current: 'weather:current' },
  calendar: { status: 'calendar:status', setUrls: 'calendar:setUrls', agenda: 'calendar:agenda' },
  notes: { list: 'notes:list', create: 'notes:create', update: 'notes:update', remove: 'notes:remove' },
  app: { toggleFullscreen: 'app:toggleFullscreen', showMini: 'app:showMini', flushed: 'app:flushed' },
  events: {
    timerState: 'timer:state',
    timerAway: 'timer:away',
    timerSegmentEnd: 'timer:segmentEnd',
    appFullscreen: 'app:fullscreen',
    appMini: 'app:mini',
    appVisibility: 'app:visibility',
    appFlush: 'app:flush',
    settingsChanged: 'settings:changed',
  },
} as const;

declare global {
  interface Window {
    studyat: StudyAtApi;
  }
}
