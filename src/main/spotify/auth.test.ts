import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SpotifyAuth, PortInUseError, type Tokens, type TokenStore } from './auth';
import { authorizeUrl, createPkce, REDIRECT_URI } from './pkce';

// All token strings below are obviously fake.
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function memoryStore(initial: Tokens | null = null): TokenStore & { value: Tokens | null } {
  const s = {
    value: initial,
    load: () => s.value,
    save: (t: Tokens | null) => {
      s.value = t;
    },
  };
  return s;
}

/** A listener stub that answers once openExternal has been given the authorize URL. */
function browserFlow(reply: (q: URLSearchParams) => URLSearchParams) {
  let resolve: (p: URLSearchParams) => void = () => undefined;
  const listen = () => new Promise<URLSearchParams>((r) => (resolve = r));
  const openExternal = (url: string) => resolve(reply(new URL(url).searchParams));
  return { listen, openExternal };
}

describe('pkce', () => {
  it('challenge is base64url sha256 of verifier', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toHaveLength(64);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('authorize url has redirect, scopes, S256 and state', () => {
    const u = new URL(authorizeUrl('fake-client', 'fake-challenge', 'fake-state'));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(REDIRECT_URI).toBe('http://127.0.0.1:43821/callback');
    expect(u.searchParams.get('scope')).toBe(
      'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative',
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe('fake-challenge');
    expect(u.searchParams.get('state')).toBe('fake-state');
    expect(u.searchParams.get('client_id')).toBe('fake-client');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
});

describe('SpotifyAuth.connect', () => {
  function setup(reply: (q: URLSearchParams) => URLSearchParams) {
    const store = memoryStore();
    const fetchMock = vi.fn(async () => json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600 }));
    const auth = new SpotifyAuth({
      fetch: fetchMock as unknown as typeof fetch,
      store,
      now: () => 1_000,
      ...browserFlow(reply),
    });
    return { auth, store, fetchMock };
  }

  it('exchanges the code with the verifier and saves tokens', async () => {
    let challenge = '';
    const { auth, store, fetchMock } = setup((q) => {
      challenge = q.get('code_challenge') ?? '';
      return new URLSearchParams({ code: 'fake-code', state: q.get('state') ?? '' });
    });
    await auth.connect('fake-client');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('fake-code');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(body.get('client_id')).toBe('fake-client');
    const verifier = body.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(store.value).toEqual({ access: 'fake-access', refresh: 'fake-refresh', expiresAt: 1_000 + 3_600_000 });
    expect(auth.status('fake-client')).toEqual({ configured: true, connected: true });
  });

  it('state mismatch rejects', async () => {
    const { auth, store, fetchMock } = setup(() => new URLSearchParams({ code: 'fake-code', state: 'wrong' }));
    await expect(auth.connect('fake-client')).rejects.toThrow(/state/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it('a denied authorisation rejects', async () => {
    const { auth } = setup((q) => new URLSearchParams({ error: 'access_denied', state: q.get('state') ?? '' }));
    await expect(auth.connect('fake-client')).rejects.toThrow(/access_denied/);
  });

  it('PortInUseError surfaces from connect, before the browser opens', async () => {
    const openExternal = vi.fn();
    const auth = new SpotifyAuth({
      fetch: vi.fn() as unknown as typeof fetch,
      store: memoryStore(),
      now: () => 0,
      openExternal,
      listen: () => Promise.reject(new PortInUseError(43821)),
    });
    await expect(auth.connect('fake-client')).rejects.toThrow(
      'Port 43821 is in use — close the other app and retry',
    );
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('SpotifyAuth.accessToken', () => {
  const stored: Tokens = { access: 'fake-old', refresh: 'fake-refresh', expiresAt: 1_000_000 };
  function setup(now: () => number, response: () => Response | Promise<Response>) {
    const store = memoryStore(stored);
    const fetchMock = vi.fn(async () => response());
    const auth = new SpotifyAuth({
      fetch: fetchMock as unknown as typeof fetch,
      store,
      now,
      openExternal: () => undefined,
      listen: async () => new URLSearchParams(),
    });
    auth.setClientId('fake-client');
    return { auth, store, fetchMock };
  }

  it('refreshes 60 s before expiry', async () => {
    let t = 1_000_000 - 61_000;
    const { auth, store, fetchMock } = setup(() => t, () => json({ access_token: 'fake-new', expires_in: 3600 }));
    expect(await auth.accessToken()).toBe('fake-old');
    expect(fetchMock).not.toHaveBeenCalled();
    t = 1_000_000 - 60_000;
    expect(await auth.accessToken()).toBe('fake-new');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('fake-refresh');
    expect(body.get('client_id')).toBe('fake-client');
    expect(store.value?.refresh).toBe('fake-refresh'); // kept when not rotated
    expect(store.value?.expiresAt).toBe(t + 3_600_000);
  });

  it('refresh failure 400 → disconnected and tokens cleared', async () => {
    const { auth, store } = setup(() => 999_999, () => json({ error: 'invalid_grant' }, 400));
    expect(await auth.accessToken()).toBeNull();
    expect(store.value).toBeNull();
    expect(auth.status('fake-client').connected).toBe(false);
  });

  it('a network failure during refresh throws and keeps the tokens', async () => {
    const { auth, store } = setup(() => 999_999, () => Promise.reject(new TypeError('network')));
    await expect(auth.accessToken()).rejects.toThrow();
    expect(store.value).toEqual(stored);
  });

  it('disconnect deletes the tokens; status reports unconfigured for a blank id', () => {
    const { auth, store } = setup(() => 0, () => json({}));
    auth.disconnect();
    expect(store.value).toBeNull();
    expect(auth.status('  ')).toEqual({ configured: false, connected: false });
  });
});
