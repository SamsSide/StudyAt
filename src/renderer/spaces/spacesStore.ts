// Renderer-side spaces state shared by the background, the panel and the Sounds panel's
// space-audio slider (spec §3.8). The main process owns the data; this mirrors it.
import { create } from 'zustand';
import type { SpacePatch } from '../../shared/ipc';
import type { Space } from '../../shared/types';

/**
 * Why a YouTube space isn't playing: `embed` = the owner disabled embedding (101/150), which is
 * permanent; `play` = any other player error or the API script failing to load, which may pass.
 */
export type VideoError = 'embed' | 'play';

export interface SpacesState {
  spaces: Space[];
  activeId: number | null;
  loaded: boolean;
  /** YouTube spaces that failed this session, by id. */
  embedErrors: Record<number, VideoError>;
  load(): Promise<void>;
  apply(spaces: Space[]): void;
  /** Re-reads the list from main, e.g. after a failed call left the mirror unsure. */
  reload(): Promise<void>;
  setActive(id: number): Promise<void>;
  update(id: number, patch: SpacePatch): Promise<void>;
  markEmbedError(id: number, kind?: VideoError): void;
  /** Forgets every `play` mark (the connection is back); embed blocks stay. */
  clearPlayErrors(): void;
}

// The newest update per space. A reply to an older one is dropped, so a slider dragged quickly
// never jumps back to a value it has already left.
let updateSeq = new Map<number, number>();

export const useSpacesStore = create<SpacesState>((set, get) => ({
  spaces: [],
  activeId: null,
  loaded: false,
  embedErrors: {},
  async load() {
    const [spaces, settings] = await Promise.all([
      window.studyat.spaces.list(),
      window.studyat.settings.get(),
    ]);
    set({ spaces, activeId: settings.activeSpaceId, loaded: true });
  },
  apply(spaces) {
    set({ spaces });
  },
  async reload() {
    try {
      set({ spaces: await window.studyat.spaces.list() });
    } catch {
      // Main is unreachable; keep what we have rather than blanking the panel.
    }
  },
  async setActive(id) {
    // Picking a space again retries one that couldn't play; an embed block stays.
    const { [id]: mark, ...rest } = get().embedErrors;
    const previous = get().activeId;
    set({ activeId: id, ...(mark === 'play' ? { embedErrors: rest } : {}) });
    try {
      set({ spaces: await window.studyat.spaces.setActive(id) });
    } catch (e) {
      // Main didn't save it: show what will be restored on launch, not a choice that was lost.
      if (get().activeId === id) set({ activeId: previous });
      throw e;
    }
  },
  async update(id, patch) {
    const seq = (updateSeq.get(id) ?? 0) + 1;
    updateSeq.set(id, seq);
    // Optimistic, so sliders and the background follow the pointer.
    set({
      spaces: get().spaces.map((s) =>
        s.id === id ? { ...s, ...patch, opts: { ...s.opts, ...patch.opts } } : s,
      ),
    });
    try {
      const spaces = await window.studyat.spaces.update(id, patch);
      if (updateSeq.get(id) === seq) set({ spaces });
    } catch {
      // The save failed: re-read main's copy, which undoes the optimistic change.
      if (updateSeq.get(id) === seq) await get().reload();
    }
  },
  markEmbedError(id, kind = 'embed') {
    set({ embedErrors: { ...get().embedErrors, [id]: kind } });
  },
  clearPlayErrors() {
    const errors = get().embedErrors;
    const kept = Object.fromEntries(Object.entries(errors).filter(([, kind]) => kind === 'embed'));
    if (Object.keys(kept).length !== Object.keys(errors).length) set({ embedErrors: kept });
  },
}));

export const resetSpacesStore = (): void => {
  updateSeq = new Map();
  useSpacesStore.setState({ spaces: [], activeId: null, loaded: false, embedErrors: {} });
};

export const mediaUrl = (id: number): string => `studyat-media://space/${id}`;
