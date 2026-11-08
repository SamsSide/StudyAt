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
  NowPlaying,
  Playlist,
  SegmentEnd,
  Session,
  Settings,
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
  TimerState,
  TrendPoint,
  WeekBars,
  WeeklyRecap,
} from './types';

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

export interface SpacePatch {
  name?: string;
  favourite?: boolean;
  opts?: Partial<SpaceOpts>;
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
  };
  mixes: {
    list(): Promise<Mix[]>;
    save(name: string, levels: Record<string, number>): Promise<Mix[]>;
    remove(id: number): Promise<Mix[]>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
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
  app: {
    toggleFullscreen(): Promise<void>;
    showMini(show: boolean): Promise<void>;
    onFullscreen(cb: (fullscreen: boolean) => void): Unsubscribe;
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
    answerAway: 'timer:answerAway',
  },
  stats: {
    overview: 'stats:overview',
    heatmap: 'stats:heatmap',
    week: 'stats:week',
    trend: 'stats:trend',
    bySubject: 'stats:bySubject',
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
  sounds: { list: 'sounds:list', addFiles: 'sounds:addFiles', remove: 'sounds:remove' },
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
  app: { toggleFullscreen: 'app:toggleFullscreen', showMini: 'app:showMini' },
  events: {
    timerState: 'timer:state',
    timerAway: 'timer:away',
    timerSegmentEnd: 'timer:segmentEnd',
    appFullscreen: 'app:fullscreen',
  },
} as const;

declare global {
  interface Window {
    studyat: StudyAtApi;
  }
}
