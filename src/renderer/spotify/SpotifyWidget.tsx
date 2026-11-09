// Spotify widget body (spec §3.10, appplan §4.6). Rendered inside the shell's WidgetFrame.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Device, NowPlaying, Playlist } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './SpotifyWidget.module.css';
import { usePolling } from './usePolling';

const POLL_MS = 3000;

export interface SpotifyWidgetProps {
  /** Opens the settings overlay (wired by the app shell). */
  onOpenSettings?: () => void;
}

const asList = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function SpotifyWidget({ onOpenSettings }: SpotifyWidgetProps) {
  // null until the first answer, so no state message flashes on mount.
  const [playing, setPlaying] = useState<NowPlaying | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const state = playing?.state ?? null;
  const seq = useRef(0);
  const haveDevices = useRef(false);
  const havePlaylists = useRef(false);
  const noDevice = state === 'no-device';

  const poll = useCallback(async () => {
    const mine = ++seq.current;
    let np: NowPlaying;
    try {
      np = await window.studyat.spotify.nowPlaying();
    } catch {
      np = { state: 'offline' };
    }
    if (mine !== seq.current) return; // a newer poll has already answered
    setPlaying(np);
    const usable =
      np.state === 'idle' || np.state === 'playing' || np.state === 'paused' || np.state === 'no-device';
    if (!usable) return;
    // Playlists are retried on later polls until one load succeeds with something to show.
    if (!havePlaylists.current) {
      window.studyat.spotify
        .playlists()
        .then((l) => {
          const list = asList(l).slice(0, 50);
          if (list.length > 0) havePlaylists.current = true;
          setPlaylists(list);
        })
        .catch(() => undefined);
    }
    // Devices refresh on every poll while there is no device (Sam may just have opened Spotify).
    if (np.state === 'no-device' || !haveDevices.current) {
      window.studyat.spotify
        .devices()
        .then((d) => {
          haveDevices.current = true;
          setDevices(asList(d));
        })
        .catch(() => undefined);
    }
  }, []);

  usePolling(poll, POLL_MS, true);

  /** Runs a control call; a rejection is swallowed and the re-poll shows the real state. */
  const control = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch {
      /* main maps errors */
    }
    await poll();
  };

  /** A transport button: does nothing while there is no device to play on. */
  const transport = (call: () => Promise<unknown>) => (noDevice ? Promise.resolve() : control(call));

  const api = () => window.studyat.spotify;
  const openSettings = () => (onOpenSettings ?? (() => useStudyStore.getState().setOverlay('settings')))();

  if (playing === null) return <div className={styles.root} aria-busy="true" />;

  if (state === 'unconfigured') {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message}>Set up Spotify in Settings</p>
        <button type="button" className={styles.textButton} onClick={openSettings}>
          Open settings
        </button>
      </div>
    );
  }
  if (state === 'disconnected') {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void control(() => api().connect())}
        >
          Reconnect Spotify
        </button>
      </div>
    );
  }
  if (state === 'offline') {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message} role="status">
          Spotify is offline
        </p>
      </div>
    );
  }

  const track = playing.track;
  const pct = track && track.durationMs > 0 ? Math.min(100, (track.progressMs / track.durationMs) * 100) : 0;
  const isPlaying = state === 'playing';

  return (
    <div className={styles.root}>
      {noDevice ? (
        <div className={styles.noDevice}>
          <StateIcon />
          <p className={styles.message}>Open Spotify on any device, then press play</p>
          {devices.length > 0 && (
            <ul className={styles.deviceList} aria-label="Devices">
              {devices.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => void control(() => api().transfer(d.id))}
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className={styles.track}>
          {track?.artUrl ? (
            <img className={styles.art} src={track.artUrl} alt="Album art" width={56} height={56} />
          ) : (
            <div className={styles.art} aria-hidden="true">
              <Glyph name="note" />
            </div>
          )}
          <div className={styles.meta}>
            <div className={styles.title}>{track?.title ?? 'Nothing playing'}</div>
            {track && <div className={styles.artist}>{track.artist}</div>}
          </div>
          {track && (
            <div className={styles.timeline}>
              <div
                role="progressbar"
                aria-label="Track progress"
                aria-valuemin={0}
                aria-valuemax={track.durationMs}
                aria-valuenow={track.progressMs}
                aria-valuetext={`${clock(track.progressMs)} of ${clock(track.durationMs)}`}
                className={styles.progress}
              >
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
              </div>
              <div className={styles.times} aria-hidden="true">
                <span>{clock(track.progressMs)}</span>
                <span>{clock(track.durationMs)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* With no device there is nothing to control: the transport stays in place, dimmed and
          marked unavailable, so the layout doesn't jump when a device appears. */}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Previous"
          aria-disabled={noDevice || undefined}
          onClick={() => void transport(() => api().previous())}
        >
          <Glyph name="previous" />
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.primary}`}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-disabled={noDevice || undefined}
          onClick={() => void transport(() => (isPlaying ? api().pause() : api().play()))}
        >
          <Glyph name={isPlaying ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Next"
          aria-disabled={noDevice || undefined}
          onClick={() => void transport(() => api().next())}
        >
          <Glyph name="next" />
        </button>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Playlist</span>
        <span className={styles.selectWrap}>
          <select
            className={styles.select}
            value=""
            disabled={noDevice}
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
        </span>
      </label>

      {!noDevice && devices.length > 0 && (
        <label className={styles.field}>
          <span className={styles.label}>Device</span>
          <span className={styles.selectWrap}>
            <select
              className={styles.select}
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
          </span>
        </label>
      )}
    </div>
  );
}

/** Track time as m:ss for the progress labels. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`;
}

type GlyphName = 'previous' | 'play' | 'pause' | 'next' | 'note';

// Drawn in the shell's icon style (24-unit grid, 1.75 stroke); the transport shapes are filled.
const GLYPHS: Record<GlyphName, ReactNode> = {
  previous: (
    <>
      <path d="M6 5.5v13" />
      <path d="M18 6.5v11L9.5 12z" fill="currentColor" />
    </>
  ),
  play: <path d="M8.5 5.5v13L19 12z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
      <rect x="14" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <path d="M18 5.5v13" />
      <path d="M6 6.5v11l8.5-5.5z" fill="currentColor" />
    </>
  ),
  note: (
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
};

function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg
      className={styles.glyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** The quiet note shown above a state message. */
function StateIcon() {
  return (
    <span className={styles.stateIcon} aria-hidden="true">
      <Glyph name="note" />
    </span>
  );
}
