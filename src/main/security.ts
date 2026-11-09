// Content-Security-Policy and navigation blocking (spec §3.2, study-dev rule 5).
import { shell } from 'electron';

/** Self, YouTube (embeds), i.ytimg.com (thumbs), i.scdn.co (album art), the media protocol, data and blob. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://i.ytimg.com https://i.scdn.co studyat-media: data: blob:",
  "media-src 'self' studyat-media: blob: data:",
  "connect-src 'self' studyat-media: data: blob:",
  "font-src 'self' data:",
  'frame-src https://www.youtube.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** The dev server needs inline scripts (React refresh preamble) and a websocket (HMR). */
export const DEV_CSP = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace(
  "connect-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The CSP goes only on responses from the app's own origin. Third-party responses (the YouTube
 * embed and its video, thumbnail and script hosts) keep their own policy, or the embed breaks.
 */
export function shouldApplyCsp(responseUrl: string, appOrigin: string | null): boolean {
  if (appOrigin === null) return false;
  return originOf(responseUrl) === appOrigin;
}

/** Denies window.open (https links go to the default browser) and blocks navigation off-origin. */
export function hardenWebContents(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (event, url) => {
    const here = originOf(wc.getURL());
    if (here === null || originOf(url) !== here) event.preventDefault();
  });
}
