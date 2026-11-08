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
    const tasks = { open: true, x: 0.3, y: 0.4, autoHide: true };
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

  it('ignores unknown or unreadable stored keys', () => {
    db.raw.run("INSERT INTO settings (key, value) VALUES ('oldKey', '1'), ('masterVolume', 'not json')");
    const s = settingsRepo(db).get();
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect('oldKey' in s).toBe(false);
  });
});
