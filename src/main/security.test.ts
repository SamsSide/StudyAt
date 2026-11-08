import { describe, expect, it } from 'vitest';
import { shouldApplyCsp } from './security';

describe('shouldApplyCsp', () => {
  const origin = 'http://127.0.0.1:41234';

  it('applies to the app origin', () => {
    expect(shouldApplyCsp('http://127.0.0.1:41234/', origin)).toBe(true);
    expect(shouldApplyCsp('http://127.0.0.1:41234/assets/index.js', origin)).toBe(true);
  });

  it('leaves third-party responses alone', () => {
    expect(shouldApplyCsp('https://www.youtube.com/embed/abc', origin)).toBe(false);
    expect(shouldApplyCsp('https://rr1---sn.googlevideo.com/videoplayback', origin)).toBe(false);
    expect(shouldApplyCsp('https://i.ytimg.com/vi/abc/hq.jpg', origin)).toBe(false);
  });

  it('is false for another local port, no origin or a bad url', () => {
    expect(shouldApplyCsp('http://127.0.0.1:9999/', origin)).toBe(false);
    expect(shouldApplyCsp('http://127.0.0.1:41234/', null)).toBe(false);
    expect(shouldApplyCsp('not a url', origin)).toBe(false);
  });
});
