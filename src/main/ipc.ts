// The IPC layer (spec §3.6; study-dev rules 4–5): one handler per `CHANNELS` entry, each payload
// validated before it reaches a service (ids integers, strings <= 500 chars, enums checked).
// Invalid input throws `IpcValidationError`, a rejected promise in the renderer. Electron is
// injected (`ipc`, dialogs, window, app, shell) so every handler runs under a unit test.
import type { FileFilter, IpcMainInvokeEvent } from 'electron';
import { CHANNELS } from '../shared/ipc';
import { sanitisePlace, sanitiseSettingsPatch } from '../shared/settings';
import type {
  Mode,
  PublicSettings,
  Settings,
  SettingsPatch,
  SubjectRange,
  TaskColour,
} from '../shared/types';
import { localDateKey } from './db/backup';
import type { Db } from './db/db';
import { mixesRepo } from './db/repos/mixes';
import { NOTE_MAX_CHARS, notesRepo } from './db/repos/notes';
import { type MainSettingsPatch, settingsRepo } from './db/repos/settings';
import { subjectsRepo } from './db/repos/subjects';
import { tasksRepo } from './db/repos/tasks';
import type { MediaKind, MediaResolver } from './protocol';
import { dataService } from './services/data';
import type { CalendarService } from './services/calendar';
import { recapsService } from './services/recaps';
import { publicSettings } from './services/settings';
import { AUDIO_EXTS, soundsService, type SoundsService } from './services/sounds';
import { IMAGE_EXTS, spacesService, VIDEO_EXTS, type SpacesService } from './services/spaces';
import { spotifyCall, type SafeStorageLike } from './services/spotify';
import { sanitiseSessionFilter, statsService } from './services/stats';
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

const MODES: readonly Mode[] = ['focus', 'short', 'long'];
const RANGES: readonly SubjectRange[] = ['week', 'month', 'all'];
const TASK_COLOURS: readonly TaskColour[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'grey'];
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
): MediaResolver {
  return (kind: MediaKind, id: number) => (kind === 'space' ? spaces.pathOf(id) : sounds.pathOf(id));
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

function taskPatch(v: unknown): { text?: string; colour?: TaskColour; done?: boolean } {
  const p = assertRecord(v, 'patch');
  const out: { text?: string; colour?: TaskColour; done?: boolean } = {};
  if (p.text !== undefined) out.text = assertStr(p.text, 'text', { nonEmpty: true });
  if (p.colour !== undefined) out.colour = assertEnum(p.colour, TASK_COLOURS, 'colour');
  if (p.done !== undefined) out.done = assertBool(p.done, 'done');
  return out;
}

function notePatch(v: unknown): { text?: string; colour?: TaskColour } {
  const p = assertRecord(v, 'patch');
  const out: { text?: string; colour?: TaskColour } = {};
  if (p.text !== undefined) out.text = assertStr(p.text, 'text', { max: NOTE_MAX_CHARS });
  if (p.colour !== undefined) out.colour = assertEnum(p.colour, TASK_COLOURS, 'colour');
  return out;
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
  const tasks = tasksRepo(db);
  const mixes = mixesRepo(db);
  const notes = notesRepo(db);
  const widgets = widgetsService({
    db,
    weather: deps.weather,
    calendar: deps.calendar,
    safe: deps.safeStorage,
    now,
  });
  const stats = statsService({ db, now, liveTodayMs: () => timer.getState().todayFocusMs });
  const recaps = recapsService({ db, stats });
  const spaces = spacesService({ db, now, assetsDir: deps.paths.assets, exists: deps.exists });
  const sounds = soundsService({ db, assetsDir: deps.paths.assets, exists: deps.exists });
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

  // ── Tasks (spec §3.10, text max 500) ──────────────────────────────────────
  handle(C.tasks.list, () => tasks.list());
  handle(C.tasks.create, (input) => {
    const i = assertRecord(input, 'task');
    tasks.create(
      {
        text: assertStr(i.text, 'text', { nonEmpty: true }),
        colour: assertEnum(i.colour, TASK_COLOURS, 'colour'),
      },
      now(),
    );
    return tasks.list();
  });
  handle(C.tasks.update, (id, patch) => {
    if (!tasks.update(assertInt(id), taskPatch(patch), now())) throw new IpcValidationError('No such task');
    return tasks.list();
  });
  handle(C.tasks.reorder, (ids) => {
    tasks.reorder(idList(ids));
    return tasks.list();
  });
  handle(C.tasks.clearDone, () => {
    tasks.clearDone();
    return tasks.list();
  });

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

  return { stats, recaps, spaces, sounds, data, resolveMedia: createMediaResolver(spaces, sounds) };
}

export type IpcServices = ReturnType<typeof registerIpc>;
