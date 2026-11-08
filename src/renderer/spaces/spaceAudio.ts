// The active space's audio level for the Sounds panel slider (spec §3.9). Reads and writes the
// active space's `opts.volume`; SpaceBackground applies it to the playing <video>/YouTube player.
import { useSpacesStore } from './spacesStore';

const activeSpace = () => {
  const { spaces, activeId } = useSpacesStore.getState();
  return spaces.find((s) => s.id === activeId) ?? null;
};

export const spaceAudio = {
  /** 0 when the space is muted or none is active, else its volume. */
  get(): number {
    const s = activeSpace();
    return s && s.opts.audio ? s.opts.volume : 0;
  },
  set(v: number): void {
    const s = activeSpace();
    if (!s) return;
    const volume = Math.min(1, Math.max(0, v));
    void useSpacesStore.getState().update(s.id, { opts: { volume, audio: volume > 0 } });
  },
};

/** React binding: `[level, setLevel]`, re-rendering when the active space or its audio changes. */
export function useSpaceAudio(): [number, (v: number) => void] {
  const level = useSpacesStore((st) => {
    const s = st.spaces.find((x) => x.id === st.activeId);
    return s && s.opts.audio ? s.opts.volume : 0;
  });
  return [level, spaceAudio.set];
}
