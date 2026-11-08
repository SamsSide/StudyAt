// Settings defaults and the patch sanitiser (spec §3.11). Pure: used by main (validation) and tests.
import type { ChimeId, Settings, SettingsPatch, WidgetId, WidgetPos } from './types';

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
  autoHideSeconds: 5,
  miniWhenHidden: true,
  globalHotkey: 'Ctrl+Alt+P',
  launchAtStartup: false,
  activeSpaceId: null,
  soundLevels: {},
  masterVolume: 0.8,
  widgets: {
    timer: { open: true, x: 0.5, y: 0.12, autoHide: false },
    tasks: { open: false, x: 0.82, y: 0.14, autoHide: false },
    spotify: { open: false, x: 0.18, y: 0.14, autoHide: false },
  },
  spotifyClientId: '',
  spotifyTokens: null,
  onboarded: false,
  trayNoticeShown: false,
  windowBounds: null,
  miniPos: null,
};

const MAX_STRING = 500;
const WIDGET_IDS: readonly WidgetId[] = ['timer', 'tasks', 'spotify'];
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
  (v) => (typeof v === 'string' && v.length <= MAX_STRING && (allowEmpty || v.length > 0) ? v : NONE);

const chime: Sanitiser = (v) => {
  if (typeof v !== 'string' || v.length > MAX_STRING) return NONE;
  if (BUILTIN_CHIMES.includes(v)) return v as ChimeId;
  return /^file:\d+$/.test(v) ? (v as ChimeId) : NONE;
};

const nullableId: Sanitiser = (v) => {
  if (v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : NONE;
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
  return { open: open as boolean, x: x as number, y: y as number, autoHide: autoHide as boolean };
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

// One entry per key of Settings (spec §3.11 ranges).
const SANITISERS: Record<keyof SettingsPatch, Sanitiser> = {
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
  autoHideSeconds: num(0, 60, true),
  miniWhenHidden: bool,
  globalHotkey: str(true),
  launchAtStartup: bool,
  activeSpaceId: nullableId,
  soundLevels,
  masterVolume: num(0, 1, false),
  widgets,
  spotifyClientId: str(true),
  onboarded: bool,
  trayNoticeShown: bool,
  windowBounds: rect,
  miniPos: point,
};

/**
 * Keeps only known keys with valid values, clamping numbers into their §3.11 ranges.
 * `spotifyTokens` is never accepted (main-owned, spec §3.10). A patch `widgets` entry may name
 * just some widgets; apply it with `mergeSettings`.
 */
export function sanitiseSettingsPatch(patch: unknown): SettingsPatch {
  if (!isRecord(patch)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SANITISERS) as (keyof SettingsPatch)[]) {
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
