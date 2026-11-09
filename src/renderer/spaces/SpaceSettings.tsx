// Per-space options (spec §3.8): audio, volume, speed, dim, blur. Saves through spaces.update.
import type { CSSProperties } from 'react';
import type { Space, SpaceOpts } from '../../shared/types';
import styles from './spaces.module.css';
import { useSpacesStore } from './spacesStore';

interface Slider {
  key: 'volume' | 'speed' | 'dim' | 'blur';
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: Slider[] = [
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05 },
  { key: 'speed', label: 'Speed', min: 0.5, max: 1.5, step: 0.05 },
  { key: 'dim', label: 'Dim', min: 0, max: 0.6, step: 0.05 },
  { key: 'blur', label: 'Blur', min: 0, max: 12, step: 1 },
];

/** How far along its track a slider is, for the accent fill. */
const fill = (value: number, min: number, max: number): CSSProperties =>
  ({ '--fill': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

export function SpaceSettings({ space, onClose }: { space: Space; onClose: () => void }) {
  const update = useSpacesStore((s) => s.update);
  const save = (opts: Partial<SpaceOpts>) => void update(space.id, { opts });
  const hasAudio = space.kind !== 'image';
  return (
    <section aria-label={`Settings for ${space.name}`} className={styles.settings}>
      <h3>{space.name}</h3>
      {hasAudio && (
        <label className={styles.switchField}>
          Audio
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={space.opts.audio}
            onChange={(e) => save({ audio: e.target.checked })}
          />
        </label>
      )}
      {SLIDERS.filter((s) => hasAudio || s.key === 'dim' || s.key === 'blur').map((s) => (
        <label key={s.key} className={styles.field}>
          {s.label}
          <input
            type="range"
            className={styles.range}
            style={fill(space.opts[s.key], s.min, s.max)}
            min={s.min}
            max={s.max}
            step={s.step}
            value={space.opts[s.key]}
            onChange={(e) => {
              const v = Number(e.target.value);
              save(s.key === 'volume' ? { volume: v, audio: v > 0 } : { [s.key]: v });
            }}
          />
        </label>
      ))}
      <button type="button" className={styles.btn} onClick={onClose}>
        Done
      </button>
    </section>
  );
}
