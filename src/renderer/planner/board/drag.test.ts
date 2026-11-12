import type { ClientRect, Modifier } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';
import { keepGrabPoint } from './BoardDrag';

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

type Args = Parameters<Modifier>[0];

const args = (over: Partial<Args>): Args => ({
  activatorEvent: null,
  active: null,
  activeNodeRect: null,
  draggingNodeRect: null,
  containerNodeRect: null,
  over: null,
  overlayNodeRect: null,
  scrollableAncestors: [],
  scrollableAncestorRects: [],
  transform: { x: 40, y: 10, scaleX: 1, scaleY: 1 },
  windowRect: null,
  ...over,
});

const grab = (clientX: number, clientY: number): Event => new MouseEvent('pointerdown', { clientX, clientY });

describe('keepGrabPoint (the drag overlay sits where the row was grabbed)', () => {
  it('leaves the transform alone when the grab point is inside the overlay', () => {
    const out = keepGrabPoint(
      args({
        activatorEvent: grab(200, 116),
        activeNodeRect: rect(100, 100, 160, 32),
        overlayNodeRect: rect(140, 110, 160, 32),
      }),
    );
    expect(out).toMatchObject({ x: 40, y: 10 });
  });

  it('pulls the overlay down under the pointer when the grabbed row was taller than its overlay', () => {
    // Grabbed 80px down a 165px row; the overlay is a 40px line, so it moves 80 - (40 - 4) = 44px.
    const out = keepGrabPoint(
      args({
        activatorEvent: grab(250, 180),
        activeNodeRect: rect(100, 100, 160, 165),
        overlayNodeRect: rect(140, 110, 160, 40),
      }),
    );
    expect(out).toMatchObject({ x: 40, y: 10 + 44 });
  });

  it('does nothing for a keyboard drag, which has no pointer', () => {
    const out = keepGrabPoint(
      args({
        activatorEvent: new KeyboardEvent('keydown', { key: ' ' }),
        activeNodeRect: rect(100, 100, 160, 165),
        overlayNodeRect: rect(140, 110, 160, 40),
      }),
    );
    expect(out).toMatchObject({ x: 40, y: 10 });
  });
});
