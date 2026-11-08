// Renderer-side spaces state shared by the background, the panel and the Sounds panel's
// space-audio slider (spec §3.8). The main process owns the data; this mirrors it.
import { create } from 'zustand';
import type { SpacePatch } from '../../shared/ipc';
import type { Space } from '../../shared/types';

/** The renderer saves a captured thumbnail through the same channel (main's patch allows it). */
export type RendererSpacePatch = SpacePatch & { thumb?: string };

export interface SpacesState {
  spaces: Space[];
  activeId: number | null;
  loaded: boolean;
  /** Space ids whose YouTube embed failed (error 101/150). */
  embedErrors: Record<number, true>;
  load(): Promise<void>;
  apply(spaces: Space[]): void;
  setActive(id: number): Promise<void>;
  update(id: number, patch: RendererSpacePatch): Promise<void>;
  markEmbedError(id: number): void;
}

export const useSpacesStore = create<SpacesState>((set, get) => ({
  spaces: [],
  activeId: null,
  loaded: false,
  embedErrors: {},
  async load() {
    const [spaces, settings] = await Promise.all([window.studyat.spaces.list(), window.studyat.settings.get()]);
    set({ spaces, activeId: settings.activeSpaceId, loaded: true });
  },
  apply(spaces) {
    set({ spaces });
  },
  async setActive(id) {
    set({ activeId: id });
    set({ spaces: await window.studyat.spaces.setActive(id) });
  },
  async update(id, patch) {
    // Optimistic, so sliders and the background follow the pointer.
    set({
      spaces: get().spaces.map((s) => (s.id === id ? { ...s, ...patch, opts: { ...s.opts, ...patch.opts } } : s)),
    });
    set({ spaces: await window.studyat.spaces.update(id, patch) });
  },
  markEmbedError(id) {
    set({ embedErrors: { ...get().embedErrors, [id]: true } });
  },
}));

export const resetSpacesStore = (): void =>
  useSpacesStore.setState({ spaces: [], activeId: null, loaded: false, embedErrors: {} });

export const mediaUrl = (id: number): string => `studyat-media://space/${id}`;
