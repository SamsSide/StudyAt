// Proportional widget scaling (spec §3.5, appplan §4.1). Widgets are sized for a 1920 × 1080
// window and grow or shrink with it: `layoutScale` is the smaller of the two ratios, held to
// 0.5–2. A widget's own `scale` multiplies it, and `fitScale` shrinks the result for display when
// the scaled widget wouldn't fit the free area (the stored scale is untouched).
import { useEffect, useState } from 'react';

/** The window size widgets are designed at; one constant so it can be tuned. */
export const LAYOUT_REF = { w: 1920, h: 1080 } as const;

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

/** The window's scale against `LAYOUT_REF`: clamp(min(w / 1920, h / 1080), 0.5, 2). */
export function layoutScale(w: number, h: number): number {
  const s = Math.min(w / LAYOUT_REF.w, h / LAYOUT_REF.h);
  return Number.isFinite(s) ? clamp(s, MIN_SCALE, MAX_SCALE) : 1;
}

/** `layoutScale` for the current window, following resizes. */
export function useLayoutScale(): number {
  const [s, setS] = useState(() => layoutScale(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const onResize = (): void => setS(layoutScale(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return s;
}

/**
 * The scale to render a `frame` (its unscaled size) at: `wanted`, reduced until the scaled box
 * fits inside `area`. Not measured yet (a zero side) means nothing to fit against.
 */
export function fitScale(
  frame: { w: number; h: number },
  wanted: number,
  area: { w: number; h: number },
): number {
  let s = wanted;
  if (frame.w > 0) s = Math.min(s, Math.max(0, area.w) / frame.w);
  if (frame.h > 0) s = Math.min(s, Math.max(0, area.h) / frame.h);
  return s;
}
