// The soundboard side panel (spec §3.9, appplan §4.3): master, the space's audio slider, one row per
// channel with mute and slider, "Add sound…", and mixes (save current levels, click to apply, delete).
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Mix, Sound } from '../../shared/types';
import { audioEngine } from '../audio/engine';
import styles from './SoundsPanel.module.css';
import { applyLevel, restoreSoundscape, soundKey } from './soundscape';

export interface SpaceAudio {
  get(): number;
  set(v: number): void;
}

export interface SoundsPanelProps {
  /** The active space's audio (YouTube volume / video element volume); the slider is hidden without it. */
  spaceAudio?: SpaceAudio;
}

/** Slider saves are batched so dragging does not hit the main process on every input event. */
const SAVE_DEBOUNCE_MS = 300;

export function SoundsPanel({ spaceAudio }: SoundsPanelProps) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [master, setMaster] = useState(0.8);
  const [space, setSpace] = useState(() => spaceAudio?.get() ?? 1);
  const [mixName, setMixName] = useState('');
  const [loaded, setLoaded] = useState(false);

  const levelsRef = useRef(levels);
  const masterRef = useRef(master);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef({ levels: false, master: false });
  /** Each channel's level before it was muted, so unmuting restores it. */
  const preMute = useRef<Record<string, number>>({});

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const patch: {
      soundLevels?: Record<string, number>;
      masterVolume?: number;
    } = {};
    if (dirty.current.levels) patch.soundLevels = levelsRef.current;
    if (dirty.current.master) patch.masterVolume = masterRef.current;
    dirty.current = { levels: false, master: false };
    if (patch.soundLevels || patch.masterVolume !== undefined) void window.studyat.settings.set(patch);
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => {
    let live = true;
    void restoreSoundscape().then((s) => {
      if (!live) return;
      setSounds(s.sounds);
      setMixes(s.mixes);
      setLevels(s.levels);
      levelsRef.current = s.levels;
      setMaster(s.master);
      masterRef.current = s.master;
      setLoaded(true);
    });
    return () => {
      live = false;
      flush(); // a slider moved just before closing the panel still persists
    };
  }, [flush]);

  const changeLevel = (sound: Sound, v: number) => {
    const next = { ...levelsRef.current, [soundKey(sound)]: v };
    levelsRef.current = next;
    setLevels(next);
    applyLevel(sound, v);
    dirty.current.levels = true;
    scheduleSave();
  };

  const changeMaster = (v: number) => {
    masterRef.current = v;
    setMaster(v);
    audioEngine.setMaster(v);
    dirty.current.master = true;
    scheduleSave();
  };

  const toggleMute = (sound: Sound) => {
    const key = soundKey(sound);
    const level = levelsRef.current[key] ?? 0;
    if (level > 0) {
      preMute.current[key] = level;
      changeLevel(sound, 0);
    } else {
      changeLevel(sound, preMute.current[key] ?? 0.5);
    }
  };

  const addSounds = async () => {
    setSounds(await window.studyat.sounds.addFiles());
  };

  const removeSound = async (sound: Sound) => {
    applyLevel(sound, 0);
    const next = { ...levelsRef.current };
    delete next[soundKey(sound)];
    levelsRef.current = next;
    setLevels(next);
    dirty.current.levels = true;
    scheduleSave();
    setSounds(await window.studyat.sounds.remove(sound.id));
  };

  // The API has no relocate for sounds (spaces do), so re-adding is remove then pick again.
  const relocate = async (sound: Sound) => {
    await removeSound(sound);
    setSounds(await window.studyat.sounds.addFiles());
  };

  const saveMix = async (e: FormEvent) => {
    e.preventDefault();
    const name = mixName.trim();
    if (!name) return;
    const current: Record<string, number> = {};
    for (const [k, v] of Object.entries(levelsRef.current)) if (v > 0) current[k] = v;
    setMixes(await window.studyat.mixes.save(name, current));
    setMixName('');
  };

  const applyMix = (mix: Mix) => {
    const next: Record<string, number> = {};
    for (const s of sounds) {
      const v = mix.levels[soundKey(s)] ?? 0;
      next[soundKey(s)] = v;
      applyLevel(s, v);
    }
    levelsRef.current = next;
    setLevels(next);
    dirty.current.levels = true;
    scheduleSave();
  };

  const deleteMix = async (mix: Mix) => {
    setMixes(await window.studyat.mixes.remove(mix.id));
  };

  return (
    <div className={styles.panel} data-testid="sounds-panel">
      <label className={styles.master}>
        <span>Master volume</span>
        <input
          className={styles.slider}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={master}
          aria-label="Master volume"
          onChange={(e) => changeMaster(Number(e.target.value))}
        />
      </label>

      {spaceAudio && (
        <label className={styles.master}>
          <span>Space audio</span>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={space}
            aria-label="Space audio"
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpace(v);
              spaceAudio.set(v);
            }}
          />
        </label>
      )}

      <ul className={styles.list}>
        {sounds.map((s) => {
          const level = levels[soundKey(s)] ?? 0;
          return (
            <li key={s.id} className={`${styles.row} ${s.missing ? styles.missing : ''}`}>
              <button
                type="button"
                className={styles.button}
                aria-pressed={level === 0}
                aria-label={level === 0 ? `Unmute ${s.name}` : `Mute ${s.name}`}
                disabled={s.missing}
                onClick={() => toggleMute(s)}
              >
                {level === 0 ? 'Muted' : 'On'}
              </button>
              <span className={styles.name}>{s.name}</span>
              <div className={styles.channelControl}>
                {s.missing ? (
                  <button type="button" className={styles.button} onClick={() => void relocate(s)}>
                    File moved — Relocate…
                  </button>
                ) : (
                  <input
                    className={styles.slider}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={level}
                    aria-label={`${s.name} volume`}
                    onChange={(e) => changeLevel(s, Number(e.target.value))}
                  />
                )}
                {!s.builtin && (
                  <button
                    type="button"
                    className={styles.button}
                    aria-label={`Remove ${s.name}`}
                    onClick={() => void removeSound(s)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className={styles.primary} onClick={() => void addSounds()}>
        Add sound…
      </button>

      <h3 className={styles.heading}>Mixes</h3>
      {loaded && mixes.length === 0 && <p className={styles.empty}>No mixes yet.</p>}
      <ul className={styles.list}>
        {mixes.map((m) => (
          <li key={m.id} className={styles.mix}>
            <button
              type="button"
              className={`${styles.button} ${styles.mixName}`}
              onClick={() => applyMix(m)}
            >
              {m.name}
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={`Delete ${m.name}`}
              onClick={() => void deleteMix(m)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form className={styles.form} onSubmit={(e) => void saveMix(e)}>
        <input
          className={styles.input}
          type="text"
          value={mixName}
          placeholder="Mix name"
          aria-label="Mix name"
          maxLength={60}
          onChange={(e) => setMixName(e.target.value)}
        />
        <button type="submit" className={styles.primary} disabled={mixName.trim() === ''}>
          Save mix
        </button>
      </form>
    </div>
  );
}
