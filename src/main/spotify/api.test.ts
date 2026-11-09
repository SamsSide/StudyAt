import { describe, expect, it, vi } from 'vitest';
import { SpotifyApi, SpotifyApiError } from './api';
import { SpotifyAuth, type Tokens, type TokenStore } from './auth';

// All token strings below are obviously fake.
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const empty = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(
  handler: Handler,
  tokens: Tokens | null = { access: 'fake-access', refresh: 'fake-refresh', expiresAt: 10_000_000 },
) {
  let t = 0;
  const store: TokenStore & { value: Tokens | null } = {
    value: tokens,
    load: () => store.value,
    save: (v) => {
      store.value = v;
    },
  };
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(String(url), init));
  const f = fetchMock as unknown as typeof fetch;
  const now = () => t;
  const auth = new SpotifyAuth({
    fetch: f,
    store,
    now,
    openExternal: () => undefined,
    listen: async () => new URLSearchParams(),
  });
  auth.setClientId('fake-client');
  const api = new SpotifyApi(auth, f, now);
  return { api, store, fetchMock, advance: (ms: number) => (t += ms) };
}

const playerBody = {
  is_playing: true,
  progress_ms: 5000,
  device: { name: 'Desk' },
  item: {
    name: 'Song',
    duration_ms: 180000,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: { images: [{ url: 'https://img/1' }] },
  },
};

describe('SpotifyApi.nowPlaying', () => {
  it('maps a playing track', async () => {
    const { api, fetchMock } = setup(() => json(playerBody));
    expect(await api.nowPlaying()).toEqual({
      state: 'playing',
      device: 'Desk',
      track: { title: 'Song', artist: 'A, B', artUrl: 'https://img/1', progressMs: 5000, durationMs: 180000 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/player');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fake-access');
  });

  it('maps paused', async () => {
    const { api } = setup(() => json({ ...playerBody, is_playing: false }));
    expect((await api.nowPlaying()).state).toBe('paused');
  });

  it('maps 204 to no-device', async () => {
    const { api } = setup(() => empty(204));
    expect(await api.nowPlaying()).toEqual({ state: 'no-device' });
  });

  it('is disconnected without tokens', async () => {
    const { api, fetchMock } = setup(() => empty(204), null);
    expect(await api.nowPlaying()).toEqual({ state: 'disconnected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 after refresh → disconnected and tokens cleared', async () => {
    const { api, store } = setup((url) =>
      url.includes('/api/token') ? json({ access_token: 'fake-new', expires_in: 3600 }) : empty(401),
    );
    expect(await api.nowPlaying()).toEqual({ state: 'disconnected' });
    expect(store.value).toBeNull();
  });

  it('401 then a good refresh retries once and succeeds', async () => {
    let calls = 0;
    const { api } = setup((url, init) => {
      if (url.includes('/api/token')) return json({ access_token: 'fake-new', expires_in: 3600 });
      calls++;
      return (init.headers as Record<string, string>).Authorization === 'Bearer fake-new'
        ? json(playerBody)
        : empty(401);
    });
    expect((await api.nowPlaying()).state).toBe('playing');
    expect(calls).toBe(2);
  });

  it('429 waits Retry-After before the next call', async () => {
    let n = 0;
    const { api, fetchMock, advance } = setup(() =>
      n++ === 0 ? empty(429, { 'Retry-After': '7' }) : json(playerBody),
    );
    await api.nowPlaying();
    advance(6_999);
    await api.nowPlaying();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(1);
    expect((await api.nowPlaying()).state).toBe('playing');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('200 with no item maps to idle with the device', async () => {
    const { api } = setup(() => json({ is_playing: false, device: { name: 'Desk' }, item: null }));
    expect(await api.nowPlaying()).toEqual({ state: 'idle', device: 'Desk' });
  });

  it('a 429 on the very first poll is not reported as idle', async () => {
    const { api } = setup(() => empty(429, { 'Retry-After': '3' }));
    expect((await api.nowPlaying()).state).toBe('offline');
  });

  it('404 and 403 map to no-device, 500 to offline', async () => {
    expect(await setup(() => empty(404)).api.nowPlaying()).toEqual({ state: 'no-device' });
    expect(await setup(() => empty(403)).api.nowPlaying()).toEqual({ state: 'no-device' });
    expect(await setup(() => empty(500)).api.nowPlaying()).toEqual({ state: 'offline' });
  });

  it('an unparsable 200 body maps to offline instead of throwing', async () => {
    const { api } = setup(() => new Response('not json', { status: 200 }));
    expect(await api.nowPlaying()).toEqual({ state: 'offline' });
  });

  it('network error → offline', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('network')));
    expect(await api.nowPlaying()).toEqual({ state: 'offline' });
  });
});

describe('SpotifyApi controls and lists', () => {
  it('playlists returns first 50', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      uri: `spotify:playlist:p${i}`,
      images: i === 0 ? [{ url: 'https://img/p' }] : [],
    }));
    const { api, fetchMock } = setup(() => json({ items }));
    const lists = await api.playlists();
    expect(lists).toHaveLength(50);
    expect(lists[0]).toEqual({ id: 'p0', name: 'P0', uri: 'spotify:playlist:p0', imageUrl: 'https://img/p' });
    expect(lists[1]?.imageUrl).toBeNull();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('limit=50');
  });

  it('devices maps the list', async () => {
    const { api } = setup(() =>
      json({ devices: [{ id: 'd1', name: 'Desk', type: 'Computer', is_active: true }] }),
    );
    expect(await api.devices()).toEqual([{ id: 'd1', name: 'Desk', type: 'Computer', active: true }]);
  });

  it('sends the right verbs and bodies', async () => {
    const { api, fetchMock } = setup(() => empty(204));
    await api.play();
    await api.pause();
    await api.next();
    await api.previous();
    await api.playContext('spotify:playlist:x');
    await api.transfer('d1');
    const calls = fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit];
      return [init.method, url.replace('https://api.spotify.com/v1', ''), init.body];
    });
    expect(calls).toEqual([
      ['PUT', '/me/player/play', undefined],
      ['PUT', '/me/player/pause', undefined],
      ['POST', '/me/player/next', undefined],
      ['POST', '/me/player/previous', undefined],
      ['PUT', '/me/player/play', JSON.stringify({ context_uri: 'spotify:playlist:x' })],
      ['PUT', '/me/player', JSON.stringify({ device_ids: ['d1'], play: true })],
    ]);
  });

  it('a control call fails with a typed error: 404 no-device, offline, disconnected', async () => {
    await expect(setup(() => empty(404)).api.play()).rejects.toMatchObject({ kind: 'no-device' });
    await expect(setup(() => Promise.reject(new TypeError('x'))).api.pause()).rejects.toBeInstanceOf(
      SpotifyApiError,
    );
    await expect(setup(() => empty(204), null).api.next()).rejects.toMatchObject({ kind: 'disconnected' });
  });

  it('a control call during back-off does not hit the network', async () => {
    const { api, fetchMock } = setup(() => empty(429, { 'Retry-After': '3' }));
    await expect(api.play()).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(api.pause()).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
