// Drag and drop for the planner (v1.2 spec §3.7): @dnd-kit with pointer and keyboard sensors. A day
// or a list is a drop zone, a row is sortable inside its zone. `resolveDrop` is pure: it turns a
// drop into a TaskMove (or nothing), and the store does the move. Dropping outside every target, or
// back where it was, moves nothing.
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ReactNode } from 'react';
import type { PlannerTask, TaskMove } from '../../shared/types';
import { usePlannerStore } from './plannerStore';
import { TaskRow } from './TaskRow';
import styles from './planner.module.css';

export const dayZone = (day: string): string => `day:${day}`;
export const listZone = (id: number): string => `list:${id}`;
export const taskDrag = (id: number): string => `task:${id}`;

const taskIdOf = (drag: string): number | null => {
  if (!drag.startsWith('task:')) return null;
  const id = Number(drag.slice(5));
  return Number.isInteger(id) ? id : null;
};

const zoneOf = (t: PlannerTask): string | null =>
  t.day !== null ? dayZone(t.day) : t.listId !== null ? listZone(t.listId) : null;

const moveTo = (zone: string, index: number): TaskMove | null => {
  if (zone.startsWith('day:')) return { day: zone.slice(4), index };
  if (zone.startsWith('list:')) {
    const listId = Number(zone.slice(5));
    return Number.isInteger(listId) ? { listId, index } : null;
  }
  return null;
};

/** Where a drop lands, or null (outside every target, or back where it was). `over` may be a zone
 *  (end of that day or list) or another task (its container, at its index among open tasks).
 *  `order(zone)` is the zone's open task ids, in order, including the dragged task if it is there. */
export function resolveDrop(
  active: string,
  over: string | null,
  tasks: Record<number, PlannerTask>,
  order: (zone: string) => number[],
): { id: number; to: TaskMove } | null {
  const id = taskIdOf(active);
  if (id === null || over === null || over === active) return null;
  const task = tasks[id];
  if (!task) return null;

  let zone: string;
  let index: number;
  const overId = taskIdOf(over);
  if (overId !== null) {
    const target = tasks[overId];
    const z = target ? zoneOf(target) : null;
    if (!target || z === null) return null;
    zone = z;
    const ids = order(zone);
    const at = ids.indexOf(overId);
    // A done task sits below the open ones: dropping on it means "after the last open one".
    index = at === -1 ? ids.length - (ids.includes(id) ? 1 : 0) : at;
    if (ids.includes(id) && ids.indexOf(id) === index) return null;
  } else {
    zone = over;
    const ids = order(zone);
    const here = ids.indexOf(id);
    if (here !== -1 && here === ids.length - 1) return null;
    index = here === -1 ? ids.length : ids.length - 1;
  }
  const to = moveTo(zone, index);
  return to ? { id, to } : null;
}

/** A zone's open task ids, by sort, from the whole store (a filter never changes where a task goes). */
function openOrder(zone: string): number[] {
  return Object.values(usePlannerStore.getState().tasks)
    .filter((t) => !t.done && zoneOf(t) === zone)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((t) => t.id);
}

/** A task row under the pointer wins over the zone around it; the keyboard has no pointer, so the
 *  nearest centre decides. */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return args.pointerCoordinates ? [] : closestCenter(args);
  const rows = hits.filter((h) => String(h.id).startsWith('task:'));
  return rows.length > 0 ? rows : hits;
};

export function PlannerDnd({ children }: { children: ReactNode }) {
  const move = usePlannerStore((s) => s.move);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const drop = resolveDrop(
      String(active.id),
      over ? String(over.id) : null,
      usePlannerStore.getState().tasks,
      openOrder,
    );
    if (drop) void move(drop.id, drop.to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisions} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}

/** A day or a list: a drop target that also orders its rows (`items` are the visible task ids). */
export function DropZone({
  id,
  className,
  items,
  children,
}: {
  id: string;
  className?: string;
  items?: number[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className} data-over={isOver ? 'true' : undefined}>
      <SortableContext items={(items ?? []).map(taskDrag)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

/** A sortable row with a grip button `Move "<title>"` (Space to lift, arrows to move, Space to drop). */
export function SortableTask({ task }: { task: PlannerTask }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDrag(task.id) });
  return (
    <TaskRow
      task={task}
      rowRef={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      dragging={isDragging}
      grip={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={styles.grip}
          {...attributes}
          {...listeners}
          aria-label={`Move "${task.title}"`}
        >
          ⠿
        </button>
      }
    />
  );
}
