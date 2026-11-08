// The five synthesised chimes (spec §3.9, appplan §4.4): no files, so no licences. Each voice
// schedules its oscillators at `at` and routes them into `gain`, the engine's chime gain node.

export type BuiltinChimeId = 'bell' | 'bowl' | 'woodblock' | 'marimba' | 'digital';
export type ChimeVoice = (ctx: BaseAudioContext, at: number, gain: AudioNode) => void;

export const CHIME_NAMES: Record<BuiltinChimeId, string> = {
  bell: 'Bell',
  bowl: 'Singing bowl',
  woodblock: 'Wood block',
  marimba: 'Marimba',
  digital: 'Soft digital',
};

export const BUILTIN_CHIME_IDS: readonly BuiltinChimeId[] = [
  'bell',
  'bowl',
  'woodblock',
  'marimba',
  'digital',
];

interface Partial {
  freq: number;
  peak: number;
  decay: number;
  type?: OscillatorType;
  attack?: number;
  /** Seconds after `at` the partial starts. */
  delay?: number;
}

/** One enveloped oscillator: quick attack, exponential fall to silence at `decay`. */
function partial(ctx: BaseAudioContext, at: number, out: AudioNode, p: Partial): void {
  const start = at + (p.delay ?? 0);
  const attack = p.attack ?? 0.004;
  const osc = ctx.createOscillator();
  osc.type = p.type ?? 'sine';
  osc.frequency.setValueAtTime(p.freq, start);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(p.peak, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + p.decay);
  osc.connect(env);
  env.connect(out);
  osc.start(start);
  osc.stop(start + p.decay + 0.05);
}

const voice =
  (partials: Partial[]): ChimeVoice =>
  (ctx, at, gain) => {
    for (const p of partials) partial(ctx, at, gain, p);
  };

export const CHIMES: Record<BuiltinChimeId, ChimeVoice> = {
  // Struck metal: inharmonic partials, the upper ones dying first.
  bell: voice([
    { freq: 880, peak: 0.4, decay: 2.2 },
    { freq: 880 * 2.76, peak: 0.2, decay: 1.5 },
    { freq: 880 * 5.4, peak: 0.1, decay: 0.9 },
    { freq: 880 * 8.93, peak: 0.05, decay: 0.5 },
  ]),
  // Slow swell, two close tones for the gentle beating, long tail.
  bowl: voice([
    { freq: 220, peak: 0.4, decay: 2.8, attack: 0.06 },
    { freq: 223, peak: 0.3, decay: 2.6, attack: 0.06 },
    { freq: 220 * 2.71, peak: 0.12, decay: 1.8, attack: 0.04 },
    { freq: 220 * 4.9, peak: 0.05, decay: 1.0, attack: 0.03 },
  ]),
  woodblock: voice([
    { freq: 820, peak: 0.55, decay: 0.14, type: 'triangle', attack: 0.002 },
    { freq: 1230, peak: 0.25, decay: 0.08, attack: 0.002 },
  ]),
  // Soft mallet: a warm fundamental plus short bright overtones.
  marimba: voice([
    { freq: 523.25, peak: 0.5, decay: 0.7, attack: 0.003 },
    { freq: 523.25 * 4, peak: 0.15, decay: 0.12, attack: 0.002 },
    { freq: 523.25 * 10, peak: 0.04, decay: 0.05, attack: 0.002 },
  ]),
  // Two rounded notes, a rising fifth.
  digital: voice([
    { freq: 784, peak: 0.35, decay: 0.35, attack: 0.01 },
    { freq: 1175, peak: 0.35, decay: 0.45, attack: 0.01, delay: 0.14 },
  ]),
};

/** The soft once-a-second tick for the last minute of focus (spec §3.9). */
export const tickVoice: ChimeVoice = voice([{ freq: 1800, peak: 0.25, decay: 0.03, attack: 0.001 }]);
