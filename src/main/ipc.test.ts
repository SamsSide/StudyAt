import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/ipc';
import type { TimerState } from '../shared/types';
import type { Db } from './db/db';
import { sessionsRepo } from './db/repos/sessions';
import { settingsRepo } from './db/repos/settings';
import { NOW, openTestDb, tempDir } from './db/test-helpers';
import { createBroadcaster, IpcValidationError, registerIpc, type Dialogs, type IpcDeps, type SpotifyDeps } from './ipc';
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
  const services = registerIpc({
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
  return { handlers, invoke, dialogs, spotify, onSettingsChanged, services };
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

  it('rejects non-integer subject id', async () => {
    const { invoke } = setup();
    await expect(invoke(CHANNELS.subjects.update, 1.5, { name: 'x' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.subjects.archive, '1')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.setSubject, 2.5)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.setSubject, 9999)).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.updateSession, Number.NaN, { subjectId: null })).rejects.toThrow(IpcValidationError);
  });

  it('rejects 501-char task text', async () => {
    const { invoke } = setup();
    await expect(invoke(CHANNELS.tasks.create, { text: 'x'.repeat(501), colour: 'yellow' })).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.tasks.create, { text: 'ok', colour: 'orange' })).rejects.toThrow(IpcValidationError);
    const list = (await invoke(CHANNELS.tasks.create, { text: 'x'.repeat(500), colour: 'yellow' })) as unknown[];
    expect(list).toHaveLength(1);
  });

  it('rejects bad enums and day keys', async () => {
    const { invoke } = setup();
    await expect(invoke(CHANNELS.timer.setMode, 'nap')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.timer.answerAway, 'maybe')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.bySubject, 'year')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.week, '2026-13-45x')).rejects.toThrow(IpcValidationError);
    await expect(invoke(CHANNELS.stats.sessions, { from: 'yesterday' })).rejects.toThrow(IpcValidationError);
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
    await expect(invoke(CHANNELS.stats.updateSession, running!.id, { subjectId: null })).rejects.toThrow('still running');
  });

  it('settings:set sanitises, never accepts or returns tokens, and applies the change', async () => {
    settingsRepo(db).set({ spotifyTokens: 'secret' });
    const { invoke, spotify, onSettingsChanged } = setup();
    const out = (await invoke(CHANNELS.settings.set, { focusMinutes: 50, spotifyTokens: 'evil', spotifyClientId: 'cid', bogus: 1 })) as Record<string, unknown>;
    expect(out).not.toHaveProperty('spotifyTokens');
    expect(out.focusMinutes).toBe(50);
    expect(settingsRepo(db).get().spotifyTokens).toBe('secret');
    expect(spotify.auth.setClientId).toHaveBeenCalledWith('cid');
    expect(onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ focusMinutes: 50 }), { focusMinutes: 50, spotifyClientId: 'cid' });
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
    await expect(invoke(CHANNELS.spotify.play)).rejects.toThrow('Open Spotify on any device, then press play');
    await expect(invoke(CHANNELS.spotify.pause)).rejects.toThrow('Reconnect Spotify');
    await expect(invoke(CHANNELS.spotify.connect)).rejects.toThrow('Port 43821 is in use — close the other app and retry');
    await expect(invoke(CHANNELS.spotify.playContext, 'https://open.spotify.com/x')).rejects.toThrow(IpcValidationError);
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
});
