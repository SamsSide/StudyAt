// Glue between the persisted soundboard (settings.soundLevels / masterVolume, the `sounds` table) and
// the audio engine (spec §3.9). App calls `restoreSoundscape` at launch; the panel calls it on mount.
import type { Mix, PublicSettings, Sound } from '../../shared/types';
import { audioEngine } from '../audio/engine';

export const soundKey = (s: Sound): string => String(s.id);

/** Noise is generated, so it has no URL; files are served by id through the media protocol. */
export const soundUrl = (s: Sound): string => (s.kind === 'noise' ? '' : `studyat-media://sound/${s.id}`);

/** Pushes one channel's level to the engine; a missing file stays silent. */
export function applyLevel(sound: Sound, level: number): void {
  void audioEngine.setLevel(sound, sound.missing ? 0 : level, soundUrl(sound));
}

export interface Soundscape {
  sounds: Sound[];
  mixes: Mix[];
  levels: Record<string, number>;
  master: number;
  settings: PublicSettings;
}

/** Loads sounds, mixes and settings, and restores master and every channel level into the engine. */
export async function restoreSoundscape(): Promise<Soundscape> {
  const api = window.studyat;
  const [sounds, mixes, settings] = await Promise.all([
    api.sounds.list(),
    api.mixes.list(),
    api.settings.get(),
  ]);
  audioEngine.setMaster(settings.masterVolume);
  for (const s of sounds) {
    const level = settings.soundLevels[soundKey(s)] ?? 0;
    if (level > 0) applyLevel(s, level);
  }
  return {
    sounds,
    mixes,
    levels: { ...settings.soundLevels },
    master: settings.masterVolume,
    settings,
  };
}
