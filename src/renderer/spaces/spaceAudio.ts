// The active space's audio level for the Sounds panel slider (spec §3.9). Reads and writes the
// active space's `opts.volume`; SpaceBackground applies it to the playing <video>/YouTube player.
// Image spaces have no audio, so the slider is disabled for them and `set` does nothing.
import type { Space } from '../../shared/types';
import { useSpacesStore, type SpacesState } from './spacesStore';

const activeIn = (st: Pick<SpacesState, 'spaces' | 'activeId'>): Space | null =>
  st.spaces.find((s) => s.id === st.activeId) ?? null;
const hasAudio = (s: Space | null): s is Space => s !== null && s.kind !== 'image';
const levelOf = (s: Space | null): number => (hasAudio(s) && s.opts.audio ? s.opts.volume : 0);

export const spaceAudio = {
  /** 0 when the space is muted, is an image, or none is active, else its volume. */
  get(): number {
    return levelOf(activeIn(useSpacesStore.getState()));
  },
  /** Whether the active space has a sound track at all (videos and YouTube do; images don't). */
  canPlayAudio(): boolean {
    return hasAudio(activeIn(useSpacesStore.getState()));
  },
  /** Calls `listener` whenever the active space or its level may have changed. */
  subscribe(listener: () => void): () => void {
    return useSpacesStore.subscribe(listener);
  },
  set(v: number): void {
    const s = activeIn(useSpacesStore.getState());
    if (!hasAudio(s)) return;
    const volume = Math.min(1, Math.max(0, v));
    void useSpacesStore.getState().update(s.id, { opts: { volume, audio: volume > 0 } });
  },
};

/**
 * React binding: `[level, setLevel, canPlayAudio]`, re-rendering when the active space or its
 * audio changes. Disable the slider when `canPlayAudio` is false.
 */
export function useSpaceAudio(): [number, (v: number) => void, boolean] {
  const level = useSpacesStore((st) => levelOf(activeIn(st)));
  const canPlay = useSpacesStore((st) => hasAudio(activeIn(st)));
  return [level, spaceAudio.set, canPlay];
}
