// Shared data types: the contract between main, preload and renderer (spec §3.3, §3.5, §3.6, §3.10, §3.11).

export type Mode = 'focus' | 'short' | 'long';
export type TimerStatus = 'idle' | 'running' | 'paused';
export type PauseReason = 'user' | 'suspend' | 'lock' | null;

export interface TimerState {
  mode: Mode;
  status: TimerStatus;
  remainingMs: number;
  segmentMs: number;
  completedFocusCount: number;
  subjectId: number | null;
  pauseReason: PauseReason;
  todayFocusMs: number;
}

export interface AwayPrompt {
  awayMs: number;
  deadline: number;
}

export interface SegmentEnd {
  mode: Mode;
  next: Mode;
}

export interface Subject {
  id: number;
  name: string;
  colour: string;
  archived: boolean;
  sort: number;
}

export interface Session {
  id: number;
  pomodoroId: string;
  subjectId: number | null;
  startedAt: number;
  endedAt: number | null;
  checkpointAt: number;
  focusMs: number;
  discardedMs: number;
  dayKey: string;
  status: 'running' | 'done';
}

export type TaskColour = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'grey';

/** A sticky note in the Notes widget (widgets addendum §4b). */
export interface Note {
  id: number;
  text: string;
  colour: TaskColour;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: number;
  text: string;
  colour: TaskColour;
  done: boolean;
  sort: number;
  createdAt: number;
  doneAt: number | null;
}

export interface SpaceOpts {
  audio: boolean;
  volume: number;
  speed: number;
  dim: number;
  blur: number;
}

export interface Space {
  id: number;
  kind: 'video' | 'image' | 'youtube';
  name: string;
  source: string;
  thumb: string | null;
  favourite: boolean;
  builtin: boolean;
  opts: SpaceOpts;
  createdAt: number;
  missing: boolean;
}

export interface Sound {
  id: number;
  name: string;
  kind: 'noise' | 'file';
  source: string;
  builtin: boolean;
  sort: number;
  missing: boolean;
}

export interface Mix {
  id: number;
  name: string;
  levels: Record<string, number>;
}

export interface DayTotal {
  dayKey: string;
  ms: number;
  bySubject: Record<string, number>;
}

export interface StatsOverview {
  todayMs: number;
  weekMs: number;
  lastWeekMs: number;
  weekDeltaPct: number | null;
  currentStreak: number;
  longestStreak: number;
  allTimeMs: number;
  goalMs: number;
  goalProgress: number;
}

export interface HeatmapCell {
  dayKey: string;
  ms: number;
  shade: 0 | 1 | 2 | 3 | 4;
  goalHit: boolean;
  streakDay: boolean;
}

/** `days` has 7 entries, Monday to Sunday. */
export interface WeekBars {
  weekStart: string;
  days: DayTotal[];
}

export interface TrendPoint {
  weekStart: string;
  ms: number;
}

export interface SubjectTotal {
  subjectId: number | null;
  name: string;
  colour: string;
  ms: number;
}

export type SubjectRange = 'week' | 'month' | 'all';

export interface WeeklyRecap {
  weekStart: string;
  totalMs: number;
  prevTotalMs: number;
  daysStudied: number;
  bestDay: { dayKey: string; ms: number } | null;
  topSubjects: { subjectId: number | null; name: string; ms: number }[];
  longestSessionMs: number;
  streakAtEnd: number;
  goalDaysHit: number;
}

/**
 * A built-in chime, or `file:<soundId>`: the id of a registered `sounds` row. The media protocol
 * serves only DB-registered ids (spec §3.2), so a path is never a chime id.
 */
export type ChimeId = 'bell' | 'bowl' | 'woodblock' | 'marimba' | 'digital' | `file:${number}`;

/** x and y are fractions of the window (0..1). */
export interface WidgetPos {
  open: boolean;
  x: number;
  y: number;
  autoHide: boolean;
}

export type WidgetId = 'timer' | 'tasks' | 'spotify';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every key of spec §3.11, plus the two window positions main remembers. */
export interface Settings {
  focusMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longEvery: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  chimeFocusEnd: ChimeId;
  chimeBreakEnd: ChimeId;
  chimeVolume: number;
  chimeRepeat: number;
  tickLastMinute: boolean;
  chimeOnStart: boolean;
  notifications: boolean;
  streakMinutes: number;
  goalMinutes: number;
  rolloverHour: number;
  idleMinutes: number;
  autoHideSeconds: number;
  miniWhenHidden: boolean;
  globalHotkey: string;
  launchAtStartup: boolean;
  /** null until the seed picks the first built-in space. */
  activeSpaceId: number | null;
  soundLevels: Record<string, number>;
  masterVolume: number;
  widgets: Record<WidgetId, WidgetPos>;
  spotifyClientId: string;
  /** safeStorage-encrypted blob (base64); never sent to the renderer in the clear. */
  spotifyTokens: string | null;
  onboarded: boolean;
  trayNoticeShown: boolean;
  windowBounds: WindowBounds | null;
  miniPos: { x: number; y: number } | null;
}

/** What the renderer sees: tokens are main-owned (spec §3.10, study-dev rule 9) and never cross the bridge. */
export type PublicSettings = Omit<Settings, 'spotifyTokens'>;

/**
 * A renderer settings patch: any public key except `activeSpaceId` (only `spaces:setActive`
 * changes it), and `widgets` may name just some widgets.
 */
export type SettingsPatch = Partial<Omit<Settings, 'widgets' | 'spotifyTokens' | 'activeSpaceId'>> & {
  widgets?: Partial<Record<WidgetId, WidgetPos>>;
};

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
}

export interface NowPlaying {
  state: 'unconfigured' | 'disconnected' | 'no-device' | 'offline' | 'idle' | 'playing' | 'paused';
  track?: { title: string; artist: string; artUrl: string | null; progressMs: number; durationMs: number };
  device?: string;
}

export interface Playlist {
  id: string;
  name: string;
  uri: string;
  imageUrl: string | null;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}
