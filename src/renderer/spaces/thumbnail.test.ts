import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureThumbnail, THUMB_TIMEOUT_MS, thumbTime } from './thumbnail';

// Own-property getters put on HTMLVideoElement.prototype by a test, removed afterwards so the
// jsdom defaults (inherited from HTMLMediaElement) come back for every other test.
const overridden: string[] = [];
const fakeVideoProp = (name: 'duration' | 'videoWidth' | 'videoHeight', value: number) => {
  Object.defineProperty(HTMLVideoElement.prototype, name, { configurable: true, get: () => value });
  overridden.push(name);
};

/** Spies on document.createElement and hands back the <video> captureThumbnail makes. */
const catchVideo = () => {
  const box: { video?: HTMLVideoElement } = {};
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, o?: ElementCreationOptions) => {
    const el = create(tag, o);
    if (tag === 'video') box.video = el as HTMLVideoElement;
    return el;
  });
  return () => {
    if (!box.video) throw new Error('no video created');
    return box.video;
  };
};

afterEach(() => {
  for (const name of overridden.splice(0)) Reflect.deleteProperty(HTMLVideoElement.prototype, name);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('thumbTime', () => {
  it('is 10 % of the clip, at least 1 s, never past the middle', () => {
    expect(thumbTime(100)).toBe(10);
    expect(thumbTime(5)).toBe(1);
    expect(thumbTime(1)).toBe(0.5);
    expect(thumbTime(NaN)).toBe(0);
  });
});

describe('captureThumbnail', () => {
  it('seeks, draws a 320-px-wide frame and resolves a JPEG data URL', async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,ZZZ');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const video = catchVideo();
    fakeVideoProp('duration', 100);
    fakeVideoProp('videoWidth', 1920);
    fakeVideoProp('videoHeight', 1080);

    const p = captureThumbnail('studyat-media://space/1');
    expect(video().crossOrigin).toBe('anonymous');
    video().dispatchEvent(new Event('loadedmetadata'));
    expect(video().currentTime).toBe(10);
    video().dispatchEvent(new Event('seeked'));
    await expect(p).resolves.toBe('data:image/jpeg;base64,ZZZ');
    expect(drawImage).toHaveBeenCalledWith(video(), 0, 0, 320, 180);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('rejects when the video errors', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const video = catchVideo();
    const p = captureThumbnail('studyat-media://space/1');
    video().dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow('thumbnail');
  });

  it('gives up after the timeout, releases the video, and ignores a late frame', async () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const video = catchVideo();
    const p = captureThumbnail('studyat-media://space/1');
    const settled = vi.fn();
    p.then(settled, settled);

    await vi.advanceTimersByTimeAsync(THUMB_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow('timed out');
    expect(THUMB_TIMEOUT_MS).toBe(10_000);
    expect(video().hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);

    // A frame that arrives late changes nothing.
    video().dispatchEvent(new Event('seeked'));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
