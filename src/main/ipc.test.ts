import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { DeadlinesView, Note, Task, TimerState } from '../shared/types';
import type { CalendarAgenda, CalendarStatus, Place, WeatherReport } from '../shared/widgets';
import type { Db } from './db/db';
import { sessionsRepo } from './db/repos/sessions';
import { settingsRepo } from './db/repos/settings';
import { NOW, openTestDb, tempDir } from './db/test-helpers';
import {
  createBroadcaster,
  IpcValidationError,
  registerIpc,
  type Dialogs,
  type IpcDeps,
  type SpotifyDeps,
} from './ipc';
import { SpotifyApiError } from './spotify/api';
import { PortInUseError } from './spotify/auth';
import { TimerController } from './timer/controller';
import { FakeClock } from './timer/test-clock';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

let dir: string;
let cleanup: () => void;
let db: Db;
let clock: FakeClock;
let timer: TimerController;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
  clock = new FakeClock(NOW);
  timer = new TimerController({
    db,
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    uuid: () => 'uuid',
    idleSeconds: () => 0,
    emit: { state: () => undefined, away: () => undefined, segmentEnd: () => undefined },
  });
});

afterEach(async () => {
  timer.dispose();
  await db.close();
  cleanup();
});

const DURHAM = {
  name: 'Durham',
  latitude: 54.77,
  longitude: -1.57,
  country: 'United Kingdom',
  admin1: 'England',
};
const ICS = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics';

function widgetFakes() {
  return {
    weather: {
      searchPlaces: vi.fn((_q: string) => Promise.resolve([DURHAM])),
      report: vi.fn((place: Place | null, _cache: WeatherReport | null) =>
        Promise.resolve<WeatherReport>({ state: 'error', place, fetchedAt: null }),
      ),
    },
    calendar: {
      calendars: vi.fn(() => [{ name: 'Lectures', colour: '#7c9cff' }]),
      agenda: vi.fn((_sources: { url: string }[], _cache: CalendarAgenda | null) =>
        Promise.resolve<CalendarAgenda>({ state: 'ok', fetchedAt: NOW, events: [] }),
      ),
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from([...s].reverse().join(''), 'utf8'),
      decryptString: (b: Buffer) => [...b.toString('utf8')].reverse().join(''),
    },
  } satisfies Pick<IpcDeps, 'weather' | 'calendar' | 'safeStorage'>;
}

function spotifyFake() {
  const status = { configured: true, connected: false };
  return {
    api: {
      nowPlaying: vi.fn(() => Promise.resolve({ state: 'idle' as const })),
      play: vi.fn(() => Promise.reject(new SpotifyApiError('no-device', 'No active device'))),
      pause: vi.fn(() => Promise.reject(new SpotifyApiError('disconnected', 'Reconnect Spotify'))),
      next: vi.fn(() => Promise.resolve()),
      previous: vi.fn(() => Promise.resolve()),
      playlists: vi.fn(() => Promise.resolve([])),
      playContext: vi.fn(() => Promise.resolve()),
      devices: vi.fn(() => Promise.resolve([])),
      transfer: vi.fn(() => Promise.resolve()),
    },
    auth: {
      setClientId: vi.fn((_id: string) => undefined),
      connect: vi.fn(() => Promise.reject(new PortInUseError(43821))),
      disconnect: vi.fn(),
      status: vi.fn(() => status),
    },
  } satisfies SpotifyDeps;
}

/** Stands in for Electron's invoke event; tests only compare it by identity. */
const sender = { senderFrame: null } as unknown as IpcMainInvokeEvent;

function setup(overrides: Partial<IpcDeps> = {}) {
  const handlers = new Map<string, Handler>();
  const dialogs: Dialogs = {
    openFiles: vi.fn(() => Promise.resolve<string[]>([])),
    saveFile: vi.fn(() => Promise.resolve<string | null>(null)),
    confirm: vi.fn(() => Promise.resolve(false)),
  };
  const spotify = spotifyFake();
  const onSettingsChanged = vi.fn();
  const widgets = widgetFakes();
  const services = registerIpc({
    ...widgets,
    ipc: { handle: (channel, fn) => void handlers.set(channel, fn) },
    db,
    timer,
    spotify,
    dialogs,
    win: () => null,
    app: { relaunch: vi.fn(), exit: vi.fn() },
    shell: { openPath: vi.fn(() => Promise.resolve('')) },
    paths: { userData: dir, assets: join(dir, 'assets') },
    now: clock.now,
    beforeRestore: () => Promise.resolve(),
    onSettingsChanged,
    ...overrides,
  });
  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve().then(() => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return fn(sender, ...args);
    });
  return { handlers, invoke, dialogs, spotify, onSettingsChanged, services, widgets };
}

describe('registerIpc', () => {
  it('rejects every channel when isTrustedSender says no, passing it the invoke event', async () => {
    const isTrustedSender = vi.fn(() => false);
    const { handlers, invoke } = setup({ isTrustedSender });
    for (const channel of handlers.keys()) await expect(invoke(channel)).rejects.toThrow('Untrusted sender');
    expect(isTrustedSender).toHaveBeenCalledWith(sender);
    expect(timer.getState().status).toBe('idle');
  });

  it('allows a trusted sender, and every sender when isTrustedSender is absent', async () => {
    const trusted = setup({ isTrustedSender: () => true });
    expect(((await trusted.invoke(CHANNELS.timer.get)) as TimerState).status).toBe('idle');
    const open = setup();
    expect(((await open.invoke(CHANNELS.timer.get)) as TimerState).status).toBe('idle');
  });

  it('handles exactly the request channels in CHANNELS', () => {
    const { handlers } = setup();
    const expected = Object.entries(CHANNELS)
      .filter(([group]) => group !== 'events')
      .flatMap(([, methods]) => Object.values(methods) as string[]);
    expect([...handlers.keys()].sort()).toEqual(expected.sort());
  });

  it('app:flushed hands the sending webContents to onFlushed', async () => {
    const onFlushed = vi.fn();
    const ev = { senderFrame: null, sender: { id: 7 } } as unknown as IpcMainInvokeEvent;
    const { handlers } = setup({ onFlushed });
    await handlers.get(CHANNELS.app.flushed)!(ev);
    expect(onFlushed).toHaveBeenCalledWith(ev.sender);
    const untrusted = setup({ onFlushed, isTrustedSender: () => false });
    expect(() => untrusted.handlers.get(CHANNELS.app.flushed)!(ev)).toThrow('Untrusted sender');
    expect(onFlushed).toHaveBeenCalledTimes(1);
  });

  it('rejects non-integer subject id', async () => {
    const { invoke } = setup();
    await expect(invoke(CHANNELS.subjects.update, 1.5, { name: 'x' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.subjects.archive, '1')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.setSubject, 2.5)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.setSubject, 9999)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.updateSession, Number.NaN, { subjectId: null })).rejects.toThrow(
      IpcValidationError,
    );
  });

  it('rejects bad enums and day keys', async () => {
    const { invoke } = setup();
    await expect(invoke(CHANNELS.timer.setMode, 'nap')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.answerAway, 'maybe')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.bySubject, 'year')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.week, '2026-13-45x')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.sessions, { from: 'yesterday' })).rejects.toThrow(IpcValidationError);
  });

  describe('sticky tasks and the timer (simple-tasks spec §3.2, §5)', () => {
    const sticky = async (invoke: (c: string, ...a: unknown[]) => Promise<unknown>, text: string) => {
      const list = (await invoke(CHANNELS.tasks.create, { text, colour: 'yellow' })) as Task[];
      return list.find((t) => t.text === text)!;
    };

    it('tasks.create/update/reorder/clearDone return the full list', async () => {
      const { invoke } = setup();
      expect(await invoke(CHANNELS.tasks.list)).toEqual([]);
      const a = await sticky(invoke, 'Revise trees');
      const afterB = (await invoke(CHANNELS.tasks.create, { text: 'Lab 7', colour: 'pink' })) as Task[];
      expect(afterB.map((t) => [t.text, t.colour, t.done])).toEqual([
        ['Revise trees', 'yellow', false],
        ['Lab 7', 'pink', false],
      ]);
      const b = afterB[1]!;
      const ticked = (await invoke(CHANNELS.tasks.update, a.id, { done: true, colour: 'blue' })) as Task[];
      expect(ticked).toHaveLength(2);
      expect(ticked.find((t) => t.id === a.id)).toMatchObject({ done: true, colour: 'blue', doneAt: NOW });
      const renamed = (await invoke(CHANNELS.tasks.update, b.id, { text: 'Lab 7 write-up' })) as Task[];
      expect(renamed.find((t) => t.id === b.id)?.text).toBe('Lab 7 write-up');
      const reordered = (await invoke(CHANNELS.tasks.reorder, [b.id, a.id])) as Task[];
      expect(reordered.map((t) => t.id)).toEqual([b.id, a.id]);
      const left = (await invoke(CHANNELS.tasks.clearDone)) as Task[];
      expect(left.map((t) => t.id)).toEqual([b.id]);
      expect(await invoke(CHANNELS.tasks.list)).toEqual(left);
    });

    it('tasks:create and tasks:update validate text, colour, done and ids', async () => {
      const { invoke } = setup();
      await expect(invoke(CHANNELS.tasks.create, { text: 'x'.repeat(501), colour: 'yellow' })).rejects.toThrow(
        IpcValidationError,
      );
      await expect(invoke(CHANNELS.tasks.create, { text: '  ', colour: 'yellow' })).rejects.toThrow(
        IpcValidationError,
      );
      await expect(invoke(CHANNELS.tasks.create, { text: 'ok', colour: 'orange' })).rejects.toThrow(
        IpcValidationError,
      );
      await expect(invoke(CHANNELS.tasks.create, 'ok')).rejects.toThrow(IpcValidationError);
      const list = (await invoke(CHANNELS.tasks.create, { text: 'x'.repeat(500), colour: 'yellow' })) as Task[];
      expect(list).toHaveLength(1);
      const id = list[0]!.id;
      await expect(invoke(CHANNELS.tasks.update, id, { text: '' })).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.tasks.update, id, { colour: 'orange' })).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.tasks.update, id, { done: 1 })).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.tasks.update, 1.5, { done: true })).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.tasks.update, 9999, { done: true })).rejects.toThrow('No such task');
      await expect(invoke(CHANNELS.tasks.reorder, 'x')).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.tasks.reorder, [1, 1.5])).rejects.toThrow(IpcValidationError);
      expect(await invoke(CHANNELS.tasks.list)).toMatchObject([{ id, text: 'x'.repeat(500), done: false }]);
    });

    it('timer.setTask snapshots the sticky text and rejects an unknown id with TASK_GONE', async () => {
      const { invoke } = setup();
      const task = await sticky(invoke, 'Revise trees');
      await invoke(CHANNELS.timer.setSubject, null);
      const setTask = vi.spyOn(timer, 'setTask');
      const state = (await invoke(CHANNELS.timer.setTask, task.id)) as TimerState;
      expect(setTask).toHaveBeenLastCalledWith(task.id, 'Revise trees');
      expect(state).toMatchObject({ taskId: task.id, taskText: 'Revise trees', subjectId: null });
      expect(await invoke(CHANNELS.timer.setTask, null)).toMatchObject({ taskId: null, taskText: null });
      expect(setTask).toHaveBeenLastCalledWith(null, null);
      await expect(invoke(CHANNELS.timer.setTask, 'x')).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setTask, 1.5)).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setTask, 9999)).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setTask, 9999)).rejects.toThrow('That task no longer exists.');
      expect(setTask).toHaveBeenCalledTimes(2);
    });

    it('timer:startTask passes the sticky text, never a subject, then starts focus', async () => {
      const { invoke } = setup();
      const task = await sticky(invoke, 'Past paper');
      const before = timer.getState().subjectId;
      const startTask = vi.spyOn(timer, 'startTask');
      const state = (await invoke(CHANNELS.timer.startTask, task.id)) as TimerState;
      expect(startTask).toHaveBeenCalledWith(task.id, 'Past paper');
      expect(state).toMatchObject({ status: 'running', taskId: task.id, taskText: 'Past paper', subjectId: before });
    });

    it('timer:startTask rejects junk and a missing task with the gone copy', async () => {
      const { invoke } = setup();
      await expect(invoke(CHANNELS.timer.startTask, 9999)).rejects.toThrow('That task no longer exists.');
      await expect(invoke(CHANNELS.timer.startTask, null)).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.startTask, 'x')).rejects.toThrow(IpcValidationError);
      expect(timer.getState().status).toBe('idle');
    });

    it('timer:setIntention trims, turns blank into null and rejects 141 characters', async () => {
      const { invoke } = setup();
      expect(await invoke(CHANNELS.timer.setIntention, '  finish ch. 3  ')).toMatchObject({
        intention: 'finish ch. 3',
      });
      expect(await invoke(CHANNELS.timer.setIntention, '  ')).toMatchObject({ intention: null });
      expect(await invoke(CHANNELS.timer.setIntention, 'x'.repeat(140))).toMatchObject({
        intention: 'x'.repeat(140),
      });
      await expect(invoke(CHANNELS.timer.setIntention, 'x'.repeat(141))).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setIntention, 5)).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setIntention)).rejects.toThrow(IpcValidationError);
    });

    it('timer:setOutcome validates the outcome and the pomodoro id', async () => {
      const { invoke } = setup();
      const setOutcome = vi.spyOn(timer, 'setOutcome');
      await invoke(CHANNELS.timer.setOutcome, 'p-1', 'partly');
      expect(setOutcome).toHaveBeenLastCalledWith('p-1', 'partly');
      await invoke(CHANNELS.timer.setOutcome, 'p-1', null);
      expect(setOutcome).toHaveBeenLastCalledWith('p-1', null);
      await expect(invoke(CHANNELS.timer.setOutcome, 'p-1', 'maybe')).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setOutcome, '', 'done')).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.timer.setOutcome, 'x'.repeat(65), 'done')).rejects.toThrow(
        IpcValidationError,
      );
      await expect(invoke(CHANNELS.timer.setOutcome, 7, 'done')).rejects.toThrow(IpcValidationError);
    });

    it('registers no planner, subtask or list channels', () => {
      const { handlers } = setup();
      expect([...handlers.keys()].filter((c) => /^(planner|subtasks|lists):/.test(c))).toEqual([]);
    });
  });

  it('timer:setMode accepts countdown; stats:byTask validates the range', async () => {
    const { invoke } = setup();
    expect(await invoke(CHANNELS.timer.setMode, 'countdown')).toMatchObject({ mode: 'countdown' });
    expect(await invoke(CHANNELS.stats.byTask, 'week')).toEqual([]);
    await expect(invoke(CHANNELS.stats.byTask, 'year')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.byTask)).rejects.toThrow(IpcValidationError);
  });

  describe('images (v1.1 spec §3.6)', () => {
    const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 8, 0, 6, 0, 0, 0, 0, 0]);
    const gifResponse = (): Response =>
      new Response(GIF, { status: 200, headers: { 'content-type': 'image/gif' } });

    it('lists, adds from the dialog, updates, removes, and resolves only registered ids', async () => {
      const src = join(dir, 'pic.gif');
      writeFileSync(src, GIF);
      const { invoke, dialogs, services } = setup();
      expect(await invoke(CHANNELS.images.list)).toEqual([]);
      vi.mocked(dialogs.openFiles).mockResolvedValueOnce([src]);
      const added = (await invoke(CHANNELS.images.addFile)) as { id: number; url: string };
      expect(added.url).toBe(`studyat-media://image/${added.id}`);
      expect(dialogs.openFiles).toHaveBeenLastCalledWith(expect.anything(), false);
      const path = services.resolveMedia('image', added.id)!;
      expect(path).toBe(join(dir, 'images', `${added.id}.gif`));
      expect(existsSync(path)).toBe(true);
      expect(services.resolveMedia('image', added.id + 1)).toBeNull();
      expect(services.resolveMedia('space', added.id)).toBeNull();

      expect(await invoke(CHANNELS.images.update, added.id, { x: 5, scale: 1.5, bare: true })).toMatchObject({
        x: 1,
        scale: 1.5,
        bare: true,
      });
      expect(await invoke(CHANNELS.images.update, 9999, { x: 0.5 })).toBeNull();
      await invoke(CHANNELS.images.remove, added.id);
      expect(existsSync(path)).toBe(false);
      expect(await invoke(CHANNELS.images.list)).toEqual([]);
    });

    it('a cancelled dialog adds nothing and shows no message', async () => {
      const { invoke } = setup();
      expect(await invoke(CHANNELS.images.addFile)).toEqual({ error: '' });
      expect(await invoke(CHANNELS.images.list)).toEqual([]);
    });

    it('addUrl downloads with the injected fetch and validates the link', async () => {
      const fetchFn = vi.fn(() => Promise.resolve(gifResponse()));
      const { invoke } = setup({ fetch: fetchFn as never });
      expect(await invoke(CHANNELS.images.addUrl, 'https://example.com/a.gif')).toMatchObject({
        width: 8,
        height: 6,
      });
      expect(await invoke(CHANNELS.images.addUrl, 'http://example.com/a.gif')).toEqual({
        error: "Couldn't download that link. Check it and your connection.",
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await expect(invoke(CHANNELS.images.addUrl, 5)).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.images.addUrl, '  ')).rejects.toThrow(IpcValidationError);
      await expect(invoke(CHANNELS.images.addUrl, `https://x.test/${'a'.repeat(2048)}`)).rejects.toThrow(
        IpcValidationError,
      );
    });

    it('validates ids and patches before the repo sees them', async () => {
      const { invoke } = setup();
      for (const id of ['1', 1.5, -1, null]) {
        await expect(invoke(CHANNELS.images.remove, id)).rejects.toThrow(IpcValidationError);
        await expect(invoke(CHANNELS.images.update, id, {})).rejects.toThrow(IpcValidationError);
      }
      for (const patch of [
        null,
        [],
        { x: NaN },
        { y: Infinity },
        { x: '0.5' },
        { scale: null },
        { bare: 1 },
        { bare: 'yes' },
      ]) {
        await expect(invoke(CHANNELS.images.update, 1, patch)).rejects.toThrow(IpcValidationError);
      }
    });
  });

  it('timer:start returns TimerState', async () => {
    const { invoke } = setup();
    const state = (await invoke(CHANNELS.timer.start)) as TimerState;
    expect(state).toMatchObject({ mode: 'focus', status: 'running', segmentMs: 25 * 60_000 });
    clock.advance(10_000);
    expect(((await invoke(CHANNELS.timer.get)) as TimerState).remainingMs).toBe(25 * 60_000 - 10_000);
  });

  it('refuses to edit or delete the running session', async () => {
    const { invoke } = setup();
    await invoke(CHANNELS.timer.start);
    const [running] = sessionsRepo(db).listRunning();
    await expect(invoke(CHANNELS.stats.deleteSession, running!.id)).rejects.toThrow('still running');
    await expect(invoke(CHANNELS.stats.updateSession, running!.id, { subjectId: null })).rejects.toThrow(
      'still running',
    );
  });

  it('settings:set sanitises, never accepts or returns tokens, and applies the change', async () => {
    settingsRepo(db).set({ spotifyTokens: 'secret' });
    const { invoke, spotify, onSettingsChanged } = setup();
    const out = (await invoke(CHANNELS.settings.set, {
      focusMinutes: 50,
      spotifyTokens: 'evil',
      spotifyClientId: 'cid',
      bogus: 1,
    })) as Record<string, unknown>;
    expect(out).not.toHaveProperty('spotifyTokens');
    expect(out.focusMinutes).toBe(50);
    expect(settingsRepo(db).get().spotifyTokens).toBe('secret');
    expect(spotify.auth.setClientId).toHaveBeenCalledWith('cid');
    expect(onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ focusMinutes: 50 }), {
      focusMinutes: 50,
      spotifyClientId: 'cid',
    });
    // The idle timer takes the new length at once.
    expect(((await invoke(CHANNELS.timer.get)) as TimerState).segmentMs).toBe(50 * 60_000);
    expect(await invoke(CHANNELS.settings.get)).not.toHaveProperty('spotifyTokens');
    await expect(invoke(CHANNELS.settings.set, 'nope')).rejects.toThrow(IpcValidationError);
  });

  it('spotify: unconfigured before any call, readable control errors, port message unchanged', async () => {
    const { invoke, spotify } = setup();
    expect(await invoke(CHANNELS.spotify.nowPlaying)).toEqual({ state: 'unconfigured' });
    expect(spotify.api.nowPlaying).not.toHaveBeenCalled();
    await expect(invoke(CHANNELS.spotify.connect)).rejects.toThrow('Client ID');

    settingsRepo(db).set({ spotifyClientId: 'cid' });
    expect(await invoke(CHANNELS.spotify.nowPlaying)).toEqual({ state: 'idle' });
    await expect(invoke(CHANNELS.spotify.play)).rejects.toThrow(
      'Open Spotify on any device, then press play',
    );
    await expect(invoke(CHANNELS.spotify.pause)).rejects.toThrow('Reconnect Spotify');
    await expect(invoke(CHANNELS.spotify.connect)).rejects.toThrow(
      'Port 43821 is in use — close the other app and retry',
    );
    await expect(invoke(CHANNELS.spotify.playContext, 'https://open.spotify.com/x')).rejects.toThrow(
      IpcValidationError,
    );
  });

  it('spaces and sounds go through the file dialog; a cancelled relocate changes nothing', async () => {
    const video = join(dir, 'clip.mp4');
    writeFileSync(video, 'x');
    const { invoke, dialogs, services } = setup();
    vi.mocked(dialogs.openFiles).mockResolvedValueOnce([video]);
    const spaces = (await invoke(CHANNELS.spaces.addFiles)) as { id: number; source: string }[];
    const added = spaces.find((s) => s.source === video)!;
    vi.mocked(dialogs.openFiles).mockResolvedValueOnce([]);
    expect(await invoke(CHANNELS.spaces.relocate, added.id)).toEqual(spaces);
    expect(services.resolveMedia('space', added.id)).toBe(video);

    const ding = join(dir, 'ding.wav');
    vi.mocked(dialogs.openFiles).mockResolvedValueOnce([ding]);
    const sounds = (await invoke(CHANNELS.sounds.addFiles)) as { id: number; source: string }[];
    const sound = sounds.find((s) => s.source === ding)!;
    // A `file:<id>` chime is the sound row's file; noise and unknown ids resolve to nothing.
    expect(services.resolveMedia('chime', sound.id)).toBe(ding);
    expect(services.resolveMedia('sound', sounds[0]!.id)).toBeNull();
    expect(services.resolveMedia('space', 9999)).toBeNull();
  });

  it('exports return false when the save dialog is cancelled', async () => {
    const { invoke } = setup();
    expect(await invoke(CHANNELS.data.exportCsv)).toBe(false);
    expect(await invoke(CHANNELS.data.exportJson)).toBe(false);
  });
});

describe('createBroadcaster', () => {
  it('sends to every live target and drops destroyed ones', () => {
    const b = createBroadcaster();
    const live = { isDestroyed: () => false, send: vi.fn() };
    let dead = false;
    const dying = { isDestroyed: () => dead, send: vi.fn() };
    b.add(live);
    const remove = b.add(dying);
    b.send(CHANNELS.events.timerState, 1);
    dead = true;
    b.send(CHANNELS.events.timerState, 2);
    remove();
    expect(live.send).toHaveBeenCalledTimes(2);
    expect(dying.send).toHaveBeenCalledTimes(1);
  });

  it('lists the live targets', () => {
    const b = createBroadcaster<{ id: number; isDestroyed(): boolean; send(): void }>();
    let dead = false;
    const a = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const d = { id: 2, isDestroyed: () => dead, send: vi.fn() };
    b.add(a);
    b.add(d);
    expect(b.live()).toEqual([a, d]);
    dead = true;
    expect(b.live()).toEqual([a]);
  });

  it('weather: validates the query and the place, and never returns the cache', async () => {
    const { invoke, widgets } = setup();
    expect(await invoke(CHANNELS.weather.searchPlaces, ' Durham ')).toEqual([DURHAM]);
    expect(widgets.weather.searchPlaces).toHaveBeenCalledWith('Durham');
    for (const bad of ['a', ' a ', 'x'.repeat(101), 7, null]) {
      await expect(invoke(CHANNELS.weather.searchPlaces, bad), String(bad)).rejects.toThrow(
        IpcValidationError,
      );
    }
    widgets.weather.searchPlaces.mockRejectedValueOnce(new Error('Place search is unavailable right now'));
    await expect(invoke(CHANNELS.weather.searchPlaces, 'Leeds')).rejects.toThrow(
      'Place search is unavailable right now',
    );

    await expect(invoke(CHANNELS.weather.setPlace, { ...DURHAM, latitude: 200 })).rejects.toThrow(
      IpcValidationError,
    );
    await expect(invoke(CHANNELS.weather.setPlace, 'Durham')).rejects.toThrow(IpcValidationError);
    expect(await invoke(CHANNELS.weather.current)).toEqual({
      state: 'unconfigured',
      place: null,
      fetchedAt: null,
    });
    const out = (await invoke(CHANNELS.weather.setPlace, DURHAM)) as Record<string, unknown>;
    expect(out.weatherPlace).toEqual(DURHAM);
    expect(out).not.toHaveProperty('weatherCache');
    expect(await invoke(CHANNELS.weather.current)).toEqual({
      state: 'error',
      place: DURHAM,
      fetchedAt: null,
    });
    expect(
      ((await invoke(CHANNELS.weather.setPlace, null)) as Record<string, unknown>).weatherPlace,
    ).toBeNull();
  });

  it('pushes the public settings after every write the renderer can see, never a secret', async () => {
    settingsRepo(db).set({ spotifyTokens: 'secret' });
    const pushSettings = vi.fn();
    const { invoke, dialogs } = setup({ pushSettings });
    const last = (): Record<string, unknown> =>
      pushSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;

    await invoke(CHANNELS.settings.set, { focusMinutes: 40 });
    expect(pushSettings).toHaveBeenCalledTimes(1);
    expect(last().focusMinutes).toBe(40);

    await invoke(CHANNELS.weather.setPlace, DURHAM);
    expect(pushSettings).toHaveBeenCalledTimes(2);
    expect(last().weatherPlace).toEqual(DURHAM);

    const [space] = (await invoke(CHANNELS.spaces.list)) as { id: number }[];
    await invoke(CHANNELS.spaces.setActive, space!.id);
    expect(pushSettings).toHaveBeenCalledTimes(3);
    expect(last().activeSpaceId).toBe(space!.id);

    const ding = join(dir, 'ding.wav');
    writeFileSync(ding, '');
    vi.mocked(dialogs.openFiles).mockResolvedValueOnce([ding]);
    const sounds = (await invoke(CHANNELS.sounds.addFiles)) as { id: number; source: string }[];
    const sound = sounds.find((s) => s.source === ding);
    await invoke(CHANNELS.settings.set, { chimeFocusEnd: `file:${sound!.id}` });
    await invoke(CHANNELS.sounds.remove, sound!.id);
    expect(pushSettings).toHaveBeenCalledTimes(5);
    expect(last().chimeFocusEnd).toBe(DEFAULT_SETTINGS.chimeFocusEnd);

    for (const [payload] of pushSettings.mock.calls)
      for (const key of ['spotifyTokens', 'calendarUrls', 'calendarCache', 'weatherCache'])
        expect(payload).not.toHaveProperty(key);

    // A read pushes nothing.
    await invoke(CHANNELS.settings.get);
    expect(pushSettings).toHaveBeenCalledTimes(5);
  });

  it('settings:set takes weatherUnits but not the place, the addresses or the caches', async () => {
    const { invoke } = setup();
    const out = (await invoke(CHANNELS.settings.set, {
      weatherUnits: 'fahrenheit',
      weatherPlace: DURHAM,
      calendarUrls: 'evil',
      calendarCache: { state: 'ok', fetchedAt: 1, events: [] },
    })) as Record<string, unknown>;
    expect(out.weatherUnits).toBe('fahrenheit');
    expect(out.weatherPlace).toBeNull();
    for (const key of ['calendarUrls', 'calendarCache', 'weatherCache', 'spotifyTokens'])
      expect(out).not.toHaveProperty(key);
    expect(settingsRepo(db).get().calendarUrls).toBeNull();
  });

  it('calendar: https-only addresses, at most 5 of at most 2000 chars, stored encrypted, never returned', async () => {
    const { invoke, widgets } = setup();
    expect(await invoke(CHANNELS.calendar.status)).toEqual({ configured: false, calendars: [] });
    for (const bad of [
      'nope',
      [ICS.replace('https:', 'http:')],
      ['webcal://example.org/a.ics'],
      ['not a url'],
      [`https://example.org/${'x'.repeat(2000)}`],
      [ICS, ICS, ICS, ICS, ICS, ICS],
      [7],
    ]) {
      await expect(invoke(CHANNELS.calendar.setUrls, bad), JSON.stringify(bad).slice(0, 60)).rejects.toThrow(
        IpcValidationError,
      );
    }
    await expect(invoke(CHANNELS.calendar.setUrls, ['http://example.org/a.ics'])).rejects.toThrow(
      'Calendar addresses must start with https://',
    );
    expect(settingsRepo(db).get().calendarUrls).toBeNull();
    // Padding doesn't count towards the 2000-char limit: the address is trimmed first.
    const padded = `https://example.org/${'x'.repeat(1900)}`;
    await expect(
      invoke(CHANNELS.calendar.setUrls, [`${' '.repeat(300)}${padded}${' '.repeat(300)}`]),
    ).resolves.toMatchObject({ configured: true });
    await invoke(CHANNELS.calendar.setUrls, []);

    const status = (await invoke(CHANNELS.calendar.setUrls, [` ${ICS} `, '', '   '])) as CalendarStatus;
    expect(status).toEqual({ configured: true, calendars: [{ name: 'Calendar', colour: '#7c9cff' }] });
    expect(JSON.stringify(status)).not.toContain('private-abc');
    expect(settingsRepo(db).get().calendarUrls).not.toContain('private-abc');
    expect(await invoke(CHANNELS.calendar.agenda)).toEqual({ state: 'ok', fetchedAt: NOW, events: [] });
    expect(widgets.calendar.agenda).toHaveBeenCalledWith([{ url: ICS }], null);
    expect(((await invoke(CHANNELS.calendar.status)) as CalendarStatus).calendars).toEqual([
      { name: 'Lectures', colour: '#7c9cff' },
    ]);
    expect(await invoke(CHANNELS.settings.get)).not.toHaveProperty('calendarUrls');

    expect(await invoke(CHANNELS.calendar.setUrls, [])).toEqual({ configured: false, calendars: [] });
    expect(settingsRepo(db).get().calendarUrls).toBeNull();
  });

  it('notes: create, update, remove, with ids, colours and the 5000-char limit validated', async () => {
    const { invoke } = setup();
    expect(await invoke(CHANNELS.notes.list)).toEqual([]);
    const [first] = (await invoke(CHANNELS.notes.create)) as Note[];
    expect(first).toMatchObject({ text: '', colour: 'yellow', createdAt: NOW, updatedAt: NOW });
    const two = (await invoke(CHANNELS.notes.create, { colour: 'pink' })) as Note[];
    expect(two.map((n) => n.colour)).toEqual(['yellow', 'pink']);
    await expect(invoke(CHANNELS.notes.create, { colour: 'orange' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.notes.create, 'pink')).rejects.toThrow(IpcValidationError);

    clock.advance(1000);
    const updated = (await invoke(CHANNELS.notes.update, first!.id, {
      text: 'Bring calculator',
      colour: 'blue',
    })) as Note[];
    expect(updated[0]).toMatchObject({ text: 'Bring calculator', colour: 'blue', updatedAt: NOW + 1000 });
    expect(
      ((await invoke(CHANNELS.notes.update, first!.id, { text: 'x'.repeat(5000) })) as Note[])[0]!.text,
    ).toHaveLength(5000);
    await expect(invoke(CHANNELS.notes.update, first!.id, { text: 'x'.repeat(5001) })).rejects.toThrow(
      IpcValidationError,
    );
    await expect(invoke(CHANNELS.notes.update, first!.id, { colour: 'orange' })).rejects.toThrow(
      IpcValidationError,
    );
    await expect(invoke(CHANNELS.notes.update, first!.id, { text: 7 })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.notes.update, 9999, { text: 'x' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.notes.update, 1.5, { text: 'x' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.notes.update, first!.id, null)).rejects.toThrow(IpcValidationError);

    expect(((await invoke(CHANNELS.notes.remove, first!.id)) as Note[]).map((n) => n.colour)).toEqual([
      'pink',
    ]);
    await expect(invoke(CHANNELS.notes.remove, '1')).rejects.toThrow(IpcValidationError);
  });

  it('notes:popOut places the note at the cascade and refuses a 13th with "Up to 12 notes on the screen"', async () => {
    const { invoke } = setup();
    for (let i = 0; i < 13; i++) await invoke(CHANNELS.notes.create);
    const ids = ((await invoke(CHANNELS.notes.list)) as Note[]).map((n) => n.id);
    const first = (await invoke(CHANNELS.notes.popOut, ids[0])) as Note[];
    expect(first[0]).toMatchObject({ popped: true, x: 0.5, y: 0.3 });
    const second = (await invoke(CHANNELS.notes.popOut, ids[1])) as Note[];
    expect(second[1]!.x).toBeCloseTo(0.53);
    expect(second[1]!.y).toBeCloseTo(0.34);
    for (const id of ids.slice(2, 12)) await invoke(CHANNELS.notes.popOut, id);
    await expect(invoke(CHANNELS.notes.popOut, ids[12])).rejects.toThrow('Up to 12 notes on the screen');
    // Docking one back frees a place.
    const docked = (await invoke(CHANNELS.notes.dockBack, ids[0])) as Note[];
    expect(docked[0]!.popped).toBe(false);
    expect(((await invoke(CHANNELS.notes.popOut, ids[12])) as Note[])[12]!.popped).toBe(true);
    for (const channel of [CHANNELS.notes.popOut, CHANNELS.notes.dockBack]) {
      await expect(invoke(channel, 9999)).rejects.toThrow('No such note');
      await expect(invoke(channel, 1.5)).rejects.toThrow(IpcValidationError);
    }
  });

  it('notes:popOut on an already popped note is idempotent, even at the limit', async () => {
    const { invoke } = setup();
    for (let i = 0; i < 12; i++) await invoke(CHANNELS.notes.create);
    const ids = ((await invoke(CHANNELS.notes.list)) as Note[]).map((n) => n.id);
    for (const id of ids) await invoke(CHANNELS.notes.popOut, id);
    const before = (await invoke(CHANNELS.notes.list)) as Note[];
    const again = (await invoke(CHANNELS.notes.popOut, ids[0])) as Note[];
    expect(again).toEqual(before);
  });

  it('notes:update accepts x, y, scale and bare', async () => {
    const { invoke } = setup();
    const [note] = (await invoke(CHANNELS.notes.create)) as Note[];
    const out = (await invoke(CHANNELS.notes.update, note!.id, {
      x: 5,
      y: -1,
      scale: 1.5,
      bare: true,
    })) as Note[];
    expect(out[0]).toMatchObject({ x: 1, y: 0, scale: 1.5, bare: true });
    for (const patch of [{ x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { scale: '2' }, { bare: 1 }])
      await expect(invoke(CHANNELS.notes.update, note!.id, patch)).rejects.toThrow(IpcValidationError);
  });

  it('deadlines channels validate and return the view', async () => {
    const { invoke } = setup();
    const input = { title: '  Calculus exam ', kind: 'exam', subjectId: null, due: '2026-12-01T09:00' };
    const view = (await invoke(CHANNELS.deadlines.create, input)) as DeadlinesView;
    expect(view.upcoming).toHaveLength(1);
    expect(view.upcoming[0]).toMatchObject({ title: 'Calculus exam', kind: 'exam', due: '2026-12-01T09:00' });
    const id = view.upcoming[0]!.id;
    expect(await invoke(CHANNELS.deadlines.list, { past: false })).toHaveLength(1);
    expect(await invoke(CHANNELS.deadlines.list, { past: true })).toEqual([]);
    const done = (await invoke(CHANNELS.deadlines.update, id, { done: true })) as DeadlinesView;
    expect(done.upcoming).toEqual([]);
    expect(done.past).toHaveLength(1);
    for (const bad of [
      { ...input, title: '   ' },
      { ...input, title: 'x'.repeat(121) },
      { ...input, kind: 'quiz' },
      { ...input, due: '2026-12-01 09:00' },
      { ...input, due: '2026-02-30T09:00' },
      { ...input, due: '2026-12-01T24:00' },
      { ...input, note: 'x'.repeat(5001) },
    ])
      await expect(invoke(CHANNELS.deadlines.create, bad)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.create, 'exam')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.update, id, { done: 'yes' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.update, id, null)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.update, 9999, { done: true })).rejects.toThrow('No such deadline');
    await expect(invoke(CHANNELS.deadlines.remove, 1.5)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.list, { past: 'no' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.deadlines.list)).rejects.toThrow(IpcValidationError);
    const gone = (await invoke(CHANNELS.deadlines.remove, id)) as DeadlinesView;
    expect(gone).toEqual({ upcoming: [], past: [] });
  });

  it('statWidgets:add refuses a 7th', async () => {
    const { invoke } = setup();
    const first = (await invoke(CHANNELS.statWidgets.add)) as {
      card: string;
      range: string;
      x: number;
      y: number;
    };
    expect(first).toMatchObject({ card: 'total', range: 'week', x: 0.5, y: 0.3 });
    for (let i = 1; i < 6; i++) await invoke(CHANNELS.statWidgets.add);
    await expect(invoke(CHANNELS.statWidgets.add)).rejects.toThrow('Up to 6 stats widgets');
    expect(await invoke(CHANNELS.statWidgets.list)).toHaveLength(6);
  });

  it('statWidgets:update and remove validate, and reject a missing id', async () => {
    const { invoke } = setup();
    const { id } = (await invoke(CHANNELS.statWidgets.add)) as { id: number };
    expect(
      await invoke(CHANNELS.statWidgets.update, id, {
        card: 'goal',
        range: 'today',
        x: 3,
        scale: 1.5,
        bare: true,
      }),
    ).toMatchObject({ card: 'goal', range: 'today', x: 1, scale: 1.5, bare: true });
    for (const patch of [
      { card: 'pie' },
      { range: 'year' },
      { x: Number.NaN },
      { y: Number.NEGATIVE_INFINITY },
      { scale: '1' },
      { bare: 'true' },
    ])
      await expect(invoke(CHANNELS.statWidgets.update, id, patch)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.statWidgets.update, id, null)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.statWidgets.update, 9999, { x: 0.1 })).rejects.toThrow(
      'No such stats widget',
    );
    await expect(invoke(CHANNELS.statWidgets.remove, 9999)).rejects.toThrow('No such stats widget');
    await expect(invoke(CHANNELS.statWidgets.remove, '1')).rejects.toThrow(IpcValidationError);
    await invoke(CHANNELS.statWidgets.remove, id);
    expect(await invoke(CHANNELS.statWidgets.list)).toEqual([]);
  });

  it('stats:card validates card and range', async () => {
    const { invoke } = setup();
    expect(await invoke(CHANNELS.stats.card, 'total', 'week')).toMatchObject({
      card: 'total',
      range: 'week',
    });
    for (const card of ['total', 'subjects', 'goal'])
      expect(await invoke(CHANNELS.stats.card, card, 'today')).toMatchObject({ card });
    await expect(invoke(CHANNELS.stats.card, 'pie', 'week')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.card, 'estimates', 'week')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.card, 'total', 'year')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.card, 'total')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.card, 7, 'week')).rejects.toThrow(IpcValidationError);
  });
});
