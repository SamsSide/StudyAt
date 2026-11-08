// Spotify widget body (spec §3.10, appplan §4.6). Rendered inside the shell's WidgetFrame.
import { useCallback, useRef, useState } from "react";
import type { Device, NowPlaying, Playlist } from "../../shared/types";
import { useStudyStore } from "../shell/store";
import styles from "./SpotifyWidget.module.css";
import { usePolling } from "./usePolling";

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
  const noDevice = state === "no-device";

  const poll = useCallback(async () => {
    const mine = ++seq.current;
    let np: NowPlaying;
    try {
      np = await window.studyat.spotify.nowPlaying();
    } catch {
      np = { state: "offline" };
    }
    if (mine !== seq.current) return; // a newer poll has already answered
    setPlaying(np);
    const usable =
      np.state === "idle" ||
      np.state === "playing" ||
      np.state === "paused" ||
      np.state === "no-device";
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
    if (np.state === "no-device" || !haveDevices.current) {
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

  const api = () => window.studyat.spotify;
  const openSettings = () =>
    (
      onOpenSettings ?? (() => useStudyStore.getState().setOverlay("settings"))
    )();

  if (playing === null) return <div className={styles.root} aria-busy="true" />;

  if (state === "unconfigured") {
    return (
      <div className={styles.root}>
        <p className={styles.message}>Set up Spotify in Settings</p>
        <button
          type="button"
          className={styles.textButton}
          onClick={openSettings}
        >
          Open settings
        </button>
      </div>
    );
  }
  if (state === "disconnected") {
    return (
      <div className={styles.root}>
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
  if (state === "offline") {
    return (
      <div className={styles.root}>
        <p className={styles.message} role="status">
          Spotify is offline
        </p>
      </div>
    );
  }

  const track = playing.track;
  const pct =
    track && track.durationMs > 0
      ? Math.min(100, (track.progressMs / track.durationMs) * 100)
      : 0;

  return (
    <div className="spotify">
      {noDevice ? (
        <div className="spotify__nodevice">
          <p>Open Spotify on any device, then press play</p>
          <ul aria-label="Devices">
            {devices.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void control(() => api().transfer(d.id))}
                >
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="spotify__track">
          {track?.artUrl ? (
            <img src={track.artUrl} alt="Album art" width={64} height={64} />
          ) : null}
          <div>
            <div className="spotify__title">
              {track?.title ?? "Nothing playing"}
            </div>
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
              <div
                className="spotify__progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="spotify__controls">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => void control(() => api().previous())}
        >
          ⏮
        </button>
        <button
          type="button"
          aria-label={state === "playing" ? "Pause" : "Play"}
          onClick={() =>
            void control(() =>
              state === "playing" ? api().pause() : api().play(),
            )
          }
        >
          ⏯
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => void control(() => api().next())}
        >
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
            value={devices.find((d) => d.active)?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void control(() => api().transfer(id));
            }}
          >
            {!devices.some((d) => d.active) && (
              <option value="">Choose a device</option>
            )}
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
