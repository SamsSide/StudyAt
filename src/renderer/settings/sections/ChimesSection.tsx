// Settings → Chimes (spec §3.9): focus-end and break-end chimes from the five built-ins or a custom
// file, volume, repeat 1–3, a preview beside each, the last-minute tick and a chime on start.
import { useId, useState } from 'react';
import { BUILTIN_CHIME_IDS, CHIME_NAMES } from '../../audio/chimes';
import { audioEngine } from '../../audio/engine';
import { chimeUrl } from '../../audio/useChimes';
import type { ChimeId } from '../../../shared/types';
import { clamp, NumberField, Row, Toggle } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const CUSTOM = 'custom';
const isCustom = (id: ChimeId): boolean => id.startsWith('file:');

interface ChimePickerProps {
  label: string;
  value: ChimeId;
  volume: number;
  repeat: number;
  onPick: (id: ChimeId) => void;
}

function ChimePicker({ label, value, volume, repeat, onPick }: ChimePickerProps) {
  const id = useId();
  const [message, setMessage] = useState('');

  /** Registers a file as a sound (main shows the file dialog), then points the chime at it. */
  const chooseFile = async (): Promise<void> => {
    setMessage('');
    try {
      const before = new Set((await window.studyat.sounds.list()).map((s) => s.id));
      const after = await window.studyat.sounds.addFiles();
      const added = after.find((s) => !before.has(s.id) && s.kind === 'file');
      if (added) onPick(`file:${added.id}`);
    } catch (err) {
      console.error('Choosing a custom chime failed', err);
      setMessage("That file couldn't be added.");
    }
  };

  const preview = (): void => {
    void audioEngine
      .playChime(value, { volume, repeat, customUrl: chimeUrl(value) })
      .catch((err: unknown) => console.error('Chime preview failed', err));
  };

  return (
    <>
      <Row label={label} htmlFor={id}>
        <select
          id={id}
          className={styles.select}
          value={isCustom(value) ? CUSTOM : value}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM) {
              if (!isCustom(value)) void chooseFile();
            } else {
              onPick(next as ChimeId);
            }
          }}
        >
          {BUILTIN_CHIME_IDS.map((chime) => (
            <option key={chime} value={chime}>
              {CHIME_NAMES[chime]}
            </option>
          ))}
          <option value={CUSTOM}>Custom file…</option>
        </select>
        {isCustom(value) && (
          <button type="button" className={styles.button} onClick={() => void chooseFile()}>
            Change file…
          </button>
        )}
        <button type="button" className={styles.button} aria-label={`Preview ${label}`} onClick={preview}>
          ▶
        </button>
      </Row>
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
    </>
  );
}

export function ChimesSection({ settings, update }: SectionProps) {
  const volumeId = useId();
  return (
    <section aria-labelledby="settings-chimes">
      <h3 id="settings-chimes" className={styles.heading}>
        Chimes
      </h3>
      <ChimePicker
        label="Focus ends"
        value={settings.chimeFocusEnd}
        volume={settings.chimeVolume}
        repeat={settings.chimeRepeat}
        onPick={(id) => void update({ chimeFocusEnd: id })}
      />
      <ChimePicker
        label="Break ends"
        value={settings.chimeBreakEnd}
        volume={settings.chimeVolume}
        repeat={settings.chimeRepeat}
        onPick={(id) => void update({ chimeBreakEnd: id })}
      />
      <Row label="Volume" htmlFor={volumeId}>
        <input
          id={volumeId}
          type="range"
          className={styles.range}
          min={0}
          max={1}
          step={0.05}
          value={settings.chimeVolume}
          onChange={(e) => void update({ chimeVolume: clamp(Number(e.target.value), 0, 1) })}
        />
        <span className={styles.hint}>{Math.round(settings.chimeVolume * 100)}%</span>
      </Row>
      <NumberField
        label="Repeat"
        hint="How many times a chime plays"
        value={settings.chimeRepeat}
        min={1}
        max={3}
        onCommit={(n) => void update({ chimeRepeat: n })}
      />
      <Toggle
        label="Soft tick in the last minute"
        checked={settings.tickLastMinute}
        onChange={(v) => void update({ tickLastMinute: v })}
      />
      <Toggle
        label="Chime when focus starts"
        checked={settings.chimeOnStart}
        onChange={(v) => void update({ chimeOnStart: v })}
      />
      <Toggle
        label="Desktop notifications"
        hint="Shown when a session ends and the window is hidden"
        checked={settings.notifications}
        onChange={(v) => void update({ notifications: v })}
      />
    </section>
  );
}
