// The renderer's Web Audio engine (spec §3.9, appplan §4.3/§4.4): master gain -> destination for the
// soundboard, and a separate chime gain -> destination so chimes ignore the master slider.
import type { ChimeId, Sound } from '../../shared/types';
import { CHIMES, tickVoice, type BuiltinChimeId, type ChimeVoice } from './chimes';
import { makeNoise, type NoiseColour } from './noise';

/** Seconds between repeats of a chime (spec §3.9). */
export const CHIME_REPEAT_GAP = 1.2;

interface Channel {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  connected: boolean;
  level: number;
}

export interface ChimeOpts {
  volume: number;
  repeat: number;
  /** URL of the registered file for a `file:<id>` chime. */
  customUrl?: string;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const isBuiltinChime = (s: string): s is BuiltinChimeId => Object.hasOwn(CHIMES, s);

const isNoiseColour = (s: string): s is NoiseColour => s === 'white' || s === 'pink' || s === 'brown';

export class AudioEngine {
  private ctxInstance: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private chimeGain: GainNode | null = null;
  private masterValue = 0.8;
  private readonly channels = new Map<number, Channel>();
  private readonly noiseBuffers = new Map<NoiseColour, AudioBuffer>();
  private readonly fileBuffers = new Map<string, Promise<AudioBuffer>>();
  private autoResumeArmed = false;

  constructor(private readonly ctxFactory: () => AudioContext = () => new AudioContext()) {}

  private get ctx(): AudioContext {
    if (!this.ctxInstance) {
      const ctx = this.ctxFactory();
      this.ctxInstance = ctx;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.masterValue;
      this.masterGain.connect(ctx.destination);
      this.chimeGain = ctx.createGain(); // unity bus; each chime voice carries its own volume
      this.chimeGain.connect(ctx.destination);
      this.armAutoResume();
    }
    return this.ctxInstance;
  }

  private get master(): GainNode {
    void this.ctx;
    return this.masterGain as GainNode;
  }

  private get chime(): GainNode {
    void this.ctx;
    return this.chimeGain as GainNode;
  }

  /** A context that starts suspended (autoplay policy) resumes on the first click or key press. */
  private armAutoResume(): void {
    if (this.autoResumeArmed || typeof document === 'undefined') return;
    this.autoResumeArmed = true;
    const events = ['pointerdown', 'keydown'] as const;
    const handler = (): void => {
      void this.resume();
      for (const e of events) document.removeEventListener(e, handler, true);
    };
    for (const e of events) document.addEventListener(e, handler, true);
  }

  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  setMaster(v: number): void {
    this.masterValue = clamp01(v);
    if (this.masterGain) this.masterGain.gain.value = this.masterValue;
  }

  /**
   * Sets a channel's level. A level of 0 stops its source and disconnects its gain (spec §3.9: no CPU
   * for silent channels). Resolves once a file channel has loaded; a file that cannot be read leaves
   * the channel silent rather than throwing.
   */
  async setLevel(sound: Sound, v: number, srcUrl: string): Promise<void> {
    const level = clamp01(v);
    let ch = this.channels.get(sound.id);
    if (level === 0) {
      if (ch) {
        ch.level = 0;
        this.silence(ch);
      }
      return;
    }
    if (!ch) {
      ch = {
        gain: this.ctx.createGain(),
        source: null,
        connected: false,
        level,
      };
      this.channels.set(sound.id, ch);
    }
    ch.level = level;
    ch.gain.gain.value = level;
    if (!ch.source) {
      let buffer: AudioBuffer;
      try {
        buffer = await this.bufferFor(sound, srcUrl);
      } catch {
        return;
      }
      // The level may have gone to 0 (or another call may have started the source) while loading.
      if (ch.level === 0 || ch.source) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(ch.gain);
      source.start();
      ch.source = source;
    }
    if (!ch.connected) {
      ch.gain.connect(this.master);
      ch.connected = true;
    }
  }

  private silence(ch: Channel): void {
    if (ch.source) {
      ch.source.stop();
      ch.source.disconnect();
      ch.source = null;
    }
    if (ch.connected) {
      ch.gain.disconnect();
      ch.connected = false;
    }
  }

  private bufferFor(sound: Sound, srcUrl: string): Promise<AudioBuffer> {
    if (sound.kind === 'noise') {
      const colour: NoiseColour = isNoiseColour(sound.source) ? sound.source : 'white';
      let buf = this.noiseBuffers.get(colour);
      if (!buf) {
        buf = makeNoise(this.ctx, colour);
        this.noiseBuffers.set(colour, buf);
      }
      return Promise.resolve(buf);
    }
    return this.loadFile(srcUrl);
  }

  private loadFile(url: string): Promise<AudioBuffer> {
    let p = this.fileBuffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((bytes) => this.ctx.decodeAudioData(bytes));
      // A failed load is not cached, so Relocate / a retry can try again.
      p.catch(() => this.fileBuffers.delete(url));
      this.fileBuffers.set(url, p);
    }
    return p;
  }

  stopAll(): void {
    for (const ch of this.channels.values()) {
      ch.level = 0;
      this.silence(ch);
    }
  }

  /**
   * Plays a chime `repeat` times (1.2 s apart) through the chime bus, independent of the master. Each
   * voice gets its own gain for the volume, so a tick or the next chime cannot change one in flight. A
   * custom chime that is missing or will not decode, or an unknown id, falls back to the bell.
   */
  async playChime(id: ChimeId, opts: ChimeOpts): Promise<void> {
    let buffer: AudioBuffer | null = null;
    let voice: ChimeVoice = CHIMES.bell;
    if (isBuiltinChime(id)) {
      voice = CHIMES[id];
    } else if (id.startsWith('file:') && opts.customUrl) {
      try {
        buffer = await this.loadFile(opts.customUrl);
      } catch {
        buffer = null;
      }
    }
    await this.resume();
    const ctx = this.ctx;
    const repeats = Math.max(1, Math.round(opts.repeat));
    for (let i = 0; i < repeats; i++) {
      const at = ctx.currentTime + i * CHIME_REPEAT_GAP;
      const out = this.voiceGain(opts.volume);
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(out);
        src.start(at);
      } else {
        voice(ctx, at, out);
      }
    }
  }

  /** A fresh gain at `volume` feeding the chime bus. */
  private voiceGain(volume: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = clamp01(volume);
    g.connect(this.chime);
    return g;
  }

  /** The soft once-a-second tick of the last focus minute. */
  tick(volume: number): void {
    const ctx = this.ctx;
    if (ctx.state === 'suspended') return; // never queue ticks behind a suspended context
    tickVoice(ctx, ctx.currentTime, this.voiceGain(volume));
  }
}

export const audioEngine = new AudioEngine();
