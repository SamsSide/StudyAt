import { describe, expect, it } from 'vitest';
import { playerBox, qualityLabel, QUALITY_LABELS, QUALITY_OPTIONS } from './youtube';

describe('playerBox', () => {
  it('sizes 4K in CSS pixels and scales it to cover the window', () => {
    expect(playerBox('2160', { w: 1920, h: 1080 }, 1)).toEqual({ width: 3840, height: 2160, scale: 0.5 });
    expect(playerBox('2160', { w: 1920, h: 1080 }, 1.5)).toEqual({ width: 2560, height: 1440, scale: 0.75 });
  });
  it('covers a taller window by its height', () => {
    expect(playerBox('2160', { w: 1920, h: 1200 }, 1)?.scale).toBeCloseTo(1200 / 2160);
  });
  it('treats an unknown quality as Auto', () => {
    expect(playerBox('bogus' as never, { w: 1920, h: 1080 }, 1)).toBeNull();
  });
  it('Auto has no box', () => {
    expect(playerBox('auto', { w: 1920, h: 1080 }, 1)).toBeNull();
  });
});

describe('quality labels', () => {
  it('names every level the player reports', () => {
    expect(QUALITY_LABELS).toEqual({
      highres: '4K+',
      hd2160: '2160p',
      hd1440: '1440p',
      hd1080: '1080p',
      hd720: '720p',
      large: '480p',
      medium: '360p',
      small: '240p',
      tiny: '144p',
    });
    for (const [level, label] of Object.entries(QUALITY_LABELS)) expect(qualityLabel(level)).toBe(label);
  });
  it('shows a dash for anything else', () => {
    expect(qualityLabel('weird')).toBe('—');
    expect(qualityLabel('toString')).toBe('—');
    expect(qualityLabel(null)).toBe('—');
    expect(qualityLabel(undefined)).toBe('—');
  });
  it('offers Auto, 1080p, 1440p and 4K', () => {
    expect(QUALITY_OPTIONS.map((o) => o.label)).toEqual(['Auto', '1080p', '1440p', '4K']);
  });
});
