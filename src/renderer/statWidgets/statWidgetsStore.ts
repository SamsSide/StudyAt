// Renderer-side stats widgets (v1.2 spec §3.12, appplan §4.7, §4.10). Main owns the rows in
// `stat_widgets`; this mirrors them for the shell's floating widgets. The numbers on each card are
// never worked out here: every card asks main (`stats.card`) again whenever `revision` moves.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { MAX_STAT_WIDGETS } from '../../shared/planner';
import type { StatWidget, StatWidgetPatch } from '../../shared/types';
import { logIpcError } from '../lib/ipcError';

export interface StatWidgetsState {
  widgets: StatWidget[];
  /** Bumped by refreshStatCards(); every card refetches when it moves. */
  revision: number;
  load(): Promise<void>;
  /** A Total time · This week card at main's next cascade step; a no-op at six. */
  add(): Promise<void>;
  /** Optimistic, so a drag, a range or a card change shows at once; undone if main fails. */
  patch(id: number, p: StatWidgetPatch): Promise<void>;
  remove(id: number): Promise<void>;
}

// The newest patch per widget. A reply to an older one is dropped, so a quick drag then a range
// change never jumps back to a state already left.
let patchSeq = new Map<number, number>();

export const useStatWidgetsStore: UseBoundStore<StoreApi<StatWidgetsState>> = create<StatWidgetsState>(
  (set, get) => ({
    widgets: [],
    revision: 0,
    async load() {
      try {
        set({ widgets: await window.studyat.statWidgets.list() });
      } catch (e) {
        // Never rejects: it runs unattended; the space is fine without its stats cards.
        logIpcError('Loading stats widgets failed', e);
      }
    },
    async add() {
      if (get().widgets.length >= MAX_STAT_WIDGETS) return;
      try {
        const added = await window.studyat.statWidgets.add();
        set({ widgets: [...get().widgets.filter((w) => w.id !== added.id), added] });
      } catch (e) {
        logIpcError('Adding a stats widget failed', e);
      }
    },
    async patch(id, p) {
      const before = get().widgets.find((w) => w.id === id);
      if (!before) return;
      const seq = (patchSeq.get(id) ?? 0) + 1;
      patchSeq.set(id, seq);
      const replace = (next: StatWidget | null): void =>
        set({
          widgets: next
            ? get().widgets.map((w) => (w.id === id ? next : w))
            : get().widgets.filter((w) => w.id !== id),
        });
      replace({ ...before, ...p });
      try {
        const saved = await window.studyat.statWidgets.update(id, p);
        // null: main has no such widget (removed elsewhere), so neither should the screen.
        if (patchSeq.get(id) === seq) replace(saved);
      } catch (e) {
        logIpcError('Saving a stats widget failed', e);
        if (patchSeq.get(id) === seq && get().widgets.some((w) => w.id === id)) replace(before);
      }
    },
    async remove(id) {
      try {
        await window.studyat.statWidgets.remove(id);
        set({ widgets: get().widgets.filter((w) => w.id !== id) });
      } catch (e) {
        logIpcError('Removing a stats widget failed', e);
      }
    },
  }),
);

/** Every card refetches (after a session edit or delete, a segment end, a focus minute). */
export function refreshStatCards(): void {
  useStatWidgetsStore.setState((s) => ({ revision: s.revision + 1 }));
}

/** Back to an empty mirror (tests). */
export function resetStatWidgetsStore(): void {
  patchSeq = new Map();
  useStatWidgetsStore.setState({ widgets: [], revision: 0 });
}
