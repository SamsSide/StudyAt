// Lazy loader and thin typing for the YouTube IFrame API (spec §3.8). The script host is allowed
// by the CSP; the API is fetched once, on first use.
import type { SpaceQuality } from '../../shared/types';

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
  /** Quality calls are likewise optional (spec §3.3). */
  getPlaybackQuality?(): string;
  setPlaybackQuality?(level: string): void;
}

export interface YTPlayerOptions {
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady?: () => void;
    onError?: (e: { data: number }) => void;
    onStateChange?: (e: { data: number }) => void;
    onPlaybackQualityChange?: (e: { data: string }) => void;
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
/** 152/153: the player rejected our set-up (the referrer), not the owner's choice (spec §3.8). */
export const CONFIG_ERRORS = new Set([152, 153]);
/**
 * Errors that won't pass by themselves: 2 bad id, 5 HTML5 player, 100 removed or private, the
 * two embed blocks and the two configuration errors. Anything else the player reports is
 * transient and only logged.
 */
export const PERSISTENT_ERRORS = new Set([2, 5, 100, ...EMBED_BLOCKED, ...CONFIG_ERRORS]);

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

/** What a quality target asks the player for: device pixels, and the player's quality level. */
export const QUALITY_TARGETS = {
  '1080': { w: 1920, h: 1080, level: 'hd1080' },
  '1440': { w: 2560, h: 1440, level: 'hd1440' },
  '2160': { w: 3840, h: 2160, level: 'hd2160' },
} as const;

export const QUALITY_OPTIONS: readonly { value: SpaceQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1080', label: '1080p' },
  { value: '1440', label: '1440p' },
  { value: '2160', label: '4K' },
];

export const QUALITY_HINT =
  "Asks YouTube for at least this. YouTube still drops lower if your connection can't keep up.";

/** How often the playing quality is read, besides when the player reports a change. */
export const QUALITY_POLL_MS = 5000;

/** The player's quality levels as the badge names them (spec §3.3). */
export const QUALITY_LABELS: Record<string, string> = {
  highres: '4K+',
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};

export function qualityLabel(level: string | null | undefined): string {
  if (level === null || level === undefined || !Object.hasOwn(QUALITY_LABELS, level)) return '—';
  return QUALITY_LABELS[level] ?? '—';
}

/**
 * CSS size of the player for a target (device pixels over the device pixel ratio, so the player
 * gets that many real pixels) and the scale that covers the window. Null for Auto, which keeps
 * the plain sizing.
 */
export function playerBox(
  q: SpaceQuality,
  win: { w: number; h: number },
  dpr: number,
): { width: number; height: number; scale: number } | null {
  if (q === 'auto') return null;
  const t = QUALITY_TARGETS[q];
  const width = t.w / dpr;
  const height = t.h / dpr;
  return { width, height, scale: Math.max(win.w / width, win.h / height) };
}
