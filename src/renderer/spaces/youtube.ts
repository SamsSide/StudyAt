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
}

export interface YTPlayerOptions {
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady?: () => void;
    onError?: (e: { data: number }) => void;
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

/** The §3.8 player parameters: muted, no controls, looping, inline, no related, minimal brand. */
export const playerVars = (videoId: string) => ({
  autoplay: 1,
  mute: 1,
  controls: 0,
  loop: 1,
  playlist: videoId,
  playsinline: 1,
  rel: 0,
  modestbranding: 1,
});
