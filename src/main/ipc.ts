// The IPC layer (spec §3.6; study-dev rules 4–5): one handler per `CHANNELS` entry, each payload
// validated before it reaches a service (ids integers, strings <= 500 chars, enums checked).
// Invalid input throws `IpcValidationError`, a rejected promise in the renderer. Electron is
// injected (`ipc`, dialogs, window, app, shell) so every handler runs under a unit test.
import { join } from 'node:path';
import type { FileFilter, IpcMainInvokeEvent } from 'electron';
import { CHANNELS, type NotePatch } from '../shared/ipc';
import {
  ESTIMATE_MAX,
  ESTIMATE_MIN,
  INTENTION_MAX,
  LIMIT_COPY,
  LIST_NAME_MAX,
  MAX_POPPED_NOTES,
  MAX_TAGS,
  normaliseTag,
  REMINDER_RE,
  REPEAT_EVERY_MAX,
  REPEAT_EVERY_MIN,
  REVISION_DAYS_MAX,
  SUBTASK_TEXT_MAX,
  TASK_GONE,
  TASK_NOTE_MAX,
  TASK_TITLE_MAX,
} from '../shared/planner';
import { cascadeAt } from '../core/cascade';
import { sanitisePlace, sanitiseSettingsPatch } from '../shared/settings';
import type {
  DeadlineInput,
  DeadlinePatch,
  ImagePatch,
  ListInput,
  ListPatch,
  Mode,
  PublicSettings,
  RepeatRule,
  SessionOutcome,
  Settings,
  SettingsPatch,
  StatWidgetPatch,
  SubjectRange,
  TaskColour,
  TaskInput,
  TaskMove,
  TaskUpdate,
} from '../shared/types';
import { localDateKey } from './db/backup';
import type { Db } from './db/db';
import { IMAGE_SCALE_MAX, IMAGE_SCALE_MIN } from './db/repos/images';
import { mixesRepo } from './db/repos/mixes';
import { NOTE_MAX_CHARS, NOTE_SCALE_MAX, NOTE_SCALE_MIN, notesRepo } from './db/repos/notes';
import { plannerTasksRepo } from './db/repos/plannerTasks';
import { type MainSettingsPatch, settingsRepo } from './db/repos/settings';
import { subjectsRepo } from './db/repos/subjects';
import type { MediaKind, MediaResolver } from './protocol';
import { dataService } from './services/data';
import { deadlinesService } from './services/deadlines';
import type { CalendarService } from './services/calendar';
import { imagesService, type ImagesService } from './services/images';
import { plannerService } from './services/planner';
import { recapsService } from './services/recaps';
import { publicSettings } from './services/settings';
import { AUDIO_EXTS, soundsService, type SoundsService } from './services/sounds';
import { IMAGE_EXTS, spacesService, VIDEO_EXTS, type SpacesService } from './services/spaces';
import { spotifyCall, type SafeStorageLike } from './services/spotify';
import { STAT_CARDS, STAT_RANGES, statWidgetsService } from './services/statWidgets';
import { sanitiseSessionFilter, statsService } from './services/stats';
import { taskWritesService } from './services/taskWrites';
import {
  assertBool,
  assertColour,
  assertDayKey,
  assertEnum,
  assertInt,
  assertIntOrNull,
  assertRecord,
  assertStr,
  clampNum,
  IpcValidationError,
  isRecord,
} from './services/validate';
import { PLACE_QUERY_MAX, PLACE_QUERY_MIN, type WeatherService } from './services/weather';
import { widgetsService } from './services/widgets';
import type { SpotifyApi } from './spotify/api';
import type { SpotifyAuth } from './spotify/auth';
import type { TimerController } from './timer/controller';

export { IpcValidationError, assertEnum, assertInt, assertStr } from './services/validate';

const MODES: readonly Mode[] = ['focus', 'short', 'long', 'countdown'];
const RANGES: readonly SubjectRange[] = ['week', 'month', 'all'];
const TASK_COLOURS: readonly TaskColour[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'grey'];
const OUTCOMES: readonly SessionOutcome[] = ['done', 'partly', 'not'];
const REPEAT_KINDS = ['daily', 'weekdays', 'weekly', 'every'] as const;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Most revision offsets a task can schedule at once (the setting holds 1 to 4). */
const MAX_REVISION_DAYS = 4;
/** The most raw text read before trimming; the real limit applies after trimming. */
const RAW_TEXT = 10_000;
/** The id a pomodoro row carries (a uuid). */
const POMODORO_ID_MAX = 64;
/** Bounds on list payloads, far above anything Sam will have. */
const MAX_IDS = 10_000;
const MAX_LEVELS = 500;
/** Widgets addendum §2: private iCal addresses Sam pastes in Settings. */
const MAX_CALENDARS = 5;
const MAX_CALENDAR_URL = 2000;
/** The most untrimmed text read per address; the 2000-char limit applies after trimming. */
const RAW_CALENDAR_URL = 10_000;
/** Blank lines from the Settings form are dropped before the five-address limit applies. */
const MAX_CALENDAR_FIELDS = 50;

export const SPACE_FILTERS: FileFilter[] = [
  { name: 'Videos and images', extensions: [...VIDEO_EXTS, ...IMAGE_EXTS] },
];
export const IMAGE_FILTERS: FileFilter[] = [
  { name: 'Images', extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp'] },
];
export const SOUND_FILTERS: FileFilter[] = [{ name: 'Audio', extensions: [...AUDIO_EXTS] }];

/** Native dialogs, injected (spec §3.6: `addFiles`, exports and restore open one). */
export interface Dialogs {
  /** Chosen paths; empty when cancelled. `multi: false` allows one file. */
  openFiles(filters: FileFilter[], multi?: boolean): Promise<string[]>;
  /** The chosen path, or null when cancelled. */
  saveFile(defaultName: string, filters: FileFilter[]): Promise<string | null>;
  confirm(message: string, detail: string): Promise<boolean>;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
}

export type TimerLike = Pick<
  TimerController,
  | 'getState'
  | 'start'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'skip'
  | 'setMode'
  | 'setSubject'
  | 'setTask'
  | 'startTask'
  | 'setIntention'
  | 'setOutcome'
  | 'answerAway'
  | 'applySettings'
>;

export interface SpotifyDeps {
  api: Pick<
    SpotifyApi,
    | 'nowPlaying'
    | 'play'
    | 'pause'
    | 'next'
    | 'previous'
    | 'playlists'
    | 'playContext'
    | 'devices'
    | 'transfer'
  >;
  auth: Pick<SpotifyAuth, 'setClientId' | 'connect' | 'disconnect' | 'status'>;
}

export interface WindowLike {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
}

export interface IpcDeps {
  ipc: IpcMainLike;
  db: Db;
  timer: TimerLike;
  spotify: SpotifyDeps;
  /** Widgets addendum §2, §3: the fetch services (main-only network) and OS encryption for the iCal addresses. */
  weather: WeatherService;
  calendar: CalendarService;
  safeStorage: SafeStorageLike;
  dialogs: Dialogs;
  /** The main window, if open. */
  win: () => WindowLike | null;
  app: { relaunch(): void; exit(code: number): void };
  shell: { openPath(path: string): Promise<string> };
  paths: { userData: string; assets: string };
  now: () => number;
  /** Before a restore copies over the database: `await timer.quit()`, then `await db.close()`. */
  beforeRestore(): Promise<void>;
  /** After every `settings:set` (Task 13 re-registers the global hotkey and login item here). */
  onSettingsChanged?(settings: Settings, patch: MainSettingsPatch): void;
  /**
   * After every settings write a renderer can see, with the public settings: the bootstrap sends
   * them on `settings:changed` to every window, so a change made anywhere shows everywhere.
   */
  pushSettings?(settings: PublicSettings): void;
  /** `app:showMini` (Task 13's mini window). */
  showMini?(show: boolean): void;
  /** `app:flushed`: the sending window has saved what it held after an `app:flush`. */
  onFlushed?(sender: { id: number }): void;
  exists?: (path: string) => boolean;
  /** Image links are downloaded here (main-only network); the global `fetch` when absent. */
  fetch?: typeof fetch;
  /**
   * False rejects the call before any payload is read (study-dev rule 5): Task 13 checks the
   * sender frame is one of StudyAt's own windows. Absent, every sender is allowed.
   */
  isTrustedSender?: (event: IpcMainInvokeEvent) => boolean;
}

/** Media ids → files registered in the DB (spec §3.2); `chime` ids are sound row ids. */
export function createMediaResolver(
  spaces: Pick<SpacesService, 'pathOf'>,
  sounds: Pick<SoundsService, 'pathOf'>,
  images: Pick<ImagesService, 'pathOf'>,
): MediaResolver {
  return (kind: MediaKind, id: number) =>
    kind === 'space' ? spaces.pathOf(id) : kind === 'image' ? images.pathOf(id) : sounds.pathOf(id);
}

/** Webcontents a push can go to. */
export interface PushTarget {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

/**
 * Main-to-renderer pushes on `CHANNELS.events` to every live renderer window. The main window is
 * added at creation; Task 13 adds the mini window. Destroyed targets are dropped.
 */
export function createBroadcaster<T extends PushTarget = PushTarget>() {
  const targets = new Set<T>();
  return {
    /** Returns a function that removes the target again. */
    add(target: T): () => void {
      targets.add(target);
      return () => targets.delete(target);
    },
    /** The live targets (the app:flush on quit asks each of them). */
    live(): T[] {
      return [...targets].filter((t) => !t.isDestroyed());
    },
    send(channel: string, payload: unknown): void {
      for (const t of targets) {
        if (t.isDestroyed()) targets.delete(t);
        else t.send(channel, payload);
      }
    },
  };
}

export type Broadcaster = ReturnType<typeof createBroadcaster>;

function subjectPatch(v: unknown): { name?: string; colour?: string; sort?: number } {
  const p = assertRecord(v, 'patch');
  const out: { name?: string; colour?: string; sort?: number } = {};
  if (p.name !== undefined) out.name = assertStr(p.name, 'name', { nonEmpty: true }).trim();
  if (p.colour !== undefined) out.colour = assertColour(p.colour);
  if (p.sort !== undefined) out.sort = assertInt(p.sort, 'sort');
  return out;
}

/** Image URLs are at most this long; the field in the add dialog is a pasted link. */
const MAX_IMAGE_URL = 2048;

/** x, y, scale as finite numbers (the repo clamps them) and bare as a boolean; nothing else passes. */
function imagePatch(v: unknown): ImagePatch {
  const p = assertRecord(v, 'patch');
  const out: ImagePatch = {};
  if (p.x !== undefined) out.x = clampNum(p.x, 0, 1, 'x');
  if (p.y !== undefined) out.y = clampNum(p.y, 0, 1, 'y');
  if (p.scale !== undefined) out.scale = clampNum(p.scale, IMAGE_SCALE_MIN, IMAGE_SCALE_MAX, 'scale');
  if (p.bare !== undefined) out.bare = assertBool(p.bare, 'bare');
  return out;
}

/** Text at most 5000 chars; x, y and scale finite numbers (the repo clamps them); bare a boolean. */
function notePatch(v: unknown): NotePatch {
  const p = assertRecord(v, 'patch');
  const out: NotePatch = {};
  if (p.text !== undefined) out.text = assertStr(p.text, 'text', { max: NOTE_MAX_CHARS });
  if (p.colour !== undefined) out.colour = assertEnum(p.colour, TASK_COLOURS, 'colour');
  if (p.x !== undefined) out.x = clampNum(p.x, 0, 1, 'x');
  if (p.y !== undefined) out.y = clampNum(p.y, 0, 1, 'y');
  if (p.scale !== undefined) out.scale = clampNum(p.scale, NOTE_SCALE_MIN, NOTE_SCALE_MAX, 'scale');
  if (p.bare !== undefined) out.bare = assertBool(p.bare, 'bare');
  return out;
}

/** The card, range and placement fields of a stats widget; `card` and `range` are enums. */
function statWidgetPatch(v: unknown): StatWidgetPatch {
  const p = assertRecord(v, 'patch');
  const out: StatWidgetPatch = {};
  if (p.card !== undefined) out.card = assertEnum(p.card, STAT_CARDS, 'card');
  if (p.range !== undefined) out.range = assertEnum(p.range, STAT_RANGES, 'range');
  if (p.x !== undefined) out.x = clampNum(p.x, 0, 1, 'x');
  if (p.y !== undefined) out.y = clampNum(p.y, 0, 1, 'y');
  if (p.scale !== undefined) out.scale = clampNum(p.scale, IMAGE_SCALE_MIN, IMAGE_SCALE_MAX, 'scale');
  if (p.bare !== undefined) out.bare = assertBool(p.bare, 'bare');
  return out;
}

/** A real `YYYY-MM-DD` calendar day: `2026-02-31` is rejected (Date.parse would roll it over). */
function dayKey(v: unknown, what: string): string {
  const s = assertDayKey(v, what);
  if (new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new IpcValidationError(`${what} must be a real date`);
  }
  return s;
}

function monthKey(v: unknown): string {
  const s = assertStr(v, 'month', { max: 7 });
  if (!MONTH_KEY.test(s)) throw new IpcValidationError('month must be YYYY-MM');
  return s;
}

/** A whole number within min..max; anything else (NaN, Infinity, 1.5) is rejected, never clamped. */
function intIn(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new IpcValidationError(`${what} must be a whole number from ${min} to ${max}`);
  }
  return v;
}

/** Trimmed text of `min`..`max` code points. */
function trimmedText(v: unknown, what: string, min: number, max: number): string {
  const t = assertStr(v, what, { max: RAW_TEXT }).trim();
  const n = [...t].length;
  if (n < min || n > max) throw new IpcValidationError(`${what} is ${min} to ${max} characters`);
  return t;
}

const taskTitle = (v: unknown): string => trimmedText(v, 'title', 1, TASK_TITLE_MAX);

function taskNote(v: unknown): string {
  return assertStr(v, 'note', { max: TASK_NOTE_MAX });
}

function estimate(v: unknown): number | null {
  return v === null ? null : intIn(v, ESTIMATE_MIN, ESTIMATE_MAX, 'estimateMin');
}

/** Each tag must already be a valid tag (a `#` and capitals are fine); an invalid one rejects the call. */
function tagList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_TAGS) {
    throw new IpcValidationError(`tags must be a list of at most ${MAX_TAGS}`);
  }
  return v.map((t) => {
    const tag = normaliseTag(assertStr(t, 'tag', { max: 40 }));
    if (tag === null) throw new IpcValidationError('A tag is 1 to 24 letters, digits or dashes');
    return tag;
  });
}

function colourOrNull(v: unknown): TaskColour | null {
  return v === null ? null : assertEnum(v, TASK_COLOURS, 'colour');
}

function repeatRule(v: unknown): RepeatRule | null {
  if (v === null) return null;
  const r = assertRecord(v, 'repeat');
  const kind = assertEnum(r.kind, REPEAT_KINDS, 'repeat kind');
  if (kind !== 'every') return { kind };
  return { kind, days: intIn(r.days, REPEAT_EVERY_MIN, REPEAT_EVERY_MAX, 'repeat days') };
}

function reminder(v: unknown): string | null {
  if (v === null) return null;
  const s = assertStr(v, 'reminder', { max: 5 });
  if (!REMINDER_RE.test(s)) throw new IpcValidationError('reminder must be HH:MM');
  return s;
}

function taskInput(v: unknown): TaskInput {
  const i = assertRecord(v, 'task');
  const out: TaskInput = { title: taskTitle(i.title) };
  if (i.day !== undefined) out.day = dayKey(i.day, 'day');
  if (i.listId !== undefined) out.listId = assertInt(i.listId, 'listId');
  if (out.day !== undefined && out.listId !== undefined) {
    throw new IpcValidationError('A task is on a day or in a list');
  }
  if (i.subjectId !== undefined) out.subjectId = assertIntOrNull(i.subjectId, 'subjectId');
  if (i.estimateMin !== undefined) out.estimateMin = estimate(i.estimateMin);
  if (i.tags !== undefined) out.tags = tagList(i.tags);
  if (i.note !== undefined) out.note = taskNote(i.note);
  if (i.colour !== undefined) out.colour = colourOrNull(i.colour);
  return out;
}

function taskUpdate(v: unknown): TaskUpdate {
  const p = assertRecord(v, 'patch');
  const out: TaskUpdate = {};
  if (p.title !== undefined) out.title = taskTitle(p.title);
  if (p.note !== undefined) out.note = taskNote(p.note);
  if (p.done !== undefined) out.done = assertBool(p.done, 'done');
  if (p.colour !== undefined) out.colour = colourOrNull(p.colour);
  if (p.subjectId !== undefined) out.subjectId = assertIntOrNull(p.subjectId, 'subjectId');
  if (p.estimateMin !== undefined) out.estimateMin = estimate(p.estimateMin);
  if (p.tags !== undefined) out.tags = tagList(p.tags);
  if (p.repeat !== undefined) out.repeat = repeatRule(p.repeat);
  if (p.reminder !== undefined) out.reminder = reminder(p.reminder);
  return out;
}

function taskMove(v: unknown): TaskMove {
  const m = assertRecord(v, 'to');
  const index = intIn(m.index, 0, MAX_IDS, 'index');
  if ((m.day === undefined) === (m.listId === undefined)) {
    throw new IpcValidationError('Move to a day or to a list');
  }
  return m.day !== undefined
    ? { day: dayKey(m.day, 'day'), index }
    : { listId: assertInt(m.listId, 'listId'), index };
}

/** One to four revision offsets in days, each 1 to 90. */
function revisionDays(v: unknown): number[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_REVISION_DAYS) {
    throw new IpcValidationError(`Pick 1 to ${MAX_REVISION_DAYS} revision days`);
  }
  return v.map((n) => intIn(n, 1, REVISION_DAYS_MAX, 'revision day'));
}

const subtaskText = (v: unknown): string => trimmedText(v, 'text', 1, SUBTASK_TEXT_MAX);

function subtaskPatch(v: unknown): { text?: string; done?: boolean } {
  const p = assertRecord(v, 'patch');
  const out: { text?: string; done?: boolean } = {};
  if (p.text !== undefined) out.text = subtaskText(p.text);
  if (p.done !== undefined) out.done = assertBool(p.done, 'done');
  return out;
}

const listName = (v: unknown): string => trimmedText(v, 'name', 1, LIST_NAME_MAX);

function listInput(v: unknown): ListInput {
  const i = assertRecord(v, 'list');
  const out: ListInput = { name: listName(i.name) };
  if (i.subjectId !== undefined) out.subjectId = assertIntOrNull(i.subjectId, 'subjectId');
  return out;
}

function listPatch(v: unknown): ListPatch {
  const p = assertRecord(v, 'patch');
  const out: ListPatch = {};
  if (p.name !== undefined) out.name = listName(p.name);
  if (p.subjectId !== undefined) out.subjectId = assertIntOrNull(p.subjectId, 'subjectId');
  return out;
}

/** Trimmed, at most INTENTION_MAX characters; blank is null. */
function intention(v: unknown): string | null {
  if (v === null) return null;
  const t = assertStr(v, 'intention', { max: RAW_TEXT }).trim();
  if ([...t].length > INTENTION_MAX) {
    throw new IpcValidationError(`intention is longer than ${INTENTION_MAX} characters`);
  }
  return t === '' ? null : t;
}

function placeQuery(v: unknown): string {
  const q = assertStr(v, 'search', { max: PLACE_QUERY_MAX }).trim();
  if (q.length < PLACE_QUERY_MIN)
    throw new IpcValidationError(`search must be at least ${PLACE_QUERY_MIN} characters`);
  return q;
}

/**
 * The iCal addresses, trimmed, blanks dropped: https only, at most 2000 chars each and five in
 * all. Messages never repeat an address (they are secrets).
 */
function calendarUrls(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_CALENDAR_FIELDS)
    throw new IpcValidationError('urls must be a list');
  const urls = v
    .map((u) => assertStr(u, 'Calendar address', { max: RAW_CALENDAR_URL }).trim())
    .filter((u) => u !== '')
    .map((u) => {
      if (u.length > MAX_CALENDAR_URL)
        throw new IpcValidationError(`Calendar address is longer than ${MAX_CALENDAR_URL} characters`);
      return u;
    });
  if (urls.length > MAX_CALENDARS) throw new IpcValidationError(`Add at most ${MAX_CALENDARS} calendars`);
  if (!urls.every(isHttpsUrl)) throw new IpcValidationError('Calendar addresses must start with https://');
  return urls;
}

function isHttpsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

function idList(v: unknown): number[] {
  if (!Array.isArray(v) || v.length > MAX_IDS) throw new IpcValidationError('ids must be a list');
  return v.map((id) => assertInt(id));
}

function mixLevels(v: unknown): Record<string, number> {
  const levels = assertRecord(v, 'levels');
  const entries = Object.entries(levels);
  if (entries.length > MAX_LEVELS) throw new IpcValidationError('Too many levels');
  const out: Record<string, number> = {};
  for (const [key, level] of entries)
    out[assertStr(key, 'sound', { max: 64 })] = clampNum(level, 0, 1, 'level');
  return out;
}

/** Registers every request channel of `CHANNELS`; returns the services for the bootstrap. */
export function registerIpc(deps: IpcDeps) {
  const { db, timer, dialogs, now } = deps;
  const settings = settingsRepo(db);
  const subjects = subjectsRepo(db);
  const plannerTasks = plannerTasksRepo(db);
  const mixes = mixesRepo(db);
  const notes = notesRepo(db);
  const widgets = widgetsService({
    db,
    weather: deps.weather,
    calendar: deps.calendar,
    safe: deps.safeStorage,
    now,
  });
  const deadlines = deadlinesService({ db, now });
  const statWidgets = statWidgetsService({ db, now });
  const stats = statsService({ db, now, liveTodayMs: () => timer.getState().todayFocusMs });
  const recaps = recapsService({ db, stats });
  const planner = plannerService({ db, now, liveTodayMs: () => timer.getState().todayFocusMs });
  const taskWrites = taskWritesService({ db, now, planner });
  const spaces = spacesService({ db, now, assetsDir: deps.paths.assets, exists: deps.exists });
  const sounds = soundsService({ db, assetsDir: deps.paths.assets, exists: deps.exists });
  const images = imagesService({
    db,
    dir: join(deps.paths.userData, 'images'),
    now,
    fetch: deps.fetch ?? fetch,
  });
  const data = dataService({
    db,
    dir: deps.paths.userData,
    now,
    confirm: dialogs.confirm,
    beforeRestore: deps.beforeRestore,
    app: deps.app,
  });
  const { api: spotify, auth } = deps.spotify;

  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    deps.ipc.handle(channel, (event, ...args) => {
      if (deps.isTrustedSender && !deps.isTrustedSender(event)) throw new Error('Untrusted sender');
      return fn(...args);
    });
  };
  const clientId = (): string => settings.get().spotifyClientId;
  /** Tells every window what main now has; returns the same public copy. */
  const pushSettings = (out: PublicSettings = publicSettings(settings.get())): PublicSettings => {
    deps.pushSettings?.(out);
    return out;
  };
  const setSettings = (patch: SettingsPatch): PublicSettings => {
    const next = settings.set(patch);
    timer.applySettings();
    if (patch.spotifyClientId !== undefined) auth.setClientId(patch.spotifyClientId);
    deps.onSettingsChanged?.(next, patch);
    return pushSettings(publicSettings(next));
  };
  const stamp = (): string => localDateKey(now());

  const C = CHANNELS;

  // ── Timer (main-owned, rule 4) ─────────────────────────────────────────────
  handle(C.timer.get, () => timer.getState());
  handle(C.timer.start, () => timer.start());
  handle(C.timer.pause, () => timer.pause());
  handle(C.timer.resume, () => timer.resume());
  handle(C.timer.reset, () => timer.reset());
  handle(C.timer.skip, () => timer.skip());
  handle(C.timer.setMode, (mode) => timer.setMode(assertEnum(mode, MODES, 'mode')));
  handle(C.timer.setSubject, (id) => {
    const subjectId = assertIntOrNull(id, 'subjectId');
    if (subjectId !== null && !subjects.list().some((s) => s.id === subjectId && !s.archived)) {
      throw new IpcValidationError('No such subject');
    }
    return timer.setSubject(subjectId);
  });
  // The title is snapshotted here, from the planner task, so a row keeps the name it was studied
  // under (v1.1 spec §3.3). A done task is still a task: the picker hides those, main doesn't refuse.
  // The task's effective subject (its own, else its list's) rides along so the controller does one
  // split (v1.2 spec §3.8); none, or an archived one, leaves the timer's subject alone.
  const plannerTask = (id: unknown) => {
    const row = plannerTasks.get(assertInt(id, 'taskId'));
    if (!row) throw new IpcValidationError(TASK_GONE);
    const subject = planner.effectiveSubject(row);
    const live = subject !== null && subjects.list().some((s) => s.id === subject && !s.archived);
    return { id: row.id, title: row.title, subjectId: live ? subject : undefined };
  };
  handle(C.timer.setTask, (id) => {
    if (assertIntOrNull(id, 'taskId') === null) return timer.setTask(null, null);
    const t = plannerTask(id);
    return timer.setTask(t.id, t.title, t.subjectId);
  });
  handle(C.timer.startTask, (id) => {
    const t = plannerTask(id);
    return timer.startTask(t.id, t.title, t.subjectId);
  });
  handle(C.timer.setIntention, (text) => timer.setIntention(intention(text)));
  handle(C.timer.setOutcome, (pomodoroId, outcome) =>
    timer.setOutcome(
      trimmedText(pomodoroId, 'pomodoroId', 1, POMODORO_ID_MAX),
      outcome === null ? null : assertEnum(outcome, OUTCOMES, 'outcome'),
    ),
  );
  handle(C.timer.answerAway, (answer) =>
    timer.answerAway(assertEnum(answer, ['keep', 'discard'] as const, 'answer')),
  );

  // ── Stats ─────────────────────────────────────────────────────────────────
  handle(C.stats.overview, () => stats.overview());
  handle(C.stats.heatmap, () => stats.heatmap());
  handle(C.stats.week, (weekStart) =>
    stats.week(weekStart === undefined ? undefined : assertDayKey(weekStart, 'weekStart')),
  );
  handle(C.stats.trend, () => stats.trend());
  handle(C.stats.bySubject, (range) => stats.bySubject(assertEnum(range, RANGES, 'range')));
  handle(C.stats.byTask, (range) => stats.byTask(assertEnum(range, RANGES, 'range')));
  handle(C.stats.card, (card, range) =>
    stats.card(assertEnum(card, STAT_CARDS, 'card'), assertEnum(range, STAT_RANGES, 'range')),
  );
  handle(C.stats.sessions, (filter) => stats.sessions(sanitiseSessionFilter(filter)));
  handle(C.stats.updateSession, (id, patch) => {
    const p = assertRecord(patch, 'patch');
    // R25: a stored recap of that week is refreshed so it never goes stale.
    recaps.refreshWeekOf(
      stats.updateSession(assertInt(id), assertIntOrNull(p.subjectId, 'subjectId')),
      now(),
    );
  });
  handle(C.stats.deleteSession, (id) => {
    recaps.refreshWeekOf(stats.deleteSession(assertInt(id)), now());
  });

  // ── Recaps (spec §3.5) ────────────────────────────────────────────────────
  handle(C.recaps.list, () => recaps.list());
  handle(C.recaps.pending, () => recaps.computePending(now()));
  handle(C.recaps.markShown, (weekStart) => recaps.markShown(assertDayKey(weekStart, 'weekStart'), now()));

  // ── Subjects ──────────────────────────────────────────────────────────────
  handle(C.subjects.list, () => subjects.list());
  handle(C.subjects.create, (input) => {
    const i = assertRecord(input, 'subject');
    subjects.create({
      name: assertStr(i.name, 'name', { nonEmpty: true }).trim(),
      colour: assertColour(i.colour),
    });
    return subjects.list();
  });
  handle(C.subjects.update, (id, patch) => {
    if (!subjects.update(assertInt(id), subjectPatch(patch))) throw new IpcValidationError('No such subject');
    return subjects.list();
  });
  handle(C.subjects.archive, (id) => {
    if (!subjects.archive(assertInt(id))) throw new IpcValidationError('No such subject');
    return subjects.list();
  });

  // ── Planner and tasks (v1.2 spec §5): reads from `planner`, writes through `taskWrites` ──
  handle(C.planner.week, (day) => planner.week(dayKey(day, 'weekStart')));
  handle(C.planner.month, (month) => planner.month(monthKey(month)));
  handle(C.planner.day, (day) => planner.day(dayKey(day, 'day')));
  handle(C.planner.lists, () => planner.lists());
  handle(C.planner.task, (id) => {
    const n = assertInt(id, 'taskId');
    if (n < 1) throw new IpcValidationError('taskId must be a positive whole number');
    return planner.task(n);
  });
  handle(C.tasks.create, (input) => taskWrites.create(taskInput(input)));
  handle(C.tasks.update, (id, patch) => taskWrites.update(assertInt(id), taskUpdate(patch)));
  handle(C.tasks.move, (id, to) => taskWrites.move(assertInt(id), taskMove(to)));
  handle(C.tasks.remove, (id) => taskWrites.remove(assertInt(id)));
  handle(C.tasks.duplicate, (id) => taskWrites.duplicate(assertInt(id)));
  handle(C.tasks.scheduleRevision, (id, days) =>
    taskWrites.scheduleRevision(assertInt(id), revisionDays(days)),
  );
  handle(C.subtasks.add, (taskId, text) =>
    taskWrites.addSubtask(assertInt(taskId, 'taskId'), subtaskText(text)),
  );
  handle(C.subtasks.update, (id, patch) => taskWrites.updateSubtask(assertInt(id), subtaskPatch(patch)));
  handle(C.subtasks.remove, (id) => taskWrites.removeSubtask(assertInt(id)));
  handle(C.subtasks.reorder, (taskId, ids) =>
    taskWrites.reorderSubtasks(assertInt(taskId, 'taskId'), idList(ids)),
  );
  handle(C.lists.create, (input) => taskWrites.createList(listInput(input)));
  handle(C.lists.update, (id, patch) => taskWrites.updateList(assertInt(id), listPatch(patch)));
  handle(C.lists.reorder, (ids) => taskWrites.reorderLists(idList(ids)));
  handle(C.lists.remove, (id) => taskWrites.removeList(assertInt(id)));
  handle(C.lists.clearDone, (id) => taskWrites.clearDone(assertInt(id)));

  // ── Spaces (spec §3.8) ────────────────────────────────────────────────────
  handle(C.spaces.list, () => spaces.list());
  handle(C.spaces.addFiles, async () => spaces.addFiles(await dialogs.openFiles(SPACE_FILTERS)));
  handle(C.spaces.addYouTube, (url) => spaces.addYouTube(assertStr(url, 'url')));
  handle(C.spaces.update, (id, patch) => spaces.update(assertInt(id), patch));
  handle(C.spaces.remove, (id) => spaces.remove(assertInt(id)));
  handle(C.spaces.relocate, async (id) => {
    const spaceId = assertInt(id);
    const [path] = await dialogs.openFiles(SPACE_FILTERS, false);
    return path === undefined ? spaces.list() : spaces.relocate(spaceId, path);
  });
  handle(C.spaces.setActive, (id) => {
    const spaceId = assertInt(id);
    const list = spaces.setActive(spaceId);
    deps.onSettingsChanged?.(settings.get(), { activeSpaceId: spaceId });
    pushSettings();
    return list;
  });

  // ── Images (v1.1 spec §3.6) ───────────────────────────────────────────────
  handle(C.images.list, () => images.list());
  handle(C.images.addFile, async () => {
    const [path] = await dialogs.openFiles(IMAGE_FILTERS, false);
    // A cancelled dialog is not an error to show: the empty message is the "nothing happened" signal.
    return path === undefined ? { error: '' } : images.addFile(path);
  });
  handle(C.images.addUrl, (url) =>
    images.addUrl(assertStr(url, 'url', { max: MAX_IMAGE_URL, nonEmpty: true }).trim()),
  );
  handle(C.images.update, (id, patch) => images.update(assertInt(id), imagePatch(patch)));
  handle(C.images.remove, (id) => images.remove(assertInt(id)));

  // ── Sounds and mixes (spec §3.9) ──────────────────────────────────────────
  handle(C.sounds.list, () => sounds.list());
  handle(C.sounds.addFiles, async () => sounds.addFiles(await dialogs.openFiles(SOUND_FILTERS)));
  handle(C.sounds.remove, (id) => {
    // A chime that played this sound goes back to its default.
    const list = sounds.remove(assertInt(id));
    pushSettings();
    return list;
  });
  handle(C.sounds.relocate, async (id) => {
    const soundId = assertInt(id);
    const [path] = await dialogs.openFiles(SOUND_FILTERS, false);
    return path === undefined ? sounds.list() : sounds.relocate(soundId, path);
  });
  handle(C.mixes.list, () => mixes.list());
  handle(C.mixes.save, (name, levels) => {
    mixes.save(assertStr(name, 'name', { nonEmpty: true }).trim(), mixLevels(levels));
    return mixes.list();
  });
  handle(C.mixes.remove, (id) => {
    mixes.remove(assertInt(id));
    return mixes.list();
  });

  // ── Settings (spec §3.11): sanitised, tokens never in or out ──────────────
  handle(C.settings.get, () => publicSettings(settings.get()));
  handle(C.settings.set, (patch) => {
    if (!isRecord(patch)) throw new IpcValidationError('patch must be an object');
    return setSettings(sanitiseSettingsPatch(patch));
  });

  // ── Data (spec §3.11) ─────────────────────────────────────────────────────
  handle(C.data.exportJson, async () => {
    const path = await dialogs.saveFile(`studyat-export-${stamp()}.json`, [
      { name: 'JSON', extensions: ['json'] },
    ]);
    if (path === null) return false;
    await data.exportJson(path);
    return true;
  });
  handle(C.data.exportCsv, async () => {
    const path = await dialogs.saveFile(`studyat-sessions-${stamp()}.csv`, [
      { name: 'CSV', extensions: ['csv'] },
    ]);
    if (path === null) return false;
    await data.exportCsv(path);
    return true;
  });
  handle(C.data.listBackups, () => data.listBackups());
  handle(C.data.restoreBackup, (name) => data.restoreBackup(assertStr(name, 'name')));
  handle(C.data.openDataFolder, async () => {
    await deps.shell.openPath(deps.paths.userData);
  });

  // ── Spotify (spec §3.10) ──────────────────────────────────────────────────
  handle(C.spotify.status, () => auth.status(clientId()));
  handle(C.spotify.connect, async () => {
    const id = clientId().trim();
    if (id === '') throw new Error('Add your Spotify Client ID in Settings first');
    // A PortInUseError's message (spec §7 copy) passes through unchanged.
    await auth.connect(id);
    return auth.status(clientId());
  });
  handle(C.spotify.disconnect, () => {
    auth.disconnect();
    return auth.status(clientId());
  });
  handle(C.spotify.nowPlaying, () =>
    clientId().trim() === '' ? { state: 'unconfigured' } : spotify.nowPlaying(),
  );
  handle(C.spotify.play, () => spotifyCall(() => spotify.play()));
  handle(C.spotify.pause, () => spotifyCall(() => spotify.pause()));
  handle(C.spotify.next, () => spotifyCall(() => spotify.next()));
  handle(C.spotify.previous, () => spotifyCall(() => spotify.previous()));
  handle(C.spotify.playlists, () => spotifyCall(() => spotify.playlists()));
  handle(C.spotify.playContext, (uri) => {
    const u = assertStr(uri, 'uri', { nonEmpty: true });
    if (!u.startsWith('spotify:')) throw new IpcValidationError('uri must be a Spotify URI');
    return spotifyCall(() => spotify.playContext(u));
  });
  handle(C.spotify.devices, () => spotifyCall(() => spotify.devices()));
  handle(C.spotify.transfer, (deviceId) => {
    const id = assertStr(deviceId, 'deviceId', { nonEmpty: true });
    return spotifyCall(() => spotify.transfer(id));
  });

  // ── Weather and Calendar (widgets addendum §2, §3): network in main only ────
  handle(C.weather.searchPlaces, (q) => widgets.searchPlaces(placeQuery(q)));
  handle(C.weather.setPlace, (place) => {
    if (place === null) return pushSettings(widgets.setPlace(null));
    const clean = sanitisePlace(place);
    if (clean === null) throw new IpcValidationError('place must be a place from the search');
    return pushSettings(widgets.setPlace(clean));
  });
  handle(C.weather.current, () => widgets.weatherCurrent());
  handle(C.calendar.status, () => widgets.calendarStatus());
  handle(C.calendar.setUrls, (urls) => widgets.setCalendarUrls(calendarUrls(urls)));
  handle(C.calendar.agenda, () => widgets.agenda());

  // ── Notes (widgets addendum §4b, text max 5000) ───────────────────────────
  handle(C.notes.list, () => notes.list());
  handle(C.notes.create, (input) => {
    const i = input === undefined ? {} : assertRecord(input, 'note');
    return notes.create(
      i.colour === undefined ? {} : { colour: assertEnum(i.colour, TASK_COLOURS, 'colour') },
      now(),
    );
  });
  handle(C.notes.update, (id, patch) => {
    const list = notes.update(assertInt(id), notePatch(patch), now());
    if (list === null) throw new IpcValidationError('No such note');
    return list;
  });
  handle(C.notes.remove, (id) => notes.remove(assertInt(id)));
  // v1.2 spec §3.2: a popped note lands at the next cascade step; the limit is enforced here.
  handle(C.notes.popOut, (id) => {
    const noteId = assertInt(id);
    if (!notes.list().some((n) => n.id === noteId)) throw new IpcValidationError('No such note');
    const count = notes.poppedCount();
    if (count >= MAX_POPPED_NOTES) throw new IpcValidationError(LIMIT_COPY.notes);
    const list = notes.popOut(noteId, cascadeAt(count));
    if (list === null) throw new IpcValidationError('No such note');
    return list;
  });
  handle(C.notes.dockBack, (id) => {
    const list = notes.dockBack(assertInt(id));
    if (list === null) throw new IpcValidationError('No such note');
    return list;
  });

  // ── Deadlines (v1.2 spec §3.10); the service validates every field ─────────
  handle(C.deadlines.list, (opts) => deadlines.list(assertBool(assertRecord(opts, 'opts').past, 'past')));
  handle(C.deadlines.create, (input) =>
    deadlines.create(assertRecord(input, 'deadline') as unknown as DeadlineInput),
  );
  handle(C.deadlines.update, (id, patch) =>
    deadlines.update(assertInt(id), assertRecord(patch, 'patch') as DeadlinePatch),
  );
  handle(C.deadlines.remove, (id) => deadlines.remove(assertInt(id)));

  // ── Stats widgets (v1.2 spec §3.12) ───────────────────────────────────────
  handle(C.statWidgets.list, () => statWidgets.list());
  handle(C.statWidgets.add, () => statWidgets.add());
  handle(C.statWidgets.update, (id, patch) => {
    const widget = statWidgets.update(assertInt(id), statWidgetPatch(patch));
    if (widget === null) throw new IpcValidationError('No such stats widget');
    return widget;
  });
  handle(C.statWidgets.remove, (id) => {
    const widgetId = assertInt(id);
    if (!statWidgets.list().some((w) => w.id === widgetId))
      throw new IpcValidationError('No such stats widget');
    statWidgets.remove(widgetId);
  });

  // ── App ───────────────────────────────────────────────────────────────────
  handle(C.app.toggleFullscreen, () => {
    const win = deps.win();
    win?.setFullScreen(!win.isFullScreen());
  });
  handle(C.app.showMini, (show) => {
    deps.showMini?.(assertBool(show, 'show'));
  });
  // No payload: the ack names its window by the invoke event's sender.
  deps.ipc.handle(C.app.flushed, (event) => {
    if (deps.isTrustedSender && !deps.isTrustedSender(event)) throw new Error('Untrusted sender');
    deps.onFlushed?.(event.sender);
  });

  return {
    stats,
    recaps,
    planner,
    taskWrites,
    spaces,
    sounds,
    images,
    deadlines,
    statWidgets,
    data,
    resolveMedia: createMediaResolver(spaces, sounds, images),
  };
}

export type IpcServices = ReturnType<typeof registerIpc>;
