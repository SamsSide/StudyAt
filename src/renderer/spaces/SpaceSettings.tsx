// Per-space options (spec §3.8, §3.3): audio, volume, speed, dim, blur and a YouTube space's
// quality. Saves through spaces.update.
import type { CSSProperties } from 'react';
import type { Space, SpaceOpts } from '../../shared/types';
import styles from './spaces.module.css';
import { badgeText, useYouTubeQuality } from './qualityStore';
import { useSpacesStore } from './spacesStore';
import { QUALITY_HINT, QUALITY_OPTIONS } from './youtube';

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

/** YouTube plays only at 0.25 steps (0.5, 0.75, 1, 1.25, 1.5); a finer step would be ignored. */
const YOUTUBE_SPEED_STEP = 0.25;

/** How far along its track a slider is, for the accent fill. */
const fill = (value: number, min: number, max: number): CSSProperties =>
  ({ '--fill': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

/** "Playing · 2160p" while this space plays on YouTube, else "—" (spec §3.3). */
export function QualityBadge({ spaceId }: { spaceId: number }) {
  const text = useYouTubeQuality((s) => badgeText(s, spaceId));
  return (
    <span className={styles.qualityBadge} role="status" aria-label="Playing quality">
      {text}
    </span>
  );
}

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
            step={s.key === 'speed' && space.kind === 'youtube' ? YOUTUBE_SPEED_STEP : s.step}
            value={space.opts[s.key]}
            onChange={(e) => {
              const v = Number(e.target.value);
              save(s.key === 'volume' ? { volume: v, audio: v > 0 } : { [s.key]: v });
            }}
          />
        </label>
      ))}
      {space.kind === 'youtube' && (
        <div className={styles.field} role="group" aria-label="Quality">
          <span className={styles.qualityHead}>
            Quality
            <QualityBadge spaceId={space.id} />
          </span>
          <div className={styles.tabs}>
            {QUALITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={styles.tab}
                aria-pressed={space.opts.quality === o.value}
                onClick={() => save({ quality: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className={styles.hint}>{QUALITY_HINT}</span>
        </div>
      )}
      <button type="button" className={styles.btn} onClick={onClose}>
        Done
      </button>
    </section>
  );
}
