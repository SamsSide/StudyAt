// The full-window background (spec §3.8): local video/image through the media protocol, YouTube
// through the IFrame API, dim overlay and blur. Paused while the window is hidden; under
// reduced motion it stays on a still until Sam presses play on the footer.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Space } from '../../shared/types';
import styles from './spaces.module.css';
import { mediaUrl, useSpacesStore } from './spacesStore';
import { EMBED_BLOCKED, loadYouTubeApi, playerVars, type YTPlayer } from './youtube';

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    on();
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  return online;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const readReduced = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReduced);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function Notice({ children }: { children: ReactNode }) {
  return <div className={styles.notice}>{children}</div>;
}

function Thumb({ space }: { space: Space }) {
  return space.thumb ? <img src={space.thumb} alt="" className={styles.media} /> : null;
}

function LocalVideo({ space, paused }: { space: Space; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { audio, volume, speed } = space.opts;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !audio;
    v.volume = volume;
    v.playbackRate = speed;
  }, [audio, volume, speed]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play()?.catch(() => undefined);
  }, [paused, space.id]);
  return (
    <video
      ref={ref}
      data-testid="space-video"
      src={mediaUrl(space.id)}
      muted={!audio}
      loop
      playsInline
      preload="auto"
      className={styles.media}
    />
  );
}

function YouTubeVideo({ space, paused }: { space: Space; paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const markEmbedError = useSpacesStore((s) => s.markEmbedError);
  const { audio, volume, speed } = space.opts;

  useEffect(() => {
    let dead = false;
    const el = host.current;
    const mount = document.createElement('div');
    el?.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (dead) return;
        player.current = new YT.Player(mount, {
          videoId: space.source,
          playerVars: playerVars(space.source),
          events: {
            onReady: () => {
              if (!dead) setReady(true);
            },
            onError: (e) => {
              if (EMBED_BLOCKED.has(e.data)) markEmbedError(space.id);
            },
          },
        });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      setReady(false);
      player.current?.destroy();
      player.current = null;
      el?.replaceChildren();
    };
  }, [space.id, space.source, markEmbedError]);

  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    if (audio) p.unMute();
    else p.mute();
    p.setVolume(Math.round(volume * 100));
    p.setPlaybackRate(speed);
  }, [ready, audio, volume, speed]);

  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    if (paused) p.pauseVideo();
    else p.playVideo();
  }, [ready, paused]);

  // A 16:9 frame scaled to cover the window.
  return (
    <div
      ref={host}
      data-testid="space-youtube"
      className={styles.youtube}
    />
  );
}

export function SpaceBackground() {
  const spaces = useSpacesStore((s) => s.spaces);
  const activeId = useSpacesStore((s) => s.activeId);
  const loaded = useSpacesStore((s) => s.loaded);
  const embedErrors = useSpacesStore((s) => s.embedErrors);
  const hidden = useHidden();
  const online = useOnline();
  const reduced = useReducedMotion();
  const [playId, setPlayId] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void useSpacesStore.getState().load();
  }, [loaded]);

  const space = spaces.find((s) => s.id === activeId) ?? null;
  const userPlay = space !== null && playId === space.id;

  if (!space) return <div data-testid="space-background" className={styles.bg} />;

  const stillFirst = reduced && !userPlay && space.kind !== 'image';
  const paused = hidden || stillFirst;
  const { dim, blur } = space.opts;

  const relocate = () => void window.studyat.spaces.relocate(space.id).then(useSpacesStore.getState().apply);

  let media: ReactNode;
  if (space.missing) {
    media = (
      <Notice>
        <Thumb space={space} />
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={relocate}>
          File moved — Relocate…
        </button>
      </Notice>
    );
  } else if (space.kind === 'image') {
    media = <img src={mediaUrl(space.id)} alt="" data-testid="space-image" className={styles.media} />;
  } else if (space.kind === 'video') {
    media = stillFirst && space.thumb ? <Thumb space={space} /> : <LocalVideo space={space} paused={paused} />;
  } else if (embedErrors[space.id]) {
    media = (
      <Notice>
        <Thumb space={space} />
        <p>This video can't be embedded.</p>
      </Notice>
    );
  } else if (!online) {
    media = (
      <Notice>
        <Thumb space={space} />
        <p data-testid="space-offline">Offline</p>
      </Notice>
    );
  } else if (stillFirst) {
    media = <Thumb space={space} />;
  } else {
    media = <YouTubeVideo space={space} paused={paused} />;
  }

  return (
    <div data-testid="space-background" className={styles.bg}>
      <div
        className={styles.layer}
        style={{
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
          transform: blur > 0 ? 'scale(1.05)' : undefined,
        }}
      >
        {media}
      </div>
      <div data-testid="space-dim" className={styles.dim} style={{ opacity: dim }} />
      {reduced && space.kind !== 'image' && !space.missing && (
        <div className={styles.footer}>
          <button type="button" className={styles.btn} onClick={() => setPlayId(userPlay ? null : space.id)}>
            {userPlay ? 'Pause background' : 'Play background'}
          </button>
        </div>
      )}
    </div>
  );
}
