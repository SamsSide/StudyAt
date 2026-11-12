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
  /** The last `load` failed, so there is nothing honest to show yet. */
  loadFailed: boolean;
  /** YouTube spaces that failed this session, by id. */
  embedErrors: Record<number, VideoError>;
  /**
   * Sam paused the moving background (spec §3.4). Renderer only, never saved: it goes back to
   * playing whenever the active space changes and on app start.
   */
  backgroundPaused: boolean;
  /**
   * The space whose still Sam started under reduced motion (spec §3.4). Renderer only, never saved;
   * keyed by space id, so another space starts on its still again.
   */
  stillPlayId: number | null;
  load(): Promise<void>;
  apply(spaces: Space[]): void;
  /** Re-reads the list from main, e.g. after a failed call left the mirror unsure. */
  reload(): Promise<void>;
  setActive(id: number): Promise<void>;
  update(id: number, patch: SpacePatch): Promise<void>;
  markEmbedError(id: number, kind?: VideoError): void;
  /** Forgets every `play` mark (the connection is back); embed blocks stay. */
  clearPlayErrors(): void;
  /** Forgets one space's mark: its player has reached PLAYING, so it plainly can play. */
  clearVideoError(id: number): void;
  setBackgroundPaused(paused: boolean): void;
  /** Starts the active space's background: clears a pause and leaves the still. */
  playBackground(): void;
  /**
   * Plays when effectively paused, pauses otherwise. No-op unless the active space is a video or
   * YouTube space. `reduced` is whether reduced motion is on, which makes the still count as paused.
   */
  toggleBackground(reduced?: boolean): void;
}

/**
 * Whether the background is not moving because of Sam: paused, or (under reduced motion) still on
 * the still. The footer, the top bar and V all read this, so they never disagree.
 */
export const isBackgroundPaused = (
  s: Pick<SpacesState, 'backgroundPaused' | 'stillPlayId' | 'activeId'>,
  reduced: boolean,
): boolean => s.backgroundPaused || (reduced && s.stillPlayId !== s.activeId);

// The newest update per space. A reply to an older one is dropped, so a slider dragged quickly
// never jumps back to a value it has already left.
let updateSeq = new Map<number, number>();

export const useSpacesStore = create<SpacesState>((set, get) => ({
  spaces: [],
  activeId: null,
  loaded: false,
  loadFailed: false,
  embedErrors: {},
  backgroundPaused: false,
  stillPlayId: null,
  async load() {
    try {
      const [spaces, settings] = await Promise.all([
        window.studyat.spaces.list(),
        window.studyat.settings.get(),
      ]);
      set({ spaces, activeId: settings.activeSpaceId, loaded: true, loadFailed: false });
    } catch (e) {
      // Never rejects: the background and the panel both call this unattended. The panel shows
      // the failure and offers "Try again"; main's reason goes to the log only (ruling R38).
      console.warn('Spaces failed to load', e);
      set({ loadFailed: true });
    }
  },
  apply(spaces) {
    // The active space was removed: nothing is left to be paused.
    const gone = !spaces.some((s) => s.id === get().activeId);
    set({ spaces, ...(gone ? { backgroundPaused: false, stillPlayId: null } : {}) });
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
  clearVideoError(id) {
    const { [id]: mark, ...rest } = get().embedErrors;
    if (mark) set({ embedErrors: rest });
  },
  setBackgroundPaused(paused) {
    set({ backgroundPaused: paused });
  },
  playBackground() {
    set({ stillPlayId: get().activeId, backgroundPaused: false });
  },
  toggleBackground(reduced = false) {
    const state = get();
    const active = state.spaces.find((s) => s.id === state.activeId);
    if (!active || active.kind === 'image') return;
    if (isBackgroundPaused(state, reduced)) state.playBackground();
    else set({ backgroundPaused: true });
  },
}));

// Whatever changes the active space (a pick, a load, a failed pick rolling back) starts it playing.
useSpacesStore.subscribe((state, prev) => {
  if (state.activeId !== prev.activeId && (state.backgroundPaused || state.stillPlayId !== null)) {
    useSpacesStore.setState({ backgroundPaused: false, stillPlayId: null });
  }
});

export const resetSpacesStore = (): void => {
  updateSeq = new Map();
  useSpacesStore.setState({
    spaces: [],
    activeId: null,
    loaded: false,
    loadFailed: false,
    embedErrors: {},
    backgroundPaused: false,
    stillPlayId: null,
  });
};

export const mediaUrl = (id: number): string => `studyat-media://space/${id}`;
