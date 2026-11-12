// The planner's renderer store (v1.2 spec §3.6-§3.9): the tasks, lists and deadlines main last
// told us about, what the widget is showing, and the commands that change them. Main owns every
// number (actuals, studied time, deadline days); this store mirrors what main returns and never
// derives a deadline's day. Writes come back as a TaskChange which `apply` merges.
import { create } from 'zustand';
import { addDays } from '../../core/time';
import { NEXT_FOCUS_NOTE, TASK_GONE } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type {
  Deadline,
  ListInput,
  ListPatch,
  PlannerRange,
  PlannerTask,
  TaskChange,
  TaskInput,
  TaskList,
  TaskMove,
  TaskUpdate,
} from '../../shared/types';
import { wallStamp } from '../../core/wallclock';
import { logIpcError } from '../lib/ipcError';
import { useStudyStore } from '../shell/store';
import { deadlineDayKey } from './format';

export type PlannerTab = 'day' | 'week' | 'lists';
/** The task dialog's two faces: the quick card, or the full detail behind its Expand. */
export type DetailMode = 'card' | 'full';
export interface PlannerFilter {
  subjectId: number | null;
  tag: string | null;
}

type RangeKind = 'day' | 'week' | 'month';
export interface RangeWatch {
  loaded: Promise<void>;
  release(): void;
}

export interface PlannerState {
  tasks: Record<number, PlannerTask>;
  lists: TaskList[];
  deadlines: Record<number, Deadline>;
  /** Focus ms per study day; a missing key is 0. */
  studiedMs: Record<string, number>;
  /** Deadline ids per day, from single-day loads only (main decides which study day a due time is on). */
  deadlineDays: Record<string, number[]>;
  tab: PlannerTab;
  /** The widget's Day view day; null = today. */
  day: string | null;
  listId: number | null;
  filter: PlannerFilter;
  detailTaskId: number | null;
  /** The open task's dialog: the quick card or the full detail (Tweek board feel spec §3.3). */
  detailMode: DetailMode;
  revisionOffer: { taskId: number; days: number[] } | null;
  /** A one-line status: NEXT_FOCUS_NOTE or TASK_GONE; cleared on the next action. */
  notice: string | null;
  loadRange(kind: RangeKind, key: string): Promise<void>;
  /** Loads a range and keeps it mounted (ref-counted) so `reload` refreshes it; `release` on unmount. */
  watchRange(kind: RangeKind, key: string): RangeWatch;
  loadLists(): Promise<void>;
  /** Re-runs every load made so far (actuals, another window's changes). */
  reload(): Promise<void>;
  apply(change: TaskChange): void;
  create(input: TaskInput): Promise<PlannerTask | null>;
  /** Ticking a non-revision task with a tag in settings.revisionTags sets revisionOffer. */
  update(id: number, patch: TaskUpdate): Promise<void>;
  move(id: number, to: TaskMove): Promise<void>;
  remove(id: number): Promise<void>;
  duplicate(id: number): Promise<void>;
  scheduleRevision(id: number, days: number[]): Promise<void>;
  /** ▶: timer.startTask; a running break → notice NEXT_FOCUS_NOTE; a rejection → TASK_GONE and reload. */
  startTask(id: number): Promise<void>;
  addSubtask(taskId: number, text: string): Promise<void>;
  updateSubtask(id: number, patch: { text?: string; done?: boolean }): Promise<void>;
  removeSubtask(id: number): Promise<void>;
  reorderSubtasks(taskId: number, ids: number[]): Promise<void>;
  createList(input: ListInput): Promise<void>;
  updateList(id: number, patch: ListPatch): Promise<void>;
  reorderLists(ids: number[]): Promise<void>;
  removeList(id: number): Promise<void>;
  clearDone(listId: number): Promise<void>;
  setTab(tab: PlannerTab): void;
  setDay(day: string | null): void;
  setListId(id: number | null): void;
  setFilter(f: PlannerFilter): void;
  /** Opens a task's dialog, as the quick card unless asked for the full detail. */
  openDetail(id: number, mode?: DetailMode): void;
  /** The card's Expand: the same dialog switches to the full detail. */
  expandDetail(): void;
  /** Closes the dialog; the next open is the card again. */
  closeDetail(): void;
  offerRevision(taskId: number): void;
  setOfferDays(days: number[]): void;
  dismissOffer(): void;
}

const api = () => window.studyat;

/** The last key loaded per range kind: what `reload` repeats when no view has the kind mounted. */
let loaded = new Map<RangeKind, string>();
/** The keys views currently show, per kind, ref-counted: `reload` refreshes every one. */
let watched = new Map<RangeKind, Map<string, number>>();
let listsLoaded = false;

const initialData = () => ({
  tasks: {} as Record<number, PlannerTask>,
  lists: [] as TaskList[],
  deadlines: {} as Record<number, Deadline>,
  studiedMs: {} as Record<string, number>,
  deadlineDays: {} as Record<string, number[]>,
  tab: 'day' as PlannerTab,
  day: null as string | null,
  listId: null as number | null,
  filter: { subjectId: null, tag: null } as PlannerFilter,
  detailTaskId: null as number | null,
  detailMode: 'card' as DetailMode,
  revisionOffer: null as { taskId: number; days: number[] } | null,
  notice: null as string | null,
});

/** The notice when main refuses a move and the optimistic one is rolled back. */
const MOVE_FAILED = "Couldn't move that task.";

const bySort = (a: PlannerTask, b: PlannerTask): number => a.sort - b.sort || a.id - b.id;

/** Done tasks keep their place below the open ones (spec §3.6). */
const openThenDone = (tasks: PlannerTask[]): PlannerTask[] => [
  ...tasks.filter((t) => !t.done).sort(bySort),
  ...tasks.filter((t) => t.done).sort(bySort),
];

/** Every study day `from..to` inclusive (a week or a month grid at most). */
function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

export const usePlannerStore = create<PlannerState>()((set, get) => {
  /** Runs `fn` as a user action: clears the notice first, logs a rejection with `context`. */
  const act = async <T>(context: string, fn: () => Promise<T>): Promise<T | null> => {
    set({ notice: null });
    try {
      return await fn();
    } catch (e) {
      logIpcError(context, e);
      return null;
    }
  };

  const applyChange = (change: TaskChange): void => {
    set((s) => {
      const tasks = { ...s.tasks };
      for (const id of change.removed) delete tasks[id];
      for (const t of change.tasks) tasks[t.id] = t;
      return { tasks };
    });
  };

  const adoptRange = (range: PlannerRange): void => {
    set((s) => {
      const tasks = { ...s.tasks };
      const fresh = new Set(range.tasks.map((t) => t.id));
      for (const t of Object.values(tasks)) {
        if (t.day !== null && t.day >= range.from && t.day <= range.to && !fresh.has(t.id))
          delete tasks[t.id];
      }
      for (const t of range.tasks) tasks[t.id] = t;
      // Main sends the open deadlines on the range's study days, so a stored one on those days that
      // the reply lacks was deleted, completed or moved out.
      const deadlines = { ...s.deadlines };
      const seen = new Set(range.deadlines.map((d) => d.id));
      const rollover = useStudyStore.getState().settings?.rolloverHour ?? DEFAULT_SETTINGS.rolloverHour;
      for (const d of Object.values(deadlines)) {
        const day = deadlineDayKey(d.due, rollover);
        if (day >= range.from && day <= range.to && !seen.has(d.id)) delete deadlines[d.id];
      }
      for (const d of range.deadlines) deadlines[d.id] = d;
      const studiedMs = { ...s.studiedMs };
      for (const day of daysIn(range.from, range.to)) delete studiedMs[day];
      Object.assign(studiedMs, range.studiedMs);
      const deadlineDays = { ...s.deadlineDays };
      if (range.from === range.to) deadlineDays[range.from] = range.deadlines.map((d) => d.id);
      return { tasks, deadlines, studiedMs, deadlineDays };
    });
  };

  const applySubtask = (t: PlannerTask): void => set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }));

  /** Ticking: an eligible task offers revision, any other tick answers (and so clears) the offer. */
  const offerFor = (task: PlannerTask | undefined): PlannerState['revisionOffer'] => {
    const settings = useStudyStore.getState().settings;
    if (!task || !settings || task.kind === 'revision') return null;
    if (!task.tags.some((tag) => settings.revisionTags.includes(tag))) return null;
    return { taskId: task.id, days: [...settings.revisionDays] };
  };

  return {
    ...initialData(),

    async loadRange(kind, key) {
      loaded.set(kind, key);
      try {
        const a = api().planner;
        adoptRange(await (kind === 'day' ? a.day(key) : kind === 'week' ? a.week(key) : a.month(key)));
      } catch (e) {
        logIpcError(`planner.${kind}`, e);
      }
    },

    async loadLists() {
      listsLoaded = true;
      try {
        const view = await api().planner.lists();
        set((s) => {
          const tasks = { ...s.tasks };
          for (const t of Object.values(tasks)) if (t.listId !== null) delete tasks[t.id];
          for (const t of view.tasks) tasks[t.id] = t;
          // The reply owns every open deadline due after now: a stored one in that set it lacks is gone.
          const deadlines = { ...s.deadlines };
          const seen = new Set(view.deadlines.map((d) => d.id));
          const now = wallStamp(Date.now());
          for (const d of Object.values(deadlines)) if (d.due > now && !seen.has(d.id)) delete deadlines[d.id];
          for (const d of view.deadlines) deadlines[d.id] = d;
          return { lists: view.lists, tasks, deadlines };
        });
      } catch (e) {
        logIpcError('planner.lists', e);
      }
    },

    watchRange(kind, key) {
      const keys = watched.get(kind) ?? new Map<string, number>();
      watched.set(kind, keys);
      keys.set(key, (keys.get(key) ?? 0) + 1);
      let released = false;
      return {
        loaded: get().loadRange(kind, key),
        release: () => {
          if (released) return;
          released = true;
          const n = (keys.get(key) ?? 1) - 1;
          if (n <= 0) keys.delete(key);
          else keys.set(key, n);
        },
      };
    },

    async reload() {
      const jobs: Promise<void>[] = [];
      for (const kind of ['day', 'week', 'month'] as const) {
        const keys = watched.get(kind);
        // Views mounted: every key on show. None (a store used on its own): the last one loaded.
        const todo = keys && keys.size > 0 ? [...keys.keys()] : loaded.has(kind) ? [loaded.get(kind) as string] : [];
        for (const key of todo) jobs.push(get().loadRange(kind, key));
      }
      if (listsLoaded) jobs.push(get().loadLists());
      await Promise.all(jobs);
    },

    apply: applyChange,

    async create(input) {
      const before = get().tasks;
      const change = await act('tasks.create', () => api().tasks.create(input));
      if (!change) return null;
      applyChange(change);
      return change.tasks.find((t) => !(t.id in before)) ?? change.tasks[0] ?? null;
    },

    async update(id, patch) {
      const change = await act('tasks.update', () => api().tasks.update(id, patch));
      if (!change) return;
      applyChange(change);
      if (patch.done === true) {
        set({ revisionOffer: offerFor(change.tasks.find((t) => t.id === id) ?? get().tasks[id]) });
      }
    },

    async move(id, to) {
      const before = get().tasks;
      const task = before[id];
      if (!task) return;
      // Optimistic: drop it among the destination's open tasks at `index` (as main's `place` counts),
      // renumbering their sort; done tasks keep theirs.
      const here = (t: PlannerTask): boolean => ('day' in to ? t.day === to.day : t.listId === to.listId);
      const peers = Object.values(before)
        .filter((t) => t.id !== id && !t.done && here(t))
        .sort(bySort);
      const moved: PlannerTask =
        'day' in to ? { ...task, day: to.day, listId: null } : { ...task, day: null, listId: to.listId };
      peers.splice(Math.max(0, Math.min(to.index, peers.length)), 0, moved);
      const tasks = { ...before };
      peers.forEach((t, i) => {
        tasks[t.id] = { ...t, sort: i };
      });
      set({ notice: null, tasks });
      try {
        applyChange(await api().tasks.move(id, to));
      } catch (e) {
        logIpcError('tasks.move', e);
        set({ tasks: before, notice: MOVE_FAILED });
      }
    },

    async remove(id) {
      const change = await act('tasks.remove', () => api().tasks.remove(id));
      if (!change) return;
      applyChange(change);
      set((s) => (s.detailTaskId === id ? { detailTaskId: null, detailMode: 'card' } : {}));
    },

    async duplicate(id) {
      const change = await act('tasks.duplicate', () => api().tasks.duplicate(id));
      if (change) applyChange(change);
    },

    async scheduleRevision(id, days) {
      const change = await act('tasks.scheduleRevision', () => api().tasks.scheduleRevision(id, days));
      if (!change) return;
      applyChange(change);
      set({ revisionOffer: null });
    },

    async startTask(id) {
      set({ notice: null });
      try {
        const state = await api().timer.startTask(id);
        if (state.mode !== 'focus' && state.mode !== 'countdown' && state.status !== 'idle') {
          set({ notice: NEXT_FOCUS_NOTE });
        }
      } catch (e) {
        logIpcError('timer.startTask', e);
        set({ notice: TASK_GONE });
        await get().reload();
      }
    },

    async addSubtask(taskId, text) {
      const t = await act('subtasks.add', () => api().subtasks.add(taskId, text));
      if (t) applySubtask(t);
    },
    async updateSubtask(id, patch) {
      const t = await act('subtasks.update', () => api().subtasks.update(id, patch));
      if (t) applySubtask(t);
    },
    async removeSubtask(id) {
      const t = await act('subtasks.remove', () => api().subtasks.remove(id));
      if (t) applySubtask(t);
    },
    async reorderSubtasks(taskId, ids) {
      const t = await act('subtasks.reorder', () => api().subtasks.reorder(taskId, ids));
      if (t) applySubtask(t);
    },

    async createList(input) {
      const lists = await act('lists.create', () => api().lists.create(input));
      if (lists) set({ lists });
    },
    async updateList(id, patch) {
      const lists = await act('lists.update', () => api().lists.update(id, patch));
      if (lists) set({ lists });
    },
    async reorderLists(ids) {
      const lists = await act('lists.reorder', () => api().lists.reorder(ids));
      if (lists) set({ lists });
    },
    async removeList(id) {
      const change = await act('lists.remove', () => api().lists.remove(id));
      if (!change) return;
      set((s) => {
        const tasks = { ...s.tasks };
        for (const t of Object.values(tasks)) if (t.listId === id) delete tasks[t.id];
        return {
          lists: s.lists.filter((l) => !change.removed.includes(l.id)),
          tasks,
          listId: s.listId === id ? null : s.listId,
        };
      });
    },
    async clearDone(listId) {
      const change = await act('lists.clearDone', () => api().lists.clearDone(listId));
      if (change) applyChange(change);
    },

    setTab: (tab) => set({ tab }),
    setDay: (day) => set({ day }),
    setListId: (listId) => set({ listId }),
    setFilter: (filter) => set({ filter }),
    openDetail: (id, mode = 'card') => set({ detailTaskId: id, detailMode: mode }),
    expandDetail: () => set({ detailMode: 'full' }),
    closeDetail: () => set({ detailTaskId: null, detailMode: 'card' }),
    offerRevision: (taskId) => {
      const settings = useStudyStore.getState().settings;
      set({ revisionOffer: { taskId, days: [...(settings?.revisionDays ?? DEFAULT_SETTINGS.revisionDays)] } });
    },
    setOfferDays: (days) =>
      set((s) => (s.revisionOffer ? { revisionOffer: { ...s.revisionOffer, days } } : {})),
    dismissOffer: () => set({ revisionOffer: null }),
  };
});

/** True when `t` passes the filter: its effective subject and tags (null = any). */
export function matchesFilter(t: PlannerTask, f: PlannerFilter): boolean {
  if (f.subjectId !== null && t.effectiveSubjectId !== f.subjectId) return false;
  if (f.tag !== null && !t.tags.includes(f.tag)) return false;
  return true;
}

/** The day's filtered tasks: open by sort, then done. */
export function tasksOnDay(s: PlannerState, day: string): PlannerTask[] {
  return openThenDone(Object.values(s.tasks).filter((t) => t.day === day && matchesFilter(t, s.filter)));
}

/** The list's filtered tasks: open by sort, then done. */
export function tasksInList(s: PlannerState, listId: number): PlannerTask[] {
  return openThenDone(
    Object.values(s.tasks).filter((t) => t.listId === listId && matchesFilter(t, s.filter)),
  );
}

/** The deadlines main reported for `day` (single-day loads only). */
export function deadlinesOn(s: PlannerState, day: string): Deadline[] {
  return (s.deadlineDays[day] ?? []).flatMap((id) => {
    const d = s.deadlines[id];
    return d && !d.done ? [d] : [];
  });
}

export function resetPlannerStore(): void {
  loaded = new Map();
  watched = new Map();
  listsLoaded = false;
  usePlannerStore.setState(initialData());
}
