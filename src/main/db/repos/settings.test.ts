import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { Db } from '../db';
import { openTestDb, tempDir } from '../test-helpers';
import { settingsRepo } from './settings';

describe('settingsRepo', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir);
  });
  afterEach(async () => {
    await db.close();
    cleanup();
  });

  it('returns the defaults with the seeded active space', () => {
    const s = settingsRepo(db).get();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, activeSpaceId: s.activeSpaceId });
    expect(s.activeSpaceId).toEqual(expect.any(Number));
  });

  it('merges a patch, deep-merging widgets, and persists across reopen', async () => {
    const repo = settingsRepo(db);
    const markDirty = vi.spyOn(db, 'markDirty');
    const tasks = { open: true, x: 0.3, y: 0.4, autoHide: true, scale: 1 };
    const next = repo.set({ focusMinutes: 50, widgets: { tasks } });
    expect(markDirty).toHaveBeenCalled();
    expect(next.focusMinutes).toBe(50);
    expect(next.widgets).toEqual({ ...DEFAULT_SETTINGS.widgets, tasks });
    expect(repo.get()).toEqual(next);
    await db.close();
    db = await openTestDb(dir);
    expect(settingsRepo(db).get()).toEqual(next);
  });

  it('stores and clears the Spotify tokens', () => {
    const repo = settingsRepo(db);
    expect(repo.set({ spotifyTokens: 'ZW5jcnlwdGVk' }).spotifyTokens).toBe('ZW5jcnlwdGVk');
    expect(repo.get().spotifyTokens).toBe('ZW5jcnlwdGVk');
    expect(repo.set({ spotifyTokens: null }).spotifyTokens).toBeNull();
    expect(repo.get().spotifyTokens).toBeNull();
  });

  it('stores the main-only widget keys and fills new widgets into an older stored widgets map', () => {
    const repo = settingsRepo(db);
    // Settings saved before the widgets addendum: three widgets only.
    db.raw.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('widgets', ?)", [
      JSON.stringify({
        timer: { open: false, x: 0.4, y: 0.1, autoHide: false },
        tasks: DEFAULT_SETTINGS.widgets.tasks,
        spotify: DEFAULT_SETTINGS.widgets.spotify,
      }),
    ]);
    const s = repo.get();
    expect(s.widgets.timer.open).toBe(false);
    expect(s.widgets.notes).toEqual(DEFAULT_SETTINGS.widgets.notes);
    expect(s.weatherUnits).toBe('celsius');
    const next = repo.set({
      calendarUrls: 'ZW5j',
      calendarCache: { state: 'ok', fetchedAt: 1, events: [] },
      weatherCache: null,
    });
    expect(next.calendarUrls).toBe('ZW5j');
    expect(repo.get().calendarCache).toEqual({ state: 'ok', fetchedAt: 1, events: [] });
  });

  it('ignores unknown or unreadable stored keys', () => {
    db.raw.run("INSERT INTO settings (key, value) VALUES ('oldKey', '1'), ('masterVolume', 'not json')");
    const s = settingsRepo(db).get();
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect('oldKey' in s).toBe(false);
  });

  it('merges a stored widget without scale per field', () => {
    db.raw.run('INSERT INTO settings (key, value) VALUES (?, ?)', [
      'widgets',
      JSON.stringify({ timer: { open: false, x: 0.3, y: 0.2, autoHide: true } }),
    ]);
    expect(settingsRepo(db).get().widgets.timer).toEqual({
      open: false,
      x: 0.3,
      y: 0.2,
      autoHide: true,
      scale: 1,
    });
  });
});
