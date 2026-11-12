// The full-window background (spec §3.8): local video/image through the media protocol, YouTube
// through the IFrame API, dim overlay and blur. Paused while the window is hidden; under
// reduced motion it stays on a still until Sam presses play on the footer. Sam can also pause it
// (`backgroundPaused`, spec §3.4), which pauses the video's own audio with it.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Space } from '../../shared/types';
import styles from './spaces.module.css';
import { useYouTubeQuality } from './qualityStore';
import { mediaUrl, useSpacesStore } from './spacesStore';
import { useWindowVisibility } from './windowVisibility';
import {
  captionsOff,
  CONFIG_ERRORS,
  EMBED_BLOCKED,
  loadYouTubeApi,
  PERSISTENT_ERRORS,
  playerBox,
  playerVars,
  QUALITY_POLL_MS,
  qualityTarget,
  YOUTUBE_CHROME_CROP,
  type YTPlayer,
} from './youtube';

/** YT.PlayerState.PLAYING. */
const YT_PLAYING = 1;

function useDocumentHidden(): boolean {
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
    const on = (e: Event) => {
      // A video that failed while the connection was down deserves another go once it's back.
      if (e.type === 'online') useSpacesStore.getState().clearPlayErrors();
      setOnline(navigator.onLine);
    };
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
const readReduced = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;

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

/** Size of the window and the device pixel ratio, kept current on resize. */
function useViewport(): { w: number; h: number; dpr: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

function YouTubeVideo({ space, paused }: { space: Space; paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const markEmbedError = useSpacesStore((s) => s.markEmbedError);
  const clearVideoError = useSpacesStore((s) => s.clearVideoError);
  const { audio, volume, speed, quality } = space.opts;
  const viewport = useViewport();
  const report = useYouTubeQuality((s) => s.report);

  useEffect(() => {
    let dead = false;
    // Once this player has played, a later error (often a passing one while it pauses or is torn
    // down on a space switch) is logged but never marks the space as unplayable.
    let played = false;
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
              if (dead) return;
              if (player.current) captionsOff(player.current);
              setReady(true);
            },
            onStateChange: (e) => {
              if (dead) return;
              report({ spaceId: space.id, playing: e.data === YT_PLAYING });
              if (e.data !== YT_PLAYING) return;
              played = true;
              // It is playing, so any earlier mark was wrong.
              clearVideoError(space.id);
              // The player can bring captions back when a looped video starts again.
              if (player.current) captionsOff(player.current);
            },
            // The player reports the level it actually plays, which may sit below the target.
            onPlaybackQualityChange: (e) => {
              if (!dead) report({ spaceId: space.id, level: e.data });
            },
            // 101/150: the owner blocked embedding. 2 bad id, 5 HTML5 player and 100 removed or
            // private still leave a black frame, so they get a message too, but only while the
            // video hasn't played yet. 152/153 are player configuration errors (a missing or
            // bad referrer): they get the play message and are logged. Any other code passes
            // by itself.
            onError: (e) => {
              if (dead) return;
              console.warn('[spaces] YouTube error', e.data);
              if (CONFIG_ERRORS.has(e.data)) {
                console.warn(`[spaces] YouTube player configuration error ${e.data}`);
              }
              if (played || !PERSISTENT_ERRORS.has(e.data)) return;
              markEmbedError(space.id, EMBED_BLOCKED.has(e.data) ? 'embed' : 'play');
            },
          },
        });
      })
      .catch(() => {
        if (!dead) markEmbedError(space.id, 'play');
      });
    return () => {
      dead = true;
      setReady(false);
      player.current?.destroy();
      player.current = null;
      el?.replaceChildren();
      const q = useYouTubeQuality.getState();
      if (q.spaceId === space.id) q.clear();
    };
  }, [space.id, space.source, markEmbedError, clearVideoError, report]);

  // Ask for the target level (spec §3.3); Auto leaves the choice to YouTube.
  useEffect(() => {
    const p = player.current;
    const target = qualityTarget(quality);
    if (!p || !ready || !target) return;
    p.setPlaybackQuality?.(target.level);
  }, [ready, quality]);

  // The badge: read the playing level every few seconds while it plays, and not while paused.
  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    if (paused) {
      report({ spaceId: space.id, playing: false });
      return;
    }
    const read = () => {
      const level = p.getPlaybackQuality?.();
      if (level !== undefined) report({ spaceId: space.id, level });
    };
    const id = setInterval(read, QUALITY_POLL_MS);
    return () => clearInterval(id);
  }, [ready, paused, space.id, report]);

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

  // Auto: a 16:9 frame scaled to cover the window. A target: the player at that many device
  // pixels (so YouTube picks that rendition), scaled down to cover, centred, with the same chrome crop as the CSS rule.
  const box = playerBox(quality, { w: viewport.w, h: viewport.h }, viewport.dpr);
  const style: CSSProperties | undefined = box
    ? {
        width: box.width,
        height: box.height,
        transform: `translate(-50%, -50%) scale(${box.scale * YOUTUBE_CHROME_CROP})`,
      }
    : undefined;
  return <div ref={host} data-testid="space-youtube" className={styles.youtube} style={style} />;
}

export function SpaceBackground() {
  const spaces = useSpacesStore((s) => s.spaces);
  const activeId = useSpacesStore((s) => s.activeId);
  const loaded = useSpacesStore((s) => s.loaded);
  const loadFailed = useSpacesStore((s) => s.loadFailed);
  const embedErrors = useSpacesStore((s) => s.embedErrors);
  const backgroundPaused = useSpacesStore((s) => s.backgroundPaused);
  // Minimised or in the tray: main says so (document.hidden stays false there, see windowVisibility).
  const windowVisible = useWindowVisibility((s) => s.visible);
  const documentHidden = useDocumentHidden();
  const online = useOnline();
  const reduced = useReducedMotion();
  const [playId, setPlayId] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void useSpacesStore.getState().load();
  }, [loaded]);

  const space = spaces.find((s) => s.id === activeId) ?? null;
  const userPlay = space !== null && playId === space.id;

  if (!space)
    return (
      <div data-testid="space-background" className={styles.bg}>
        {loadFailed && !loaded && (
          <div className={styles.notice} role="status">
            <p>Couldn't load your spaces.</p>
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              onClick={() => void useSpacesStore.getState().load()}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );

  const stillFirst = reduced && !userPlay && space.kind !== 'image';
  const paused = !windowVisible || documentHidden || stillFirst || backgroundPaused;
  const { dim, blur } = space.opts;
  const videoError = embedErrors[space.id];

  const relocate = () =>
    void window.studyat.spaces
      .relocate(space.id)
      .then(useSpacesStore.getState().apply)
      .catch(() => undefined);

  // `media` sits under the blur and dim; `notice` (messages, the relocate button) sits above
  // both, so it stays sharp, readable and clickable whatever the space's settings.
  let media: ReactNode;
  let notice: ReactNode = null;
  // Only a space that can actually move gets the reduced-motion play button.
  let playable = space.kind !== 'image' && !space.missing;
  if (space.missing) {
    media = <Thumb space={space} />;
    notice = (
      <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={relocate}>
        File moved — Relocate…
      </button>
    );
  } else if (space.kind === 'image') {
    media = <img src={mediaUrl(space.id)} alt="" data-testid="space-image" className={styles.media} />;
  } else if (space.kind === 'video') {
    media =
      stillFirst && space.thumb ? <Thumb space={space} /> : <LocalVideo space={space} paused={paused} />;
  } else if (videoError === 'embed') {
    media = <Thumb space={space} />;
    notice = <p>This video can't be embedded.</p>;
    playable = false;
  } else if (!online) {
    media = <Thumb space={space} />;
    notice = <p data-testid="space-offline">Offline</p>;
    playable = false;
  } else if (videoError === 'play') {
    media = <Thumb space={space} />;
    notice = <p>This video can't be played.</p>;
    playable = false;
  } else if (stillFirst) {
    media = <Thumb space={space} />;
  } else {
    media = <YouTubeVideo space={space} paused={paused} />;
  }

  return (
    <div data-testid="space-background" className={styles.bg}>
      <div
        data-testid="space-layer"
        className={styles.layer}
        style={{
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
          transform: blur > 0 ? 'scale(1.05)' : undefined,
        }}
      >
        {media}
      </div>
      <div data-testid="space-dim" className={styles.dim} style={{ opacity: dim }} />
      {notice && <div className={styles.notice}>{notice}</div>}
      {reduced && playable && (
        <div className={styles.footer}>
          <button type="button" className={styles.btn} onClick={() => setPlayId(userPlay ? null : space.id)}>
            {userPlay ? 'Pause background' : 'Play background'}
          </button>
        </div>
      )}
    </div>
  );
}
