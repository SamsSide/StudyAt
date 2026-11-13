// Settings defaults and the patch sanitiser (spec §3.11). Pure: used by main (validation) and tests.
import type { ChimeId, Settings, SettingsPatch, WeatherUnits, WidgetId, WidgetPos } from './types';
import type { Place } from './widgets';

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  chimeFocusEnd: 'bell',
  chimeBreakEnd: 'marimba',
  chimeVolume: 0.7,
  chimeRepeat: 1,
  tickLastMinute: false,
  chimeOnStart: false,
  notifications: true,
  streakMinutes: 25,
  goalMinutes: 180,
  rolloverHour: 4,
  idleMinutes: 10,
  awayPrompt: true,
  countdownMinutes: 60,
  autoHideSeconds: 5,
  miniWhenHidden: true,
  globalHotkey: 'Ctrl+Alt+P',
  launchAtStartup: false,
  activeSpaceId: null,
  soundLevels: {},
  masterVolume: 0.8,
  widgets: {
    // Three columns that never overlap at the default 1280 x 800 window and stay clear of the dock
    // and the top bar: Weather and Calendar on the left, Timer and Notes in the middle, Tasks,
    // Spotify and Quote on the right (settings.test.ts checks it with the measured sizes).
    timer: { open: true, x: 0.5, y: 0.12, autoHide: false, scale: 1 },
    tasks: { open: false, x: 0.82, y: 0.1, autoHide: false, scale: 1 },
    spotify: { open: false, x: 0.82, y: 0.42, autoHide: false, scale: 1 },
    // Widgets addendum §1, §4b: closed until picked from the Widgets popover.
    calendar: { open: false, x: 0.22, y: 0.46, autoHide: false, scale: 1 },
    weather: { open: false, x: 0.22, y: 0.1, autoHide: false, scale: 1 },
    quote: { open: false, x: 0.82, y: 0.76, autoHide: false, scale: 1 },
    notes: { open: false, x: 0.5, y: 0.56, autoHide: false, scale: 1 },
    // v1.2 spec §3.10: Spotify's spot; both start closed, so they never show together by default.
    deadlines: { open: false, x: 0.82, y: 0.42, autoHide: false, scale: 1 },
  },
  spotifyClientId: '',
  spotifyTokens: null,
  weatherPlace: null,
  weatherUnits: 'celsius',
  weatherCache: null,
  calendarUrls: null,
  calendarCache: null,
  onboarded: false,
  trayNoticeShown: false,
  windowBounds: null,
  miniPos: null,
  countdownPips: true,
  sessionIntention: true,
};

const MAX_STRING = 500;
const WIDGET_IDS: readonly WidgetId[] = [
  'timer',
  'tasks',
  'spotify',
  'calendar',
  'weather',
  'quote',
  'notes',
  'deadlines',
];
const WEATHER_UNITS: readonly WeatherUnits[] = ['celsius', 'fahrenheit'];
/** Longest place name or region kept (a real one is far shorter). */
export const PLACE_TEXT_MAX = 200;
const BUILTIN_CHIMES: readonly string[] = ['bell', 'bowl', 'woodblock', 'marimba', 'digital'];

type Sanitiser = (value: unknown) => unknown;
const NONE = Symbol('invalid');

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A finite number clamped to min..max; integers are rounded. Anything else is invalid. */
const num =
  (min: number, max: number, integer: boolean): Sanitiser =>
  (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NONE;
    return clamp(integer ? Math.round(v) : v, min, max);
  };

const bool: Sanitiser = (v) => (typeof v === 'boolean' ? v : NONE);

const str =
  (allowEmpty: boolean): Sanitiser =>
  (v) =>
    typeof v === 'string' && v.length <= MAX_STRING && (allowEmpty || v.length > 0) ? v : NONE;

const chime: Sanitiser = (v) => {
  if (typeof v !== 'string' || v.length > MAX_STRING) return NONE;
  if (BUILTIN_CHIMES.includes(v)) return v as ChimeId;
  return /^file:\d+$/.test(v) ? (v as ChimeId) : NONE;
};

const soundLevels: Sanitiser = (v) => {
  if (!isRecord(v)) return NONE;
  const out: Record<string, number> = {};
  for (const [key, level] of Object.entries(v)) {
    if (key.length > 64 || typeof level !== 'number' || !Number.isFinite(level)) continue;
    out[key] = clamp(level, 0, 1);
  }
  return out;
};

const widgetPos = (v: unknown): WidgetPos | typeof NONE => {
  if (!isRecord(v)) return NONE;
  const x = num(0, 1, false)(v.x);
  const y = num(0, 1, false)(v.y);
  const open = bool(v.open);
  const autoHide = bool(v.autoHide);
  if (x === NONE || y === NONE || open === NONE || autoHide === NONE) return NONE;
  // A missing or invalid scale reads as 1 (spec §3.5).
  const scale = num(0.5, 2, false)(v.scale);
  const out: WidgetPos = {
    open: open as boolean,
    x: x as number,
    y: y as number,
    autoHide: autoHide as boolean,
    scale: scale === NONE ? 1 : (scale as number),
  };
  // `bare` is kept only when it is a boolean; a missing one reads as absent.
  if (typeof v.bare === 'boolean') out.bare = v.bare;
  return out;
};

/** A partial widgets map: valid entries are kept, the rest dropped. */
const widgets: Sanitiser = (v) => {
  if (!isRecord(v)) return NONE;
  const out: Partial<Record<WidgetId, WidgetPos>> = {};
  for (const id of WIDGET_IDS) {
    if (!(id in v)) continue;
    const pos = widgetPos(v[id]);
    if (pos !== NONE) out[id] = pos;
  }
  return out;
};

const weatherUnits: Sanitiser = (v) =>
  typeof v === 'string' && (WEATHER_UNITS as readonly string[]).includes(v) ? v : NONE;

const placeText = (v: unknown): string | null | typeof NONE => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > PLACE_TEXT_MAX) return NONE;
  return v.trim() === '' ? null : v.trim();
};

const coord = (v: unknown, limit: number): number | typeof NONE =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : NONE;

/**
 * A place for `weather:setPlace` (widgets addendum §3): a name of at most 200 chars, finite
 * latitude (±90) and longitude (±180), optional country and region. Null if anything is off.
 */
export function sanitisePlace(v: unknown): Place | null {
  if (!isRecord(v)) return null;
  const name = placeText(v.name);
  const country = placeText(v.country);
  const admin1 = placeText(v.admin1);
  const latitude = coord(v.latitude, 90);
  const longitude = coord(v.longitude, 180);
  if (
    name === null ||
    name === NONE ||
    country === NONE ||
    admin1 === NONE ||
    latitude === NONE ||
    longitude === NONE
  ) {
    return null;
  }
  return { name, latitude, longitude, country, admin1 };
}

const rect: Sanitiser = (v) => {
  if (v === null) return null;
  if (!isRecord(v)) return NONE;
  const x = num(-100000, 100000, true)(v.x);
  const y = num(-100000, 100000, true)(v.y);
  const width = num(200, 100000, true)(v.width);
  const height = num(200, 100000, true)(v.height);
  if ([x, y, width, height].includes(NONE as never)) return NONE;
  return { x, y, width, height };
};

const point: Sanitiser = (v) => {
  if (v === null) return null;
  if (!isRecord(v)) return NONE;
  const x = num(-100000, 100000, true)(v.x);
  const y = num(-100000, 100000, true)(v.y);
  return x === NONE || y === NONE ? NONE : { x, y };
};

/**
 * Keys `settings:set` never accepts: `activeSpaceId` changes only through `spaces:setActive`,
 * which checks the space exists.
 */
type SetOnlyElsewhere = 'activeSpaceId';

// One entry per key of Settings the renderer may set (spec §3.11 ranges).
const SANITISERS: Record<Exclude<keyof SettingsPatch, SetOnlyElsewhere>, Sanitiser> = {
  focusMinutes: num(1, 180, true),
  shortMinutes: num(1, 180, true),
  longMinutes: num(1, 180, true),
  longEvery: num(1, 12, true),
  autoStartBreaks: bool,
  autoStartFocus: bool,
  chimeFocusEnd: chime,
  chimeBreakEnd: chime,
  chimeVolume: num(0, 1, false),
  chimeRepeat: num(1, 3, true),
  tickLastMinute: bool,
  chimeOnStart: bool,
  notifications: bool,
  streakMinutes: num(1, 1440, true),
  goalMinutes: num(1, 1440, true),
  rolloverHour: num(0, 23, true),
  idleMinutes: num(2, 60, true),
  awayPrompt: bool,
  countdownMinutes: num(1, 240, true),
  autoHideSeconds: num(0, 60, true),
  miniWhenHidden: bool,
  globalHotkey: str(true),
  launchAtStartup: bool,
  soundLevels,
  masterVolume: num(0, 1, false),
  widgets,
  spotifyClientId: str(true),
  weatherUnits,
  onboarded: bool,
  trayNoticeShown: bool,
  windowBounds: rect,
  miniPos: point,
  countdownPips: bool,
  sessionIntention: bool,
};

/**
 * Keeps only known keys with valid values, clamping numbers into their §3.11 ranges.
 * The main-only keys (`spotifyTokens`, `calendarUrls` and the caches), `activeSpaceId` and
 * `weatherPlace` are never accepted. A patch
 * `widgets` entry may name just some widgets; apply it with `mergeSettings`.
 */
export function sanitiseSettingsPatch(patch: unknown): SettingsPatch {
  if (!isRecord(patch)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SANITISERS) as (keyof typeof SANITISERS)[]) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const clean = SANITISERS[key](patch[key]);
    if (clean !== NONE) out[key] = clean;
  }
  return out as SettingsPatch;
}

/** Applies a sanitised patch over stored settings; `widgets` is merged per widget, not replaced. */
export function mergeSettings(stored: Settings, patch: SettingsPatch): Settings {
  return { ...stored, ...patch, widgets: { ...stored.widgets, ...patch.widgets } };
}
