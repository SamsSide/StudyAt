import type { SpotifyStatus } from '../../shared/types';
import type { CallbackListener } from './listener';
import { authorizeUrl, CALLBACK_PORT, createPkce, randomState, REDIRECT_URI } from './pkce';

export { PortInUseError } from './listener';
export type { CallbackListener } from './listener';

export interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

/** Persistence is injected; the safeStorage-backed store is Task 10's. */
export interface TokenStore {
  load(): Tokens | null;
  save(t: Tokens | null): void;
}

export interface SpotifyAuthDeps {
  fetch: typeof fetch;
  store: TokenStore;
  now: () => number;
  openExternal(url: string): void;
  listen: CallbackListener;
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REFRESH_MARGIN_MS = 60_000;
const LISTEN_TIMEOUT_MS = 5 * 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class SpotifyAuth {
  private clientId = '';
  private inFlight: Promise<string | null> | null = null;

  constructor(private readonly deps: SpotifyAuthDeps) {}

  /** The refresh grant needs the Client ID; Task 10 sets it from settings at startup. */
  setClientId(clientId: string): void {
    this.clientId = clientId;
  }

  async connect(clientId: string): Promise<void> {
    this.clientId = clientId;
    const { verifier, challenge } = createPkce();
    const state = randomState();
    const waiting = this.deps.listen(CALLBACK_PORT, LISTEN_TIMEOUT_MS);
    waiting.catch(() => undefined); // surfaced by the await below
    // Let a busy port fail before the browser opens.
    await Promise.race([waiting, new Promise<void>((r) => setTimeout(r, 25))]);
    this.deps.openExternal(authorizeUrl(clientId, challenge, state));
    const params = await waiting;
    if (params.get('state') !== state) throw new Error('Spotify sign-in failed: state mismatch');
    const err = params.get('error');
    if (err) throw new Error(`Spotify sign-in was not completed (${err})`);
    const code = params.get('code');
    if (!code) throw new Error('Spotify sign-in failed: no code returned');
    const res = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new Error(`Spotify sign-in failed (${res.status})`);
    const body = (await res.json()) as TokenResponse;
    this.deps.store.save({
      access: body.access_token,
      refresh: body.refresh_token ?? '',
      expiresAt: this.deps.now() + body.expires_in * 1000,
    });
  }

  disconnect(): void {
    this.deps.store.save(null);
  }

  /**
   * A valid access token, refreshing 60 s before expiry. Null when not connected or the
   * refresh was refused (400/401: tokens are then cleared) or no Client ID is set (tokens
   * kept). A network failure, 408/429 or 5xx throws and keeps the tokens so the caller can
   * report "offline".
   */
  async accessToken(): Promise<string | null> {
    const t = this.deps.store.load();
    if (!t) return null;
    if (this.deps.now() < t.expiresAt - REFRESH_MARGIN_MS) return t.access;
    return this.refresh(t);
  }

  /** Forces a refresh (used after a 401). Same contract as `accessToken`. */
  async refreshNow(): Promise<string | null> {
    const t = this.deps.store.load();
    return t ? this.refresh(t) : null;
  }

  status(clientId: string): SpotifyStatus {
    return { configured: clientId.trim().length > 0, connected: this.deps.store.load() !== null };
  }

  /** Single-flight: Spotify rotates refresh tokens, so a second concurrent grant would be refused. */
  private refresh(t: Tokens): Promise<string | null> {
    if (this.clientId.trim() === '') return Promise.resolve(null);
    this.inFlight ??= this.doRefresh(t).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(t: Tokens): Promise<string | null> {
    const res = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refresh,
        client_id: this.clientId,
      }),
    });
    if (res.status === 400 || res.status === 401) {
      this.deps.store.save(null); // the grant was refused
      return null;
    }
    if (!res.ok) throw new Error(`Spotify token service error (${res.status})`);
    const body = (await res.json()) as TokenResponse;
    const next: Tokens = {
      access: body.access_token,
      refresh: body.refresh_token ?? t.refresh,
      expiresAt: this.deps.now() + body.expires_in * 1000,
    };
    this.deps.store.save(next);
    return next.access;
  }
}
