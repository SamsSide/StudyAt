import type { ClientRect, Modifier } from '@dnd-kit/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, minimalPlannerTask, mockApi } from '../../test/mockApi';
import { markDragEnded, PlannerDnd, resetDragGuard, SortableTask } from '../dnd';
import { resetPlannerStore, usePlannerStore } from '../plannerStore';
import { BoardDay } from './BoardDay';
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

// dnd-kit keeps a click-swallowing listener on the document for 50 ms after a drag ends; let a test's
// drag finish and that listener go before the next test clicks.
const settleDrag = async (): Promise<void> => {
  fireEvent.pointerUp(document);
  await new Promise((resolve) => setTimeout(resolve, 70));
};

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
  afterEach(settleDrag);

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

  it('a press and a move on the row text starts a drag', () => {
    const row = container.querySelector('li[data-task-id="1"]')!;
    expect(row).not.toHaveAttribute('data-dragging');
    fireEvent.pointerDown(screen.getByText('Read'), { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
    expect(row).toHaveAttribute('data-dragging', 'true');
  });

  it('a cancelled keyboard drag stamps the guard, so the next click does not open the detail', async () => {
    const grip = screen.getByRole('button', { name: 'Move "Read"' });
    grip.focus();
    fireEvent.keyDown(grip, { code: 'Space', key: ' ' });
    // The keyboard sensor listens for Escape from the next tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
  });
});

describe('a drag ended by the pointer (the guard is stamped on drop)', () => {
  const task = minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' });
  beforeEach(() => {
    // Date only: the real wait below lets dnd-kit's 50ms click swallow pass while the guard sees no time pass.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0).getTime());
    resetPlannerStore();
    resetDragGuard();
    usePlannerStore.setState({ tasks: { 1: task } });
    render(
      createElement(
        PlannerDnd,
        null,
        createElement('ul', null, createElement(SortableTask, { task, variant: 'full' })),
      ),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a click after dnd-kit stops swallowing clicks, but inside the guard window, opens nothing', async () => {
    fireEvent.pointerDown(screen.getByText('Read'), { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
    fireEvent.pointerUp(document);
    // dnd-kit's own click swallow lasts 50ms; the guard (250ms) must cover what is left.
    await new Promise((resolve) => setTimeout(resolve, 70));
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
  });
});

describe('Esc during a pointer drag', () => {
  const task = minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' });
  let shellSaw: KeyboardEvent[];
  const shell = (e: KeyboardEvent): void => {
    shellSaw.push(e);
  };
  beforeEach(() => {
    shellSaw = [];
    resetPlannerStore();
    resetDragGuard();
    usePlannerStore.setState({ tasks: { 1: task } });
    render(
      createElement(
        PlannerDnd,
        null,
        createElement('ul', null, createElement(SortableTask, { task, variant: 'full' })),
      ),
    );
    // Stands in for the shell's window listener, which closes the board unless the key is claimed.
    window.addEventListener('keydown', shell);
  });
  afterEach(async () => {
    window.removeEventListener('keydown', shell);
    await settleDrag();
  });

  it('cancels the drag and claims the key, so the shell leaves the board open', () => {
    const row = document.querySelector('li[data-task-id="1"]')!;
    fireEvent.pointerDown(screen.getByText('Read'), { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
    expect(row).toHaveAttribute('data-dragging', 'true');
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    expect(row).not.toHaveAttribute('data-dragging');
    expect(shellSaw).toHaveLength(1);
    expect(shellSaw[0]!.defaultPrevented).toBe(true);
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
  });

  it('leaves Esc alone when no drag is live', () => {
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    expect(shellSaw[0]!.defaultPrevented).toBe(false);
  });

  it('stops claiming Esc once the drag has ended', () => {
    fireEvent.pointerDown(screen.getByText('Read'), { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
    fireEvent.pointerUp(document);
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    expect(shellSaw[0]!.defaultPrevented).toBe(false);
  });
});

describe('a board Day card', () => {
  const task = minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' });
  const MIN_NOON = new Date(2026, 10, 11, 12, 0).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MIN_NOON);
    resetPlannerStore();
    resetDragGuard();
    installMockApi(
      mockApi({
        planner: {
          day: vi.fn((day: string) =>
            Promise.resolve({ from: day, to: day, tasks: [task], deadlines: [], studiedMs: {} }),
          ),
        },
      }),
    );
    usePlannerStore.setState({ tasks: { 1: task } });
    render(createElement(PlannerDnd, null, createElement(BoardDay, { day: '2026-11-11' })));
  });
  afterEach(async () => {
    await settleDrag();
    vi.useRealTimers();
  });

  it('a press and a move on the card starts a drag', () => {
    const card = document.querySelector('li[data-task-id="1"]')!;
    fireEvent.pointerDown(screen.getByText('Read'), { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
    expect(card).toHaveAttribute('data-dragging', 'true');
  });

  it('a click right after a drag does not open the detail; a later one does', () => {
    markDragEnded(Date.now());
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBeNull();
    resetDragGuard();
    fireEvent.click(screen.getByText('Read'));
    expect(usePlannerStore.getState().detailTaskId).toBe(1);
  });
});
