// The soundboard side panel (spec §3.9, appplan §4.3): master, the space's audio slider, one row per
// channel with mute and slider, "Add sound…", and mixes (save current levels, click to apply, delete).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from 'react';
import type { Mix, Sound } from '../../shared/types';
import { audioEngine } from '../audio/engine';
import styles from './SoundsPanel.module.css';
import { applyLevel, restoreSoundscape, soundKey, type Soundscape } from './soundscape';

export interface SpaceAudio {
  get(): number;
  set(v: number): void;
  /** Re-read `get` whenever this fires, so the slider follows changes made elsewhere. */
  subscribe?(listener: () => void): () => void;
}

export interface SoundsPanelProps {
  /** The active space's audio (YouTube volume / video element volume); the slider is hidden without it. */
  spaceAudio?: SpaceAudio;
}

/** Slider saves are batched so dragging does not hit the main process on every input event. */
const SAVE_DEBOUNCE_MS = 300;

const SAVE_FAILED = "Couldn't save your sound levels.";

const noSubscribe = (): (() => void) => () => undefined;

/** How far along its track a 0–1 slider is, for the accent fill. */
const fill = (v: number): CSSProperties => ({ '--fill': `${Math.round(v * 100)}%` }) as CSSProperties;

/** Our own speaker glyph: waves while it plays, a cross while muted. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5Z" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {muted ? (
          <path d="m10.5 6.3 3.4 3.4m0-3.4-3.4 3.4" />
        ) : (
          <>
            <path d="M10.4 6.2a2.6 2.6 0 0 1 0 3.6" />
            <path d="M12.3 4.5a5 5 0 0 1 0 7" />
          </>
        )}
      </g>
    </svg>
  );
}

export function SoundsPanel({ spaceAudio }: SoundsPanelProps) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [master, setMaster] = useState(0.8);
  // The active space's level, live: it follows the space's own settings and a switch of space.
  const space = useSyncExternalStore(spaceAudio?.subscribe ?? noSubscribe, () => spaceAudio?.get() ?? 1);
  const [mixName, setMixName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!patch.soundLevels && patch.masterVolume === undefined) return;
    window.studyat.settings.set(patch).then(
      () => setError((cur) => (cur === SAVE_FAILED ? null : cur)),
      (e: unknown) => {
        // Still unsaved: the next change (or closing the panel) sends it again with the latest values.
        if (patch.soundLevels) dirty.current.levels = true;
        if (patch.masterVolume !== undefined) dirty.current.master = true;
        console.warn(SAVE_FAILED, e);
        setError(SAVE_FAILED);
      },
    );
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const live = useRef(true);
  const adopt = useCallback((s: Soundscape) => {
    if (!live.current) return;
    setSounds(s.sounds);
    setMixes(s.mixes);
    setLevels(s.levels);
    levelsRef.current = s.levels;
    setMaster(s.master);
    masterRef.current = s.master;
    setLoaded(true);
    setLoadFailed(false);
  }, []);
  const failLoad = useCallback((e: unknown) => {
    // A fixed sentence on screen; main's reason goes to the log only (ruling R38).
    console.warn("Couldn't load your sounds.", e);
    if (live.current) setLoadFailed(true);
  }, []);
  const load = () => restoreSoundscape().then(adopt, failLoad);

  useEffect(() => {
    live.current = true;
    restoreSoundscape().then(adopt, failLoad);
    return () => {
      live.current = false;
      flush(); // a slider moved just before closing the panel still persists
    };
  }, [adopt, failLoad, flush]);

  /** Runs a call to main; a rejection becomes the inline error rather than an unhandled one. */
  const attempt = async (call: () => Promise<void>, failure: string): Promise<void> => {
    setError(null);
    try {
      await call();
    } catch (e) {
      // A fixed sentence on screen; main's reason (which may name a path) goes to the log (R38).
      console.warn(failure, e);
      setError(failure);
    }
  };

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

  const addSounds = () =>
    attempt(async () => setSounds(await window.studyat.sounds.addFiles()), "Couldn't add that sound.");

  const removeSound = (sound: Sound) =>
    attempt(async () => {
      applyLevel(sound, 0);
      const next = { ...levelsRef.current };
      delete next[soundKey(sound)];
      levelsRef.current = next;
      setLevels(next);
      dirty.current.levels = true;
      scheduleSave();
      setSounds(await window.studyat.sounds.remove(sound.id));
    }, "Couldn't remove that sound.");

  // Main opens the picker and points the sound at the new file, keeping its id, so its saved level and
  // every mix that names it stay right. A cancelled picker returns the list unchanged.
  const relocate = (sound: Sound) =>
    attempt(async () => {
      const list = await window.studyat.sounds.relocate(sound.id);
      setSounds(list);
      const found = list.find((s) => s.id === sound.id);
      const level = levelsRef.current[soundKey(sound)] ?? 0;
      // Found again: start it at the level it was saved with.
      if (found && !found.missing && level > 0) applyLevel(found, level);
    }, "Couldn't relocate that sound.");

  const saveMix = async (e: FormEvent) => {
    e.preventDefault();
    const name = mixName.trim();
    if (!name) return;
    const current: Record<string, number> = {};
    for (const [k, v] of Object.entries(levelsRef.current)) if (v > 0) current[k] = v;
    await attempt(async () => {
      setMixes(await window.studyat.mixes.save(name, current));
      setMixName('');
    }, "Couldn't save that mix.");
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

  const deleteMix = (mix: Mix) =>
    attempt(async () => setMixes(await window.studyat.mixes.remove(mix.id)), "Couldn't delete that mix.");

  if (loadFailed && !loaded)
    return (
      <div className={styles.panel} data-testid="sounds-panel">
        <div className={styles.loadFailed} role="status">
          <p className={styles.error}>Couldn't load your sounds.</p>
          <button type="button" className={styles.button} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );

  return (
    <div className={styles.panel} data-testid="sounds-panel">
      <div className={styles.group}>
        <label className={styles.control}>
          <span className={styles.label}>Master volume</span>
          <input
            className={styles.slider}
            style={fill(master)}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={master}
            aria-label="Master volume"
            disabled={!loaded} // a move before the saved levels arrive would be overwritten by them
            onChange={(e) => changeMaster(Number(e.target.value))}
          />
        </label>

        {spaceAudio && (
          <label className={styles.control}>
            <span className={styles.label}>Space audio</span>
            <input
              className={styles.slider}
              style={fill(space)}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={space}
              aria-label="Space audio"
              onChange={(e) => spaceAudio.set(Number(e.target.value))}
            />
          </label>
        )}
      </div>

      <ul className={`${styles.list} ${styles.group}`}>
        {sounds.map((s) => {
          const level = levels[soundKey(s)] ?? 0;
          return (
            <li key={s.id} className={`${styles.row} ${s.missing ? styles.missing : ''}`}>
              <button
                type="button"
                className={styles.mute}
                aria-pressed={level === 0}
                aria-label={`Mute ${s.name}`}
                disabled={s.missing}
                onClick={() => toggleMute(s)}
              >
                <SpeakerIcon muted={level === 0} />
              </button>
              <span className={styles.name} title={s.name}>
                {s.name}
              </span>
              <div className={styles.channelControl}>
                {s.missing ? (
                  <button type="button" className={styles.button} onClick={() => void relocate(s)}>
                    File moved — Relocate…
                  </button>
                ) : (
                  <input
                    className={styles.slider}
                    style={fill(level)}
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
                    className={`${styles.button} ${styles.quiet}`}
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

      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}

      <button type="button" className={styles.button} disabled={!loaded} onClick={() => void addSounds()}>
        Add sound…
      </button>

      <h3 className={styles.heading}>Mixes</h3>
      {loaded && mixes.length === 0 && <p className={styles.empty}>No mixes yet.</p>}
      {mixes.length > 0 && (
        <ul className={`${styles.list} ${styles.group}`}>
          {mixes.map((m) => (
            <li key={m.id} className={styles.mix}>
              <button type="button" className={styles.mixName} onClick={() => applyMix(m)}>
                {m.name}
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.quiet}`}
                aria-label={`Delete ${m.name}`}
                onClick={() => void deleteMix(m)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Disabled until the levels have loaded: a mix saved before then would be empty. */}
      <form className={styles.form} onSubmit={(e) => void saveMix(e)}>
        <input
          className={styles.input}
          type="text"
          value={mixName}
          placeholder="Mix name"
          aria-label="Mix name"
          maxLength={60}
          disabled={!loaded}
          onChange={(e) => setMixName(e.target.value)}
        />
        <button type="submit" className={styles.primary} disabled={!loaded || mixName.trim() === ''}>
          Save mix
        </button>
      </form>
    </div>
  );
}
