import { describe, expect, it } from 'vitest';
import { CASCADE, CASCADE_START, cascadeAt } from './cascade';

describe('cascadeAt', () => {
  it('starts at the cascade start and steps down and right', () => {
    expect(CASCADE_START).toEqual({ x: 0.5, y: 0.3 });
    expect(CASCADE).toEqual({ x: 0.03, y: 0.04, steps: 6 });
    expect(cascadeAt(0)).toEqual({ x: 0.5, y: 0.3 });
    const one = cascadeAt(1);
    expect(one.x).toBeCloseTo(0.53);
    expect(one.y).toBeCloseTo(0.34);
    const five = cascadeAt(5);
    expect(five.x).toBeCloseTo(0.65);
    expect(five.y).toBeCloseTo(0.5);
  });

  it('wraps back to the start every six', () => {
    expect(cascadeAt(6)).toEqual({ x: 0.5, y: 0.3 });
    const seven = cascadeAt(7);
    expect(seven.x).toBeCloseTo(0.53);
    expect(seven.y).toBeCloseTo(0.34);
  });
});
