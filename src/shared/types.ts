// Shared data types: the contract between main, preload and renderer (spec §3.3, §3.5, §3.6, §3.10, §3.11).
import type { CalendarAgenda, Place, WeatherReport } from './widgets';

export type Mode = 'focus' | 'short' | 'long' | 'countdown';
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
  taskId: number | null;
  taskText: string | null;
  intention: string | null;
  askOutcome: OutcomeAsk | null;
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
  taskId: number | null;
  taskText: string | null;
  intention: string | null;
  outcome: SessionOutcome | null;
}

export type SessionOutcome = 'done' | 'partly' | 'not';
/** The focus segment that just ended and its intention, until answered or the next focus starts. */
export interface OutcomeAsk {
  pomodoroId: string;
  intention: string;
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
  popped: boolean;
  x: number | null;
  y: number | null;
  scale: number;
  bare: boolean;
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

export type RepeatRule =
  { kind: 'daily' } | { kind: 'weekdays' } | { kind: 'weekly' } | { kind: 'every'; days: number };
export type TaskKind = 'task' | 'revision';
export interface Subtask {
  id: number;
  taskId: number;
  text: string;
  done: boolean;
  sort: number;
}
export interface PlannerTask {
  id: number;
  title: string;
  note: string;
  done: boolean;
  doneAt: number | null;
  colour: TaskColour | null;
  /** Study-day key, or null when the task is in a list. Exactly one of day / listId is set. */
  day: string | null;
  listId: number | null;
  subjectId: number | null;
  /** Its own subject, else its list's subject (spec §3.6). */
  effectiveSubjectId: number | null;
  estimateMin: number | null;
  tags: string[];
  subtasks: Subtask[];
  repeat: RepeatRule | null;
  reminder: string | null;
  kind: TaskKind;
  originTaskId: number | null;
  rolledFrom: string | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
  /** Focus ms of sessions with this task id, the running row live (spec §3.8). */
  actualMs: number;
}
export interface TaskList {
  id: number;
  name: string;
  subjectId: number | null;
  sort: number;
  createdAt: number;
}
export type DeadlineKind = 'exam' | 'coursework';
export interface Deadline {
  id: number;
  title: string;
  kind: DeadlineKind;
  subjectId: number | null;
  /** Local wall clock `YYYY-MM-DDTHH:MM`. */
  due: string;
  note: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}
/** A planner query: the tasks dated `from..to` (inclusive), deadlines due those days, focus per day. */
export interface PlannerRange {
  from: string;
  to: string;
  tasks: PlannerTask[];
  deadlines: Deadline[];
  studiedMs: Record<string, number>;
}
export interface ListsView {
  lists: TaskList[];
  tasks: PlannerTask[];
  deadlines: Deadline[];
}
/** Every task a write created or changed (full), and the ids it removed. */
export interface TaskChange {
  tasks: PlannerTask[];
  removed: number[];
}
export interface ListsChange {
  lists: TaskList[];
  removed: number[];
}
export interface DeadlinesView {
  upcoming: Deadline[];
  past: Deadline[];
}
/** Write inputs (validated in main by Tasks 14-15, applied by Tasks 11-12). */
export interface TaskInput {
  title: string;
  day?: string;
  listId?: number;
  subjectId?: number | null;
  estimateMin?: number | null;
  tags?: string[];
  note?: string;
  colour?: TaskColour | null;
}
export interface TaskUpdate {
  title?: string;
  note?: string;
  done?: boolean;
  colour?: TaskColour | null;
  subjectId?: number | null;
  estimateMin?: number | null;
  tags?: string[];
  repeat?: RepeatRule | null;
  reminder?: string | null;
}
export type TaskMove = { day: string; index: number } | { listId: number; index: number };
export interface ListInput {
  name: string;
  subjectId?: number | null;
}
export interface ListPatch {
  name?: string;
  subjectId?: number | null;
}
export interface DeadlineInput {
  title: string;
  kind: DeadlineKind;
  subjectId: number | null;
  due: string;
  note?: string;
}
export interface DeadlinePatch {
  title?: string;
  kind?: DeadlineKind;
  subjectId?: number | null;
  due?: string;
  note?: string;
  done?: boolean;
}

export type StatCard = 'total' | 'subjects' | 'goal' | 'estimates';
export type StatRange = 'today' | 'week' | 'month';
export interface StatWidget {
  id: number;
  card: StatCard;
  range: StatRange;
  x: number;
  y: number;
  scale: number;
  bare: boolean;
}
export interface StatWidgetPatch {
  card?: StatCard;
  range?: StatRange;
  x?: number;
  y?: number;
  scale?: number;
  bare?: boolean;
}
export interface SubjectBar {
  key: string;
  name: string;
  colour: string;
  ms: number;
}
export interface TotalCardData {
  card: 'total';
  range: StatRange;
  totalMs: number;
  previousMs: number;
  deltaPct: number | null;
  todayMs: number;
}
export interface SubjectsCardData {
  card: 'subjects';
  range: StatRange;
  bars: SubjectBar[];
}
export interface GoalCardData {
  card: 'goal';
  range: StatRange;
  goalMs: number;
  todayMs: number;
  days: { dayKey: string; hit: boolean; future: boolean }[];
  hitDays: number;
  elapsedDays: number;
  streak: number;
}
export interface EstimatesCardData {
  card: 'estimates';
  range: StatRange;
  tasks: number;
  plannedMs: number;
  focusedMs: number;
  /** focused / planned to 1 dp; null when nothing is estimated. */
  ratio: number | null;
  overruns: { taskId: number; title: string; estimateMs: number; actualMs: number }[];
  bySubject: { subjectId: number | null; label: string; ratio: number }[];
}
export type CardData = TotalCardData | SubjectsCardData | GoalCardData | EstimatesCardData;

/** What a YouTube space asks the player for: Auto leaves it to YouTube (spec §3.3). */
export type SpaceQuality = 'auto' | '1080' | '1440' | '2160';

export interface SpaceOpts {
  audio: boolean;
  volume: number;
  speed: number;
  dim: number;
  blur: number;
  quality: SpaceQuality;
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
  /** 0.5..2, default 1 (spec §3.5). */
  scale: number;
}

export type WidgetId = 'timer' | 'tasks' | 'spotify' | 'calendar' | 'weather' | 'quote' | 'notes';

export type WeatherUnits = 'celsius' | 'fahrenheit';

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
  /** Off disables idle polling, prompts and discards only (spec §3.1). */
  awayPrompt: boolean;
  countdownMinutes: number;
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
  /** Widgets addendum §3: set only through `weather.setPlace`. */
  weatherPlace: Place | null;
  weatherUnits: WeatherUnits;
  /** The last good weather report, for an offline start (main-only). */
  weatherCache: WeatherReport | null;
  /** Widgets addendum §2: the iCal addresses, safeStorage-encrypted JSON (base64); main-only, never logged. */
  calendarUrls: string | null;
  /** The last agenda, for an offline start (main-only). */
  calendarCache: CalendarAgenda | null;
  onboarded: boolean;
  trayNoticeShown: boolean;
  windowBounds: WindowBounds | null;
  miniPos: { x: number; y: number } | null;
  countdownPips: boolean;
  rollTasksForward: boolean;
  sessionIntention: boolean;
  revisionTags: string[];
  revisionDays: number[];
}

/**
 * Keys main owns and never sends to the renderer or an export: tokens and calendar addresses are
 * secrets (spec §3.10, widgets addendum §2, study-dev rule 9); the caches are main's.
 */
export type MainOnlySettingsKey = 'spotifyTokens' | 'calendarUrls' | 'calendarCache' | 'weatherCache';

/** What the renderer sees. */
export type PublicSettings = Omit<Settings, MainOnlySettingsKey>;

/**
 * A renderer settings patch: any public key except `activeSpaceId` (only `spaces:setActive`
 * changes it) and `weatherPlace` (only `weather:setPlace`), and `widgets` may name just some widgets.
 */
export type SettingsPatch = Partial<
  Omit<Settings, 'widgets' | MainOnlySettingsKey | 'activeSpaceId' | 'weatherPlace'>
> & {
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

/** Focus time on one task, for the stats view. */
export interface TaskTotal {
  taskId: number;
  text: string;
  ms: number;
}

/** A dropped image on the space (spec §3.6). */
export interface ImageWidget {
  id: number;
  url: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  bare: boolean;
}

export interface ImagePatch {
  x?: number;
  y?: number;
  scale?: number;
  bare?: boolean;
}

export type ImageAddResult = ImageWidget | { error: string };
