// The board's drag feel (v1.2 spec §3.7, Sam: "like Tweek"): the dragged line follows the pointer in a
// drag overlay portalled to the body, so no column's scroll clips it as it crosses the board; and a
// thin insertion line shows where it will land in another column (inside its own column the sortable
// rows already part to show the gap). Both read PlannerDnd's context; `resolveDrop` decides the drop,
// so the line shows only where a drop would move something. The overlay is sized to its own line
// (not the grabbed row's box) and kept under the pointer at the point it was grabbed, a little
// see-through so a column's head chips still read under it.
import { DragOverlay, useDndContext, type Modifier } from '@dnd-kit/core';
import { createPortal } from 'react-dom';
import type { PlannerTask } from '../../../shared/types';
import { dayZone, listZone, openOrder, resolveDrop, taskDrag } from '../dnd';
import { usePlannerStore } from '../plannerStore';
import styles from './board.module.css';

const zoneOf = (t: PlannerTask): string | null =>
  t.day !== null ? dayZone(t.day) : t.listId !== null ? listZone(t.listId) : null;

const taskOf = (dragId: string | number | undefined): PlannerTask | undefined => {
  const s = String(dragId ?? '');
  if (!s.startsWith('task:')) return undefined;
  return usePlannerStore.getState().tasks[Number(s.slice(5))];
};

/** Where the insertion line goes in `zone` while something is dragged over it from elsewhere: before
 *  the open task with that id, 'end' (after the last open one), or null (no line here). */
export function useInsertHint(zone: string, visible: readonly PlannerTask[]): number | 'end' | null {
  const { active, over } = useDndContext();
  if (!active || !over) return null;
  const dragged = taskOf(active.id);
  if (!dragged || zoneOf(dragged) === zone) return null;
  const overId = String(over.id);
  const target = taskOf(overId);
  const overZone = target ? zoneOf(target) : overId;
  if (overZone !== zone) return null;
  if (!resolveDrop(String(active.id), overId, usePlannerStore.getState().tasks, openOrder)) return null;
  if (target && !target.done && visible.some((t) => t.id === target.id)) return target.id;
  return 'end';
}

/** The thin line itself: a zero-height item, so showing it never shifts the rows under the pointer. */
export function InsertLine() {
  return <li className={styles.insert} aria-hidden="true" />;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** How far inside the overlay's edge the pointer is kept, so it never sits on the very border. */
const GRAB_INSET = 4;

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** dnd-kit puts the overlay's top-left where the grabbed row's was, plus the pointer's travel. When
 *  the overlay is smaller than the row (a wrapped row, its chips left behind), the grab point can fall
 *  outside it; this shifts the overlay so the pointer stays on it at the same spot, clamped inside.
 *  A keyboard drag has no pointer and is left alone. */
export const keepGrabPoint: Modifier = ({ activatorEvent, activeNodeRect, overlayNodeRect, transform }) => {
  if (!activatorEvent || !activeNodeRect || !overlayNodeRect) return transform;
  if (!('clientX' in activatorEvent) || !('clientY' in activatorEvent)) return transform;
  const { clientX, clientY } = activatorEvent as MouseEvent;
  const grabX = clientX - activeNodeRect.left;
  const grabY = clientY - activeNodeRect.top;
  const x = clamp(grabX, GRAB_INSET, overlayNodeRect.width - GRAB_INSET);
  const y = clamp(grabY, GRAB_INSET, overlayNodeRect.height - GRAB_INSET);
  return { ...transform, x: transform.x + grabX - x, y: transform.y + grabY - y };
};

const MODIFIERS = [keepGrabPoint];

/** The dragged task's line, following the pointer above everything (the task detail included). */
export function BoardDragOverlay() {
  const { active } = useDndContext();
  const task = active ? taskOf(active.id) : undefined;
  // Read on each drag's render, so a change to the OS setting applies to the next drag.
  const reduced = prefersReducedMotion();

  return createPortal(
    <DragOverlay
      zIndex={1000}
      dropAnimation={reduced ? null : undefined}
      modifiers={MODIFIERS}
      // dnd-kit sizes the overlay to the grabbed row; let the line take its own height instead.
      style={{ height: 'auto' }}
    >
      {task ? (
        <div className={styles.dragLine} data-drag-overlay={taskDrag(task.id)}>
          {task.title}
        </div>
      ) : null}
    </DragOverlay>,
    document.body,
  );
}
