import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LAYOUT_REF, fitScale, layoutScale, useLayoutScale } from './layoutScale';

function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('layoutScale', () => {
  it('is 1 at the 1920 × 1080 reference', () => {
    expect(LAYOUT_REF).toEqual({ w: 1920, h: 1080 });
    expect(layoutScale(1920, 1080)).toBe(1);
  });

  it('follows the window proportionally', () => {
    expect(layoutScale(960, 540)).toBe(0.5);
  });

  it('never goes below 0.5', () => {
    expect(layoutScale(480, 270)).toBe(0.5);
  });

  it('never goes above 2', () => {
    expect(layoutScale(3840, 2160)).toBe(2);
    expect(layoutScale(7680, 4320)).toBe(2);
  });

  it('takes the smaller of the two ratios', () => {
    expect(layoutScale(1920, 540)).toBe(0.5);
    expect(layoutScale(1440, 1080)).toBe(0.75);
  });
});

describe('useLayoutScale', () => {
  it('follows window resizes', () => {
    setWindow(1920, 1080);
    const { result } = renderHook(() => useLayoutScale());
    expect(result.current).toBe(1);
    act(() => {
      setWindow(1440, 810);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(0.75);
  });
});

describe('fitScale', () => {
  it('keeps the wanted scale when the scaled box fits', () => {
    expect(fitScale({ w: 200, h: 100 }, 2, { w: 800, h: 600 })).toBe(2);
  });

  it('reduces a 2× widget to fit an area half its scaled size', () => {
    // Scaled box 400 × 200; the area is 200 × 100.
    expect(fitScale({ w: 200, h: 100 }, 2, { w: 200, h: 100 })).toBe(1);
  });

  it('fits the tighter side', () => {
    expect(fitScale({ w: 200, h: 100 }, 2, { w: 1000, h: 50 })).toBe(0.5);
  });

  it('leaves an unmeasured frame at the wanted scale', () => {
    expect(fitScale({ w: 0, h: 0 }, 1.5, { w: 100, h: 100 })).toBe(1.5);
  });
});
