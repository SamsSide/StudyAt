import type { Device, NowPlaying, Playlist } from '../../shared/types';
import type { SpotifyAuth } from './auth';

const BASE = 'https://api.spotify.com/v1';

/** Thrown by the control calls; the widget maps these to its §3.10 states. */
export class SpotifyApiError extends Error {
  constructor(
    readonly kind: 'disconnected' | 'offline' | 'rate-limited' | 'no-device' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

interface SpotifyImage {
  url: string;
}
interface PlayerBody {
  is_playing?: boolean;
  progress_ms?: number | null;
  device?: { name?: string } | null;
  item?: {
    name: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { images?: SpotifyImage[] };
  } | null;
}

export class SpotifyApi {
  private blockedUntil = 0;
  private last: NowPlaying = { state: 'idle' };

  constructor(
    private readonly auth: SpotifyAuth,
    private readonly fetchFn: typeof fetch,
    private readonly now: () => number,
  ) {}

  async nowPlaying(): Promise<NowPlaying> {
    // 429 back-off (spec §3.10): no network call until Retry-After has passed.
    if (this.now() < this.blockedUntil) return this.last;
    let res: Response | null;
    try {
      res = await this.send('GET', '/me/player');
    } catch {
      return (this.last = { state: 'offline' });
    }
    if (!res) return (this.last = { state: 'disconnected' });
    if (res.status === 429) return this.last;
    if (res.status === 204) return (this.last = { state: 'no-device' });
    if (res.status === 401) return (this.last = { state: 'disconnected' });
    if (!res.ok) return (this.last = { state: 'offline' });
    const body = (await res.json()) as PlayerBody;
    const device = body.device?.name;
    if (!body.item) {
      return (this.last = device ? { state: 'idle', device } : { state: 'idle' });
    }
    const track = {
      title: body.item.name,
      artist: (body.item.artists ?? []).map((a) => a.name).join(', '),
      artUrl: body.item.album?.images?.[0]?.url ?? null,
      progressMs: body.progress_ms ?? 0,
      durationMs: body.item.duration_ms,
    };
    const state = body.is_playing ? 'playing' : 'paused';
    return (this.last = device ? { state, track, device } : { state, track });
  }

  play(): Promise<void> {
    return this.command('PUT', '/me/player/play');
  }
  pause(): Promise<void> {
    return this.command('PUT', '/me/player/pause');
  }
  next(): Promise<void> {
    return this.command('POST', '/me/player/next');
  }
  previous(): Promise<void> {
    return this.command('POST', '/me/player/previous');
  }
  playContext(uri: string): Promise<void> {
    return this.command('PUT', '/me/player/play', { context_uri: uri });
  }
  transfer(deviceId: string): Promise<void> {
    return this.command('PUT', '/me/player', { device_ids: [deviceId], play: true });
  }

  /** First 50 of the user's playlists (spec §3.10). */
  async playlists(): Promise<Playlist[]> {
    const body = await this.getJson<{
      items?: { id: string; name: string; uri: string; images?: SpotifyImage[] | null }[];
    }>('/me/playlists?limit=50');
    return (body.items ?? []).slice(0, 50).map((p) => ({
      id: p.id,
      name: p.name,
      uri: p.uri,
      imageUrl: p.images?.[0]?.url ?? null,
    }));
  }

  async devices(): Promise<Device[]> {
    const body = await this.getJson<{
      devices?: { id: string | null; name: string; type: string; is_active: boolean }[];
    }>('/me/player/devices');
    return (body.devices ?? [])
      .filter((d): d is typeof d & { id: string } => d.id !== null)
      .map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active }));
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.call('GET', path);
    return (await res.json()) as T;
  }

  private async command(method: string, path: string, body?: unknown): Promise<void> {
    await this.call(method, path, body);
  }

  /** A successful response, or a `SpotifyApiError` for every failure. */
  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    if (this.now() < this.blockedUntil) throw new SpotifyApiError('rate-limited', 'Rate limited');
    let res: Response | null;
    try {
      res = await this.send(method, path, body);
    } catch {
      throw new SpotifyApiError('offline', 'Spotify is offline');
    }
    if (!res || res.status === 401) throw new SpotifyApiError('disconnected', 'Reconnect Spotify');
    if (res.status === 429) throw new SpotifyApiError('rate-limited', 'Rate limited');
    if (res.status === 404) throw new SpotifyApiError('no-device', 'No active device');
    if (!res.ok) throw new SpotifyApiError('failed', `Spotify request failed (${res.status})`);
    return res;
  }

  /**
   * One authorised request. Null = not connected (or the refresh was refused). A 401 gets
   * one forced refresh and a retry; a second 401 clears the tokens. A 429 records its
   * Retry-After. Network errors throw.
   */
  private async send(method: string, path: string, body?: unknown): Promise<Response | null> {
    let token = await this.auth.accessToken();
    if (!token) return null;
    let res = await this.raw(token, method, path, body);
    if (res.status === 401) {
      token = await this.auth.refreshNow();
      if (!token) return null;
      res = await this.raw(token, method, path, body);
      if (res.status === 401) {
        this.auth.disconnect();
        return res;
      }
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get('Retry-After'));
      this.blockedUntil = this.now() + (Number.isFinite(secs) && secs > 0 ? secs : 1) * 1000;
    }
    return res;
  }

  private raw(token: string, method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetchFn(`${BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}
