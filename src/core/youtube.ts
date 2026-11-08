// YouTube URL parsing for "Add YouTube" (spec §3.8). Accepts watch, youtu.be, live and embed
// links on youtube.com (with or without `www.`/`m.`) and returns the 11-character video id.

const ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const PATH_FORMS = new Set(['live', 'embed']);

export function parseYouTubeId(url: string): string | null {
  const text = url.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (host === 'youtu.be') {
    if (segments.length === 1) id = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') id = u.searchParams.get('v');
    else if (segments.length === 2 && PATH_FORMS.has(segments[0] ?? '')) id = segments[1];
  }
  return id && ID.test(id) ? id : null;
}
