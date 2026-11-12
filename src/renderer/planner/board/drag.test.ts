import type { ClientRect, Modifier } from '@dnd-kit/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { minimalPlannerTask } from '../../test/mockApi';
import { markDragEnded, PlannerDnd, resetDragGuard, SortableTask } from '../dnd';
import { resetPlannerStore, usePlannerStore } from '../plannerStore';
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

describe.each(['compact', 'full'] as const)('a %s row dragged by its whole line', (variant) => {
  const task = minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' });
  let container: HTMLElement;
  beforeEach(() => {
    resetPlannerStore();
    resetDragGuard();
    usePlannerStore.setState({ tasks: { 1: task } });
    ({ container } = render(
      createElement(
        PlannerDnd,
        null,
        createElement('ul', null, createElement(SortableTask, { task, variant })),
      ),
    ));
  });

  it('puts the pointer handle on the row and keeps the keyboard grip as a separate button', () => {
    const row = container.querySelector('li[data-task-id="1"]')!;
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('aria-roledescription');
    const grip = screen.getByRole('button', { name: 'Move "Read"' });
    expect(grip).toHaveAttribute('aria-roledescription', 'sortable');
  });

  it('a row click right after a drag does not open the detail; a later one does', () => {
    markDragEnded(Date.now());
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
    resetDragGuard();
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBe(1);
  });
});
