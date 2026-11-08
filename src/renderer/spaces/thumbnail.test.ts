import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureThumbnail, thumbTime } from './thumbnail';

afterEach(() => vi.restoreAllMocks());

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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    let video!: HTMLVideoElement;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, o?: ElementCreationOptions) => {
      const el = create(tag, o);
      if (tag === 'video') video = el as HTMLVideoElement;
      return el;
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'duration', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });

    const p = captureThumbnail('studyat-media://space/1');
    expect(video.crossOrigin).toBe('anonymous');
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(10);
    video.dispatchEvent(new Event('seeked'));
    await expect(p).resolves.toBe('data:image/jpeg;base64,ZZZ');
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('rejects when the video errors', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    let video!: HTMLVideoElement;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, o?: ElementCreationOptions) => {
      const el = create(tag, o);
      if (tag === 'video') video = el as HTMLVideoElement;
      return el;
    });
    const p = captureThumbnail('studyat-media://space/1');
    video.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow('thumbnail');
  });
});
