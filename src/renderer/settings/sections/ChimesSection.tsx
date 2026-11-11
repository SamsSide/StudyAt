// Settings → Chimes (spec §3.9): focus-end and break-end chimes from the five built-ins or a custom
// file, volume, repeat 1–3, a preview beside each, the last-minute tick and a chime on start.
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { BUILTIN_CHIME_IDS, CHIME_NAMES } from '../../audio/chimes';
import { audioEngine } from '../../audio/engine';
import { chimeUrl, playCountdownPreview } from '../../audio/useChimes';
import { logIpcError } from '../../lib/ipcError';
import { useStudyStore } from '../../shell/store';
import type { ChimeId, Sound } from '../../../shared/types';
import { clamp, NumberField, Row, Toggle } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const CUSTOM = 'custom';
const VOLUME_SAVE_DELAY_MS = 250;
const isCustom = (id: ChimeId): boolean => id.startsWith('file:');

interface ChimePickerProps {
  label: string;
  value: ChimeId;
  volume: number;
  repeat: number;
  /** Sounds that are files, so a registered one can be picked straight from the list. */
  files: Sound[];
  onFilesChanged: (sounds: Sound[]) => void;
  onPick: (id: ChimeId) => void;
}

function ChimePicker({ label, value, volume, repeat, files, onFilesChanged, onPick }: ChimePickerProps) {
  const id = useId();
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');

  /** Registers a file as a sound (main shows the file dialog), then points the chime at it. */
  const chooseFile = async (): Promise<void> => {
    setMessage('');
    setNote('');
    try {
      const before = new Set((await window.studyat.sounds.list()).map((s) => s.id));
      const after = await window.studyat.sounds.addFiles();
      onFilesChanged(after.filter((s) => s.kind === 'file'));
      const added = after.find((s) => !before.has(s.id) && s.kind === 'file');
      if (added) onPick(`file:${added.id}`);
      else if (before.size > 0)
        // Cancelled, or a file that is already registered (main doesn't say which), so a quiet
        // note rather than an alert.
        setNote('No new sound was added. If the file is already in your sounds, pick it from the list.');
    } catch (err) {
      logIpcError('Choosing a custom chime failed', err);
      setMessage("That file couldn't be added.");
    }
  };

  const hasOption = files.some((s) => `file:${s.id}` === value);

  const preview = (): void => {
    void audioEngine
      .playChime(value, { volume, repeat, customUrl: chimeUrl(value) })
      .catch((err: unknown) => logIpcError('Chime preview failed', err));
  };

  return (
    <>
      <Row label={label} htmlFor={id}>
        <select
          id={id}
          className={styles.select}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM) {
              void chooseFile();
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
          {files.map((sound) => (
            <option key={sound.id} value={`file:${sound.id}`}>
              {sound.name}
            </option>
          ))}
          {isCustom(value) && !hasOption && <option value={value}>Custom file</option>}
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
      {note && (
        <p role="status" className={styles.note}>
          {note}
        </p>
      )}
    </>
  );
}

export function ChimesSection({ settings, update }: SectionProps) {
  const volumeId = useId();
  const [files, setFiles] = useState<Sound[]>([]);
  // The slider follows the finger; the save waits until it settles. While a value is waiting or
  // saving, an older answer from main never pulls the slider back; once the last save lands the
  // slider takes main's value, so a failed save shows what is really stored.
  const [volume, setVolume] = useState(settings.chimeVolume);
  const [dirty, setDirty] = useState(false);
  const [seenVolume, setSeenVolume] = useState(settings.chimeVolume);
  if (seenVolume !== settings.chimeVolume) {
    setSeenVolume(settings.chimeVolume);
    if (!dirty) setVolume(settings.chimeVolume);
  }
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: number } | null>(null);
  const latest = useRef(0);
  const saveVolume = useRef((_value: number): Promise<unknown> => Promise.resolve());
  useEffect(() => {
    saveVolume.current = (value: number) => update({ chimeVolume: value });
  });

  const changeVolume = (next: number): void => {
    setVolume(next);
    setDirty(true);
    const ticket = ++latest.current;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      value: next,
      timer: setTimeout(() => {
        pending.current = null;
        void saveVolume.current(next).finally(() => {
          if (ticket !== latest.current) return;
          setDirty(false);
          setVolume(useStudyStore.getState().settings?.chimeVolume ?? next);
        });
      }, VOLUME_SAVE_DELAY_MS),
    };
  };

  // Leaving the section mid-drag still saves where the slider stopped.
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      void saveVolume.current(pending.current.value);
    },
    [],
  );

  useEffect(() => {
    let live = true;
    window.studyat.sounds.list().then(
      (list) => live && setFiles(list.filter((s) => s.kind === 'file')),
      (err: unknown) => logIpcError('Listing sounds failed', err),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="settings-chimes">
      <h3 id="settings-chimes" className={styles.heading}>
        Chimes
      </h3>
      <ChimePicker
        label="Focus ends"
        value={settings.chimeFocusEnd}
        volume={volume}
        repeat={settings.chimeRepeat}
        files={files}
        onFilesChanged={setFiles}
        onPick={(id) => void update({ chimeFocusEnd: id })}
      />
      <ChimePicker
        label="Break ends"
        value={settings.chimeBreakEnd}
        volume={volume}
        repeat={settings.chimeRepeat}
        files={files}
        onFilesChanged={setFiles}
        onPick={(id) => void update({ chimeBreakEnd: id })}
      />
      <Row label="Volume" htmlFor={volumeId}>
        <input
          id={volumeId}
          type="range"
          className={styles.range}
          style={{ '--fill': `${volume * 100}%` } as CSSProperties}
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => changeVolume(clamp(Number(e.target.value), 0, 1))}
        />
        <span className={styles.hint}>{Math.round(volume * 100)}%</span>
      </Row>
      <NumberField
        label="Repeat"
        hint="How many times a chime plays"
        value={settings.chimeRepeat}
        min={1}
        max={3}
        onCommit={(n) => update({ chimeRepeat: n })}
      />
      <Toggle
        label="Soft tick in the last minute"
        checked={settings.tickLastMinute}
        onChange={(v) => update({ tickLastMinute: v })}
      />
      <Toggle
        label="Count down the last 3 seconds"
        checked={settings.countdownPips}
        onChange={(v) => update({ countdownPips: v })}
      />
      <Row label="Preview countdown" hint="Three pips, then the focus-end chime">
        <button
          type="button"
          className={styles.button}
          onClick={() => playCountdownPreview({ ...settings, chimeVolume: volume })}
        >
          Preview
        </button>
      </Row>
      <Toggle
        label="Chime when focus starts"
        checked={settings.chimeOnStart}
        onChange={(v) => update({ chimeOnStart: v })}
      />
      <Toggle
        label="Desktop notifications"
        hint="Shown when a session ends and the window is hidden"
        checked={settings.notifications}
        onChange={(v) => update({ notifications: v })}
      />
    </section>
  );
}
