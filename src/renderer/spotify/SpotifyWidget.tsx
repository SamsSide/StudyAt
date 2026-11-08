// Spotify widget body (spec §3.10, appplan §4.6). Rendered inside the shell's WidgetFrame.
import { useCallback, useEffect, useState } from 'react';
import type { Device, NowPlaying, Playlist } from '../../shared/types';
import { usePolling } from './usePolling';

const POLL_MS = 3000;

export interface SpotifyWidgetProps {
  /** Opens the settings overlay (wired by the app shell). */
  onOpenSettings?: () => void;
}

const asList = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function SpotifyWidget({ onOpenSettings }: SpotifyWidgetProps) {
  const [playing, setPlaying] = useState<NowPlaying>({ state: 'unconfigured' });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const state = playing.state;

  const poll = useCallback(async () => {
    try {
      setPlaying(await window.studyat.spotify.nowPlaying());
    } catch {
      setPlaying({ state: 'offline' });
    }
  }, []);

  usePolling(poll, POLL_MS, true);

  const usable = state === 'idle' || state === 'playing' || state === 'paused' || state === 'no-device';
  const noDevice = state === 'no-device';

  useEffect(() => {
    if (!usable) return;
    window.studyat.spotify
      .playlists()
      .then((l) => setPlaylists(asList(l).slice(0, 50)))
      .catch(() => undefined);
  }, [usable]);

  // Refetch devices when the no-device state flips, so the list is fresh when it matters.
  useEffect(() => {
    if (!usable) return;
    window.studyat.spotify
      .devices()
      .then((d) => setDevices(asList(d)))
      .catch(() => undefined);
  }, [usable, noDevice]);

  /** Runs a control call; a rejection is swallowed and the re-poll shows the real state. */
  const control = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch {
      /* main maps errors */
    }
    await poll();
  };

  const api = () => window.studyat.spotify;

  if (state === 'unconfigured') {
    return (
      <div className="spotify spotify--unconfigured">
        <p>Set up Spotify in Settings</p>
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings}>
            Open settings
          </button>
        )}
      </div>
    );
  }
  if (state === 'disconnected') {
    return (
      <div className="spotify spotify--disconnected">
        <button type="button" onClick={() => void control(() => api().connect())}>
          Reconnect Spotify
        </button>
      </div>
    );
  }
  if (state === 'offline') {
    return (
      <div className="spotify spotify--offline">
        <p role="status">Spotify is offline</p>
      </div>
    );
  }

  const track = playing.track;
  const pct = track && track.durationMs > 0 ? Math.min(100, (track.progressMs / track.durationMs) * 100) : 0;

  return (
    <div className="spotify">
      {noDevice ? (
        <div className="spotify__nodevice">
          <p>Open Spotify on any device, then press play</p>
          <ul aria-label="Devices">
            {devices.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => void control(() => api().transfer(d.id))}>
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="spotify__track">
          {track?.artUrl ? <img src={track.artUrl} alt="Album art" width={64} height={64} /> : null}
          <div>
            <div className="spotify__title">{track?.title ?? 'Nothing playing'}</div>
            {track && <div className="spotify__artist">{track.artist}</div>}
          </div>
          {track && (
            <div
              role="progressbar"
              aria-label="Track progress"
              aria-valuemin={0}
              aria-valuemax={track.durationMs}
              aria-valuenow={track.progressMs}
              className="spotify__progress"
            >
              <div className="spotify__progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="spotify__controls">
        <button type="button" aria-label="Previous" onClick={() => void control(() => api().previous())}>
          ⏮
        </button>
        <button
          type="button"
          aria-label={state === 'playing' ? 'Pause' : 'Play'}
          onClick={() => void control(() => (state === 'playing' ? api().pause() : api().play()))}
        >
          ⏯
        </button>
        <button type="button" aria-label="Next" onClick={() => void control(() => api().next())}>
          ⏭
        </button>
      </div>

      <label>
        Playlist
        <select
          value=""
          onChange={(e) => {
            const uri = e.target.value;
            if (uri) void control(() => api().playContext(uri));
          }}
        >
          <option value="">Choose a playlist</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.uri}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {!noDevice && devices.length > 0 && (
        <label>
          Device
          <select
            value={devices.find((d) => d.active)?.id ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void control(() => api().transfer(id));
            }}
          >
            {!devices.some((d) => d.active) && <option value="">Choose a device</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
