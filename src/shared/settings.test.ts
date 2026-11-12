import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, sanitisePlace, sanitiseSettingsPatch } from './settings';
import { SEED_SUBJECTS } from './subjects';
import { isFocusMode } from './modes';
import type { Mode, WidgetId } from './types';

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
    expect(d.widgets.timer).toEqual({ open: true, x: 0.5, y: 0.12, autoHide: false, scale: 1 });
    expect(d.widgets.tasks.open).toBe(false);
    expect(d.widgets.spotify.open).toBe(false);
    expect([d.spotifyClientId, d.spotifyTokens]).toEqual(['', null]);
    expect([d.onboarded, d.trayNoticeShown]).toEqual([false, false]);
    expect([d.windowBounds, d.miniPos]).toEqual([null, null]);
  });

  it('adds the widgets addendum keys and closed widgets at their positions', () => {
    const d = DEFAULT_SETTINGS;
    expect(d.widgets.calendar).toEqual({ open: false, x: 0.22, y: 0.46, autoHide: false, scale: 1 });
    expect(d.widgets.weather).toEqual({ open: false, x: 0.22, y: 0.1, autoHide: false, scale: 1 });
    expect(d.widgets.quote).toEqual({ open: false, x: 0.82, y: 0.76, autoHide: false, scale: 1 });
    expect(d.widgets.notes).toEqual({ open: false, x: 0.5, y: 0.56, autoHide: false, scale: 1 });
    expect([d.weatherPlace, d.weatherUnits, d.weatherCache]).toEqual([null, 'celsius', null]);
    expect([d.calendarUrls, d.calendarCache]).toEqual([null, null]);
  });

  it('the default widget spots never overlap each other or the chrome in a 1280 x 800 window', () => {
    // Frame sizes measured in the real app (shots real-2), with room for a configured Calendar
    // (six events), Weather (forecast) and Spotify, and Tasks with two tasks.
    const size: Record<WidgetId, { w: number; h: number }> = {
      timer: { w: 352, h: 333 },
      tasks: { w: 332, h: 250 },
      spotify: { w: 336, h: 210 },
      calendar: { w: 304, h: 390 },
      weather: { w: 320, h: 271 },
      quote: { w: 352, h: 178 },
      notes: { w: 313, h: 329 },
      deadlines: { w: 336, h: 210 },
    };
    const W = 1280;
    const H = 800;
    // Free area: right of the dock (12 + 76 + 12), below the top bar (12 + 52 + 12), 12 px off the edges.
    const area = { left: 100, top: 76, right: W - 12, bottom: H - 12 };
    const rects = (Object.keys(size) as WidgetId[]).map((id) => {
      const { x, y } = DEFAULT_SETTINGS.widgets[id];
      const left = x * W - size[id].w / 2;
      return { id, left, top: y * H, right: left + size[id].w, bottom: y * H + size[id].h };
    });
    for (const r of rects) {
      expect(r.left, r.id).toBeGreaterThanOrEqual(area.left);
      expect(r.top, r.id).toBeGreaterThanOrEqual(area.top);
      expect(r.right, r.id).toBeLessThanOrEqual(area.right);
      expect(r.bottom, r.id).toBeLessThanOrEqual(area.bottom);
    }
    for (const a of rects)
      for (const b of rects) {
        if (a.id >= b.id) continue;
        // Deadlines and Spotify share a spot and are both closed by default (v1.2 spec §3.10).
        if ((a.id === 'deadlines' && b.id === 'spotify') || (a.id === 'spotify' && b.id === 'deadlines'))
          continue;
        const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart, `${a.id} / ${b.id}`).toBe(true);
      }
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
    expect(
      sanitiseSettingsPatch({ focusMinutes: '30', notifications: 'yes', chimeFocusEnd: 'gong' }),
    ).toEqual({});
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
    expect(out.widgets?.timer).toEqual({ open: false, x: 1, y: 0, autoHide: true, scale: 1 });
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

describe('deadlines widget settings', () => {
  it("is closed by default at Spotify's spot", () => {
    expect(DEFAULT_SETTINGS.widgets.deadlines).toEqual({
      open: false,
      x: 0.82,
      y: 0.42,
      autoHide: false,
      scale: 1,
    });
  });

  it('keeps a boolean bare through the sanitiser and reads a missing one as absent', () => {
    const pos = { open: true, x: 0.5, y: 0.5, autoHide: false, scale: 1 };
    expect(
      sanitiseSettingsPatch({ widgets: { deadlines: { ...pos, bare: true } } }).widgets?.deadlines,
    ).toEqual({
      ...pos,
      bare: true,
    });
    const plain = sanitiseSettingsPatch({ widgets: { deadlines: pos } }).widgets?.deadlines;
    expect(plain).toEqual(pos);
    expect(plain).not.toHaveProperty('bare');
    expect(
      sanitiseSettingsPatch({ widgets: { deadlines: { ...pos, bare: 'yes' } } }).widgets?.deadlines,
    ).not.toHaveProperty('bare');
  });
});

describe('widgets addendum settings', () => {
  it('accepts weatherUnits as celsius or fahrenheit only', () => {
    expect(sanitiseSettingsPatch({ weatherUnits: 'fahrenheit' })).toEqual({ weatherUnits: 'fahrenheit' });
    expect(sanitiseSettingsPatch({ weatherUnits: 'kelvin' })).toEqual({});
  });

  it('never accepts the main-only keys or weatherPlace (set through weather.setPlace)', () => {
    const place = {
      name: 'Durham',
      latitude: 54.77,
      longitude: -1.57,
      country: 'United Kingdom',
      admin1: 'England',
    };
    expect(
      sanitiseSettingsPatch({
        calendarUrls: 'blob',
        calendarCache: { state: 'ok', fetchedAt: 1, events: [] },
        weatherCache: { state: 'ok', place, fetchedAt: 1 },
        weatherPlace: place,
        focusMinutes: 30,
      }),
    ).toEqual({ focusMinutes: 30 });
  });

  it('sanitises the new widgets like the old ones', () => {
    const out = sanitiseSettingsPatch({
      widgets: { notes: { open: true, x: 2, y: 0.5, autoHide: false }, bogus: {} },
    });
    expect(out.widgets).toEqual({ notes: { open: true, x: 1, y: 0.5, autoHide: false, scale: 1 } });
  });
});

describe('sanitisePlace', () => {
  const durham = {
    name: 'Durham',
    latitude: 54.77,
    longitude: -1.57,
    country: 'United Kingdom',
    admin1: 'England',
  };

  it('keeps a valid place, trimming the text and nulling blank or missing country and admin1', () => {
    expect(sanitisePlace(durham)).toEqual(durham);
    expect(sanitisePlace({ name: ' Durham ', latitude: 0, longitude: 0, country: '', extra: 1 })).toEqual({
      name: 'Durham',
      latitude: 0,
      longitude: 0,
      country: null,
      admin1: null,
    });
  });

  it('rejects bad shapes, out-of-range or non-finite coordinates and long names', () => {
    for (const bad of [
      null,
      'Durham',
      { ...durham, name: '' },
      { ...durham, name: 'x'.repeat(201) },
      { ...durham, latitude: 91 },
      { ...durham, longitude: -180.5 },
      { ...durham, latitude: Number.NaN },
      { ...durham, longitude: '1' },
      { ...durham, country: 7 },
      { ...durham, admin1: 'x'.repeat(201) },
    ]) {
      expect(sanitisePlace(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(sanitisePlace({ ...durham, name: 'x'.repeat(200) })?.name).toHaveLength(200);
  });
});

describe('mergeSettings', () => {
  it('merges a partial widgets patch', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      focusMinutes: 40,
      widgets: { tasks: { open: true, x: 0.1, y: 0.2, autoHide: true, scale: 1 } },
    });
    expect(merged.focusMinutes).toBe(40);
    expect(merged.widgets.tasks).toEqual({ open: true, x: 0.1, y: 0.2, autoHide: true, scale: 1 });
    expect(merged.widgets.timer).toEqual(DEFAULT_SETTINGS.widgets.timer);
    expect(merged.widgets.spotify).toEqual(DEFAULT_SETTINGS.widgets.spotify);
  });

  it('does not mutate the stored settings and keeps spotifyTokens', () => {
    const stored = { ...structuredClone(DEFAULT_SETTINGS), spotifyTokens: 'enc' };
    const merged = mergeSettings(stored, {
      widgets: { timer: { open: false, x: 0, y: 0, autoHide: false, scale: 1 } },
    });
    expect(stored.widgets.timer.open).toBe(true);
    expect(merged.spotifyTokens).toBe('enc');
  });
});

describe('v1.1 settings and modes', () => {
  it('defaults awayPrompt on and countdown to 60', () => {
    expect(DEFAULT_SETTINGS.awayPrompt).toBe(true);
    expect(DEFAULT_SETTINGS.countdownMinutes).toBe(60);
    for (const pos of Object.values(DEFAULT_SETTINGS.widgets)) expect(pos.scale).toBe(1);
  });
  it('clamps countdownMinutes to 1..240', () => {
    expect(sanitiseSettingsPatch({ countdownMinutes: 0 }).countdownMinutes).toBe(1);
    expect(sanitiseSettingsPatch({ countdownMinutes: 999 }).countdownMinutes).toBe(240);
  });
  it('accepts awayPrompt booleans only', () => {
    expect(sanitiseSettingsPatch({ awayPrompt: false }).awayPrompt).toBe(false);
    expect(sanitiseSettingsPatch({ awayPrompt: 'no' })).toEqual({});
  });
  it('clamps widget scale to 0.5..2 and treats a missing scale as 1', () => {
    const p = sanitiseSettingsPatch({
      widgets: {
        timer: { open: true, x: 0.5, y: 0.1, autoHide: false, scale: 9 },
        tasks: { open: true, x: 0.5, y: 0.1, autoHide: false },
      },
    });
    expect(p.widgets?.timer?.scale).toBe(2);
    expect(p.widgets?.tasks?.scale).toBe(1);
  });
  it('isFocusMode is true for focus and countdown only', () => {
    expect(['focus', 'short', 'long', 'countdown'].map((m) => isFocusMode(m as Mode))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
});

describe('v1.2 settings', () => {
  it('defaults the v1.2 keys (spec §5)', () => {
    expect(DEFAULT_SETTINGS.countdownPips).toBe(true);
    expect(DEFAULT_SETTINGS.rollTasksForward).toBe(false);
    expect(DEFAULT_SETTINGS.sessionIntention).toBe(true);
    expect(DEFAULT_SETTINGS.revisionTags).toEqual(['lecture']);
    expect(DEFAULT_SETTINGS.revisionDays).toEqual([1, 3, 7, 21]);
  });
  it('accepts the three switches as booleans only', () => {
    expect(
      sanitiseSettingsPatch({ countdownPips: false, rollTasksForward: true, sessionIntention: false }),
    ).toEqual({ countdownPips: false, rollTasksForward: true, sessionIntention: false });
    expect(sanitiseSettingsPatch({ rollTasksForward: 'yes' })).toEqual({});
  });
  it('keeps revision tags that match the tag rule, lower-cased, at most 8', () => {
    expect(sanitiseSettingsPatch({ revisionTags: ['Lecture', '#lab', 'bad tag'] }).revisionTags).toEqual([
      'lecture',
      'lab',
    ]);
    expect(sanitiseSettingsPatch({ revisionTags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).toEqual({});
    expect(sanitiseSettingsPatch({ revisionTags: [] }).revisionTags).toEqual([]);
  });
  it('dedupes revision tags after normalising', () => {
    expect(sanitiseSettingsPatch({ revisionTags: ['Lecture', 'lecture', '#lecture'] }).revisionTags).toEqual(['lecture']);
  });
  it('accepts 1–4 revision days of 1–90, sorted and without repeats', () => {
    expect(sanitiseSettingsPatch({ revisionDays: [7, 1, 3, 3] }).revisionDays).toEqual([1, 3, 7]);
    expect(sanitiseSettingsPatch({ revisionDays: [] })).toEqual({});
    expect(sanitiseSettingsPatch({ revisionDays: [1, 2, 3, 4, 5] })).toEqual({});
    expect(sanitiseSettingsPatch({ revisionDays: [0] })).toEqual({});
    expect(sanitiseSettingsPatch({ revisionDays: [91] })).toEqual({});
    expect(sanitiseSettingsPatch({ revisionDays: [1.5] })).toEqual({});
  });
});
