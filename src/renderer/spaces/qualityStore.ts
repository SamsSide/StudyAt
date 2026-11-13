// The quality the active YouTube space is playing at (spec §3.3), reported by the player in
// SpaceBackground and shown as a badge in the Spaces panel. Not persisted.
import { create } from 'zustand';
import { qualityLabel } from './youtube';

export interface QualityState {
  spaceId: number | null;
  level: string | null;
  playing: boolean;
  report(p: { spaceId: number; level?: string | null; playing?: boolean }): void;
  clear(): void;
}

export const useYouTubeQuality = create<QualityState>((set) => ({
  spaceId: null,
  level: null,
  playing: false,
  report: (p) =>
    set((s) =>
      // Another space's numbers never carry over.
      s.spaceId === p.spaceId
        ? { level: p.level === undefined ? s.level : p.level, playing: p.playing ?? s.playing }
        : { spaceId: p.spaceId, level: p.level ?? null, playing: p.playing ?? false },
    ),
  clear: () => set({ spaceId: null, level: null, playing: false }),
}));

/** "Playing · 2160p" while the active YouTube space plays, else "—". */
export function badgeText(s: QualityState, spaceId: number): string {
  return s.spaceId === spaceId && s.playing ? `Playing · ${qualityLabel(s.level)}` : '—';
}
