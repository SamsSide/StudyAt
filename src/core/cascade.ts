// Where a new floating thing lands (v1.2 spec §3.2, §3.12): popped notes and stats widgets cascade
// like images do, from near the top centre down and right, so a second one never hides the first.
// Positions
// are fractions 0..1 of the window. Pure: the caller passes how many are already out.

export const CASCADE_START = { x: 0.5, y: 0.3 } as const;
export const CASCADE = { x: 0.03, y: 0.04, steps: 6 } as const;

/** Where the `count`-th instance lands: START + CASCADE × (count mod 6). */
export function cascadeAt(count: number): { x: number; y: number } {
  const step = ((Math.floor(count) % CASCADE.steps) + CASCADE.steps) % CASCADE.steps;
  return { x: CASCADE_START.x + CASCADE.x * step, y: CASCADE_START.y + CASCADE.y * step };
}
