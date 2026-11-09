// Lazy loader and thin typing for the YouTube IFrame API (spec §3.8). The script host is allowed
// by the CSP; the API is fetched once, on first use.

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  setPlaybackRate(r: number): void;
  destroy(): void;
  /** Not in every build of the player, so both are optional. Used to switch captions off. */
  unloadModule?(module: string): void;
  setOption?(module: string, option: string, value: unknown): void;
}

export interface YTPlayerOptions {
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady?: () => void;
    onError?: (e: { data: number }) => void;
    onStateChange?: (e: { data: number }) => void;
  };
}

export interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_SCRIPT = 'https://www.youtube.com/iframe_api';
/** Embedding disabled by the owner. */
export const EMBED_BLOCKED = new Set([101, 150]);
/**
 * Errors that won't pass by themselves: 2 bad id, 5 HTML5 player, 100 removed or private, and the
 * two embed blocks. Anything else the player reports is transient and only logged.
 */
export const PERSISTENT_ERRORS = new Set([2, 5, 100, ...EMBED_BLOCKED]);

let pending: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  pending ??= new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = YT_SCRIPT;
    script.async = true;
    script.onerror = () => {
      pending = null;
      reject(new Error('YouTube API failed to load'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

/**
 * The §3.8 player parameters: muted, no controls, looping, inline, no related, minimal brand.
 * A background never wants captions, annotations, the player's keyboard or its fullscreen button
 * (real-app findings F6, F7). `origin` tells the player which page hosts it, so its postMessage
 * traffic is accepted.
 */
export const playerVars = (videoId: string) => ({
  origin: window.location.origin,
  autoplay: 1,
  mute: 1,
  controls: 0,
  loop: 1,
  playlist: videoId,
  playsinline: 1,
  rel: 0,
  modestbranding: 1,
  cc_load_policy: 0,
  iv_load_policy: 3,
  disablekb: 1,
  fs: 0,
});

/**
 * Switches captions off. `cc_load_policy: 0` is only a hint: a video whose owner forces captions
 * still loads them, so the captions module is unloaded once the player is ready.
 */
export function captionsOff(player: YTPlayer): void {
  try {
    player.unloadModule?.('captions');
    player.setOption?.('captions', 'track', {});
  } catch {
    // A player without the captions module has nothing to switch off.
  }
}
