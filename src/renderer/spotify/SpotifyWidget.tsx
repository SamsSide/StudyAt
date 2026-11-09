// Spotify widget body (spec §3.7, appplan §4.6): a now-playing card in the style of the Windows
// media pop-out. Rendered inside the shell's WidgetFrame. Playlists and devices stay in the main
// process API; the widget only lists devices when there is none to play on.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Device, NowPlaying } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './SpotifyWidget.module.css';
import { usePolling } from './usePolling';

const POLL_MS = 3000;
/** Between polls the progress line advances locally at this rate while playing (spec §3.7). */
const TICK_MS = 1000;

export interface SpotifyWidgetProps {
  /** Opens the settings overlay (wired by the app shell). */
  onOpenSettings?: () => void;
}

const asList = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function SpotifyWidget({ onOpenSettings }: SpotifyWidgetProps) {
  // null until the first answer, so no state message flashes on mount.
  const [playing, setPlaying] = useState<NowPlaying | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  // Seconds ticked locally since an answer, tagged with that answer: a newer answer starts at
  // zero, and a stray tick from the previous answer's interval is dropped.
  const [tick, setTick] = useState<{ of: NowPlaying | null; n: number }>({ of: null, n: 0 });
  const state = playing?.state ?? null;
  const seq = useRef(0);
  const noDevice = state === 'no-device';
  const isPlaying = state === 'playing';

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
    // Devices refresh on every poll while there is no device (Sam may just have opened Spotify).
    if (np.state === 'no-device') {
      window.studyat.spotify
        .devices()
        .then((d) => setDevices(asList(d)))
        .catch(() => undefined);
    }
  }, []);

  usePolling(poll, POLL_MS, true);

  // A fresh interval per answer, so the ticks line up with the progress Spotify just reported.
  useEffect(() => {
    if (!isPlaying) return undefined;
    const answer = playing;
    const timer = setInterval(
      () => setTick((t) => ({ of: answer, n: t.of === answer ? t.n + 1 : 1 })),
      TICK_MS,
    );
    return () => clearInterval(timer);
  }, [playing, isPlaying]);
  const ticks = tick.of === playing ? tick.n : 0;

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
  const progressMs = track
    ? Math.min(track.durationMs, track.progressMs + (isPlaying ? ticks * TICK_MS : 0))
    : 0;
  const pct = track && track.durationMs > 0 ? Math.min(100, (progressMs / track.durationMs) * 100) : 0;
  const title = track?.title ?? 'Nothing playing';

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
            <img className={styles.art} src={track.artUrl} alt="Album art" width={64} height={64} />
          ) : (
            <div className={styles.art} aria-hidden="true">
              <Glyph name="note" />
            </div>
          )}
          <div className={styles.meta}>
            <div className={styles.title} title={title}>
              {title}
            </div>
            {track && (
              <div className={styles.artist} title={track.artist}>
                {track.artist}
              </div>
            )}
          </div>
          {track && (
            <div
              role="progressbar"
              aria-label="Track progress"
              aria-valuemin={0}
              aria-valuemax={track.durationMs}
              aria-valuenow={progressMs}
              aria-valuetext={`${clock(progressMs)} of ${clock(track.durationMs)}`}
              className={styles.progress}
            >
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
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
    </div>
  );
}

/** Track time as m:ss for the progress bar's spoken value. */
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
