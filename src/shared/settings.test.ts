import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, sanitiseSettingsPatch } from './settings';
import { SEED_SUBJECTS } from './subjects';

describe('DEFAULT_SETTINGS', () => {
  it('defaults match spec values', () => {
    const d = DEFAULT_SETTINGS;
    expect([d.focusMinutes, d.shortMinutes, d.longMinutes]).toEqual([25, 5, 15]);
    expect(d.longEvery).toBe(4);
    expect([d.autoStartBreaks, d.autoStartFocus]).toEqual([false, false]);
    expect([d.chimeFocusEnd, d.chimeBreakEnd]).toEqual(['bell', 'marimba']);
    expect([d.chimeVolume, d.chimeRepeat]).toEqual([0.7, 1]);
    expect([d.tickLastMinute, d.chimeOnStart]).toEqual([false, false]);
    expect(d.notifications).toBe(true);
    expect(d.streakMinutes).toBe(25);
    expect(d.goalMinutes).toBe(180);
    expect(d.rolloverHour).toBe(4);
    expect(d.idleMinutes).toBe(10);
    expect(d.autoHideSeconds).toBe(5);
    expect(d.miniWhenHidden).toBe(true);
    expect(d.globalHotkey).toBe('Ctrl+Alt+P');
    expect(d.launchAtStartup).toBe(false);
    expect(d.activeSpaceId).toBeNull();
    expect(d.soundLevels).toEqual({});
    expect(d.masterVolume).toBe(0.8);
    expect(d.widgets.timer).toEqual({ open: true, x: 0.5, y: 0.12, autoHide: false });
    expect(d.widgets.tasks.open).toBe(false);
    expect(d.widgets.spotify.open).toBe(false);
    expect([d.spotifyClientId, d.spotifyTokens]).toEqual(['', null]);
    expect([d.onboarded, d.trayNoticeShown]).toEqual([false, false]);
    expect([d.windowBounds, d.miniPos]).toEqual([null, null]);
  });

  it('seeds the six subjects in order', () => {
    expect(SEED_SUBJECTS).toHaveLength(6);
    expect(SEED_SUBJECTS[0]).toEqual({ name: 'COMP2181 Theory of Computation', colour: '#7c9cff' });
    expect(SEED_SUBJECTS[5]?.name).toBe('COMP2281 Software Engineering');
  });
});

describe('sanitiseSettingsPatch', () => {
  it('clamps focusMinutes to 1..180', () => {
    expect(sanitiseSettingsPatch({ focusMinutes: 0 })).toEqual({ focusMinutes: 1 });
    expect(sanitiseSettingsPatch({ focusMinutes: 999 })).toEqual({ focusMinutes: 180 });
    expect(sanitiseSettingsPatch({ focusMinutes: 50 })).toEqual({ focusMinutes: 50 });
  });

  it('drops activeSpaceId: only spaces.setActive changes it, after checking the space exists', () => {
    expect(sanitiseSettingsPatch({ activeSpaceId: 3, focusMinutes: 30 })).toEqual({ focusMinutes: 30 });
    expect(sanitiseSettingsPatch({ activeSpaceId: null })).toEqual({});
  });

  it('drops unknown keys', () => {
    expect(sanitiseSettingsPatch({ nope: 1, focusMinutes: 30, __proto__: { x: 1 } })).toEqual({
      focusMinutes: 30,
    });
  });

  it('clamps rolloverHour to 0..23', () => {
    expect(sanitiseSettingsPatch({ rolloverHour: 30 })).toEqual({ rolloverHour: 23 });
    expect(sanitiseSettingsPatch({ rolloverHour: -2 })).toEqual({ rolloverHour: 0 });
  });

  it('clamps idleMinutes to 2..60 and chimeRepeat to 1..3', () => {
    expect(sanitiseSettingsPatch({ idleMinutes: 1 })).toEqual({ idleMinutes: 2 });
    expect(sanitiseSettingsPatch({ idleMinutes: 61 })).toEqual({ idleMinutes: 60 });
    expect(sanitiseSettingsPatch({ chimeRepeat: 9 })).toEqual({ chimeRepeat: 3 });
  });

  it('clamps volumes to 0..1', () => {
    expect(sanitiseSettingsPatch({ masterVolume: 2, chimeVolume: -1 })).toEqual({
      masterVolume: 1,
      chimeVolume: 0,
    });
  });

  it('drops values of the wrong type', () => {
    expect(sanitiseSettingsPatch({ focusMinutes: '30', notifications: 'yes', chimeFocusEnd: 'gong' })).toEqual({});
    expect(sanitiseSettingsPatch({ focusMinutes: Number.NaN })).toEqual({});
  });

  it('accepts built-in and file chimes', () => {
    expect(sanitiseSettingsPatch({ chimeFocusEnd: 'bowl', chimeBreakEnd: 'file:7' })).toEqual({
      chimeFocusEnd: 'bowl',
      chimeBreakEnd: 'file:7',
    });
  });

  it('sanitises widgets and soundLevels', () => {
    const out = sanitiseSettingsPatch({
      widgets: { timer: { open: false, x: 3, y: -1, autoHide: true } },
      soundLevels: { '1': 2, '2': 0.4, bad: 'x' },
    });
    expect(out.widgets?.timer).toEqual({ open: false, x: 1, y: 0, autoHide: true });
    expect(out.soundLevels).toEqual({ '1': 1, '2': 0.4 });
  });

  it('returns an empty patch for non-objects', () => {
    expect(sanitiseSettingsPatch(null)).toEqual({});
    expect(sanitiseSettingsPatch('x')).toEqual({});
    expect(sanitiseSettingsPatch([1])).toEqual({});
  });

  it('accepts only registered-sound file chimes (file:<soundId>)', () => {
    expect(sanitiseSettingsPatch({ chimeFocusEnd: 'file:12' })).toEqual({ chimeFocusEnd: 'file:12' });
    for (const bad of ['file:C:\\a b.mp3', 'file:', 'file:abc', 'file:7x', 'file:-1']) {
      expect(sanitiseSettingsPatch({ chimeFocusEnd: bad }), bad).toEqual({});
    }
  });

  it('drops spotifyTokens: the renderer never sets them', () => {
    expect(sanitiseSettingsPatch({ spotifyTokens: 'abc', focusMinutes: 30 })).toEqual({ focusMinutes: 30 });
    expect(sanitiseSettingsPatch({ spotifyTokens: null })).toEqual({});
  });
});

describe('mergeSettings', () => {
  it('merges a partial widgets patch', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      focusMinutes: 40,
      widgets: { tasks: { open: true, x: 0.1, y: 0.2, autoHide: true } },
    });
    expect(merged.focusMinutes).toBe(40);
    expect(merged.widgets.tasks).toEqual({ open: true, x: 0.1, y: 0.2, autoHide: true });
    expect(merged.widgets.timer).toEqual(DEFAULT_SETTINGS.widgets.timer);
    expect(merged.widgets.spotify).toEqual(DEFAULT_SETTINGS.widgets.spotify);
  });

  it('does not mutate the stored settings and keeps spotifyTokens', () => {
    const stored = { ...structuredClone(DEFAULT_SETTINGS), spotifyTokens: 'enc' };
    const merged = mergeSettings(stored, { widgets: { timer: { open: false, x: 0, y: 0, autoHide: false } } });
    expect(stored.widgets.timer.open).toBe(true);
    expect(merged.spotifyTokens).toBe('enc');
  });
});
