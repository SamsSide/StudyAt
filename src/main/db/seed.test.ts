import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { SEED_SUBJECTS } from '../../shared/subjects';
import type { Db } from './db';
import { settingsRepo } from './repos/settings';
import { soundsRepo } from './repos/sounds';
import { spacesRepo } from './repos/spaces';
import { subjectsRepo } from './repos/subjects';
import { seedIfEmpty, type BuiltinAssets } from './seed';
import { all } from './sql';
import { BUILTIN_PATH, NOW, openTestDb, tempDir } from './test-helpers';

const builtin = JSON.parse(readFileSync(BUILTIN_PATH, 'utf8')) as BuiltinAssets;

describe('seedIfEmpty', () => {
  let dir: string;
  let cleanup: () => void;
  let db: Db;

  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = await openTestDb(dir); // openDatabase seeds once already
  });
  afterEach(async () => {
    await db.close();
    cleanup();
  });

  it('seeds six subjects in spec order and built-ins once', () => {
    seedIfEmpty(db, builtin, NOW + 1000);
    seedIfEmpty(db, builtin, NOW + 2000);
    const subjects = subjectsRepo(db).list();
    expect(subjects.map((s) => ({ name: s.name, colour: s.colour }))).toEqual(SEED_SUBJECTS);
    expect(subjects.map((s) => s.sort)).toEqual([0, 1, 2, 3, 4, 5]);

    const spaces = spacesRepo(db).list();
    expect(spaces).toHaveLength(builtin.spaces.length);
    expect(spaces.every((s) => s.builtin && !s.favourite && !s.missing)).toBe(true);
    expect(spaces[0]).toMatchObject({
      kind: 'youtube',
      name: 'Rain on the window',
      source: 'WDR-5eFoxuQ',
      thumb: 'https://i.ytimg.com/vi/WDR-5eFoxuQ/hqdefault.jpg',
      opts: { audio: false, volume: 0.5, speed: 1, dim: 0.15, blur: 0 },
      createdAt: NOW,
    });
    expect(spaces.find((s) => s.kind === 'image')).toMatchObject({
      source: 'images/forest-path.jpg',
      thumb: null,
    });

    const sounds = soundsRepo(db).list();
    expect(sounds.map((s) => s.name)).toEqual(builtin.sounds.map((s) => s.name));
    expect(sounds.every((s) => s.builtin)).toBe(true);
    expect(sounds[3]).toMatchObject({ kind: 'file', source: 'sounds/rain.ogg', sort: 3 });

    expect(settingsRepo(db).get().activeSpaceId).toBe(spaces[0]!.id);
  });

  it('keeps a chosen active space', () => {
    const spaces = spacesRepo(db).list();
    settingsRepo(db).set({ activeSpaceId: spaces[2]!.id });
    seedIfEmpty(db, builtin, NOW);
    expect(settingsRepo(db).get().activeSpaceId).toBe(spaces[2]!.id);
  });

  it('seeds a table again only when it is empty', () => {
    db.raw.run('DELETE FROM sounds');
    seedIfEmpty(db, builtin, NOW);
    expect(soundsRepo(db).list()).toHaveLength(builtin.sounds.length);
    expect(subjectsRepo(db).list()).toHaveLength(6);
  });
  // R17: accounting-relevant defaults are stored at first seed, so a later change to
  // DEFAULT_SETTINGS can never silently change Sam's numbers.
  it('stores the accounting and timer defaults explicitly', () => {
    const pinned = [
      'focusMinutes',
      'shortMinutes',
      'longMinutes',
      'longEvery',
      'streakMinutes',
      'goalMinutes',
      'rolloverHour',
      'idleMinutes',
    ] as const;
    const stored = new Map(
      all(db.raw, 'SELECT key, value FROM settings').map((r) => [
        String(r.key),
        JSON.parse(String(r.value)) as unknown,
      ]),
    );
    for (const key of pinned) expect(stored.get(key), key).toBe(DEFAULT_SETTINGS[key]);
  });

  it('never overwrites a stored setting when seeding again', () => {
    settingsRepo(db).set({ focusMinutes: 50, rolloverHour: 5 });
    seedIfEmpty(db, builtin, NOW);
    expect(settingsRepo(db).get()).toMatchObject({ focusMinutes: 50, rolloverHour: 5, streakMinutes: 25 });
  });
});
