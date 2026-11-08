// Video thumbnails are captured in the renderer (spec §3.8): seek to 10 % of the clip (at least
// 1 s in, never past the middle), draw a 320-px-wide frame, store it as a JPEG data URL.

export const THUMB_WIDTH = 320;

export function thumbTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(duration * 0.1, 1), duration / 2);
}

export function captureThumbnail(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    // The protocol sends CORS headers to the app origin; this keeps the canvas untainted.
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    const done = (fn: () => void) => {
      video.removeAttribute('src');
      video.load();
      fn();
    };
    video.addEventListener('error', () => done(() => reject(new Error('thumbnail: video failed to load'))));
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = thumbTime(video.duration);
    });
    video.addEventListener('seeked', () => {
      try {
        const w = video.videoWidth || THUMB_WIDTH;
        const h = video.videoHeight || Math.round((THUMB_WIDTH * 9) / 16);
        const canvas = document.createElement('canvas');
        canvas.width = THUMB_WIDTH;
        canvas.height = Math.round((THUMB_WIDTH * h) / w);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('thumbnail: no 2d context');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.7);
        done(() => resolve(data));
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    });
    video.src = url;
  });
}
