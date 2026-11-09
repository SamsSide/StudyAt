// Settings (spec §3.11): one row per key, the value as JSON. Keys not stored read as their
// `DEFAULT_SETTINGS` value. Main-side: `get` includes the main-only keys (tokens, calendar
// addresses, caches); whoever answers the renderer strips them (spec §3.10, study-dev rule 9).
import { DEFAULT_SETTINGS, mergeSettings } from '../../../shared/settings';
import type { MainOnlySettingsKey, Settings, SettingsPatch } from '../../../shared/types';
import type { Db } from '../db';
import { all, transaction } from '../sql';

/** A sanitised renderer patch, plus the keys only main sets. */
export type MainSettingsPatch = SettingsPatch &
  Partial<Pick<Settings, MainOnlySettingsKey | 'activeSpaceId' | 'weatherPlace'>>;

export interface SettingsRepo {
  get(): Settings;
  /** Merges `patch` (widgets per widget) over the stored settings and persists the keys it names. */
  set(patch: MainSettingsPatch): Settings;
}

const KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export function settingsRepo(db: Db): SettingsRepo {
  const get = (): Settings => {
    const stored: Record<string, unknown> = {};
    for (const row of all(db.raw, 'SELECT key, value FROM settings')) {
      const key = String(row.key);
      if (!KEYS.has(key)) continue;
      try {
        stored[key] = JSON.parse(String(row.value));
      } catch {
        // An unreadable value falls back to its default.
      }
    }
    const widgets = (stored.widgets ?? {}) as Partial<Settings['widgets']>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      widgets: { ...DEFAULT_SETTINGS.widgets, ...widgets },
    } as Settings;
  };

  return {
    get,
    set(patch) {
      const next = mergeSettings(get(), patch);
      const keys = Object.keys(patch).filter((k) => KEYS.has(k)) as (keyof Settings)[];
      transaction(db.raw, () => {
        for (const key of keys) {
          db.raw.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
            key,
            JSON.stringify(next[key]),
          ]);
        }
      });
      db.markDirty();
      return next;
    },
  };
}
