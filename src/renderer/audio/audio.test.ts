import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChimeId, Sound } from '../../shared/types';
import { BUILTIN_CHIME_IDS, CHIMES, pipVoice } from './chimes';
import { AudioEngine } from './engine';
import { makeNoise } from './noise';
import { asAudioContext, FakeAudioContext } from './testing/fakeAudio';

const asBase = (c: FakeAudioContext): BaseAudioContext => c as unknown as BaseAudioContext;

const rms = (d: Float32Array): number => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
const meanAbsDelta = (d: Float32Array): number => {
  let s = 0;
  for (let i = 1; i < d.length; i++) s += Math.abs((d[i] ?? 0) - (d[i - 1] ?? 0));
  return s / (d.length - 1);
};

const noiseSound = (id: number, colour: string): Sound => ({
  id,
  name: colour,
  kind: 'noise',
  source: colour,
  builtin: true,
  sort: id,
  missing: false,
});

afterEach(() => vi.unstubAllGlobals());

describe('pipVoice', () => {
  it('schedules one 1000 Hz oscillator that stops by 0.17 s', () => {
    const fake = new FakeAudioContext();
    const made: { frequency: { valueAt: (t: number) => number }; stop: (when?: number) => void }[] = [];
    const create = fake.createOscillator.bind(fake);
    const stops: number[] = [];
    fake.createOscillator = () => {
      const osc = create();
      const stop = osc.stop.bind(osc);
      osc.stop = (when?: number) => {
        stops.push(when ?? 0);
        stop(when);
      };
      made.push(osc);
      return osc;
    };
    pipVoice(asBase(fake), 0, fake.createGain() as unknown as AudioNode);
    expect(made).toHaveLength(1);
    expect(made[0]?.frequency.valueAt(0.05)).toBe(1000);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBeLessThanOrEqual(0.17 + 1e-9);
  });
});

describe('makeNoise', () => {
  it('white noise RMS is within 0.2-0.4', () => {
    const d = makeNoise(asBase(new FakeAudioContext(8000)), 'white', 2).getChannelData(0);
    expect(rms(d)).toBeGreaterThan(0.2);
    expect(rms(d)).toBeLessThan(0.4);
  });

  it('brown noise is low-frequency weighted (mean |delta| far below white)', () => {
    const ctx = asBase(new FakeAudioContext(8000));
    const white = meanAbsDelta(makeNoise(ctx, 'white', 2).getChannelData(0));
    const brown = meanAbsDelta(makeNoise(ctx, 'brown', 2).getChannelData(0));
    expect(brown).toBeLessThan(white / 4);
  });

  it('brown noise wraps from its last sample to its first like any other step', () => {
    const ctx = asBase(new FakeAudioContext(8000));
    for (let run = 0; run < 5; run++) {
      const d = makeNoise(ctx, 'brown', 2).getChannelData(0);
      const wrap = Math.abs((d[d.length - 1] ?? 0) - (d[0] ?? 0));
      expect(wrap).toBeLessThan(meanAbsDelta(d) * 8);
    }
  });

  it('pink noise sits between white and brown and stays finite and bounded', () => {
    const ctx = asBase(new FakeAudioContext(8000));
    const d = makeNoise(ctx, 'pink', 2).getChannelData(0);
    expect(d.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.71)).toBe(true);
    const white = meanAbsDelta(makeNoise(ctx, 'white', 2).getChannelData(0));
    expect(meanAbsDelta(d)).toBeLessThan(white);
  });
});

describe('chimes', () => {
  it.each(BUILTIN_CHIME_IDS)('%s renders non-silent audio under 3 s', (id) => {
    const ctx = new FakeAudioContext(22050);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    CHIMES[id](asBase(ctx), 0, out as unknown as AudioNode);
    const audio = ctx.render(3);
    let peak = 0;
    for (const x of audio) {
      expect(Number.isNaN(x)).toBe(false);
      peak = Math.max(peak, Math.abs(x));
    }
    expect(peak).toBeGreaterThan(0.05);
  });
});

describe('AudioEngine', () => {
  it('channel at 0 stops its source and disconnects its gain', async () => {
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => asAudioContext(fake));
    const rain = noiseSound(1, 'white');
    await engine.setLevel(rain, 0.5, '');
    const src = fake.sources[0];
    expect(src?.started).toBe(1);
    expect(src?.loop).toBe(true);
    await engine.setLevel(rain, 0, '');
    expect(src?.stopped).toBe(1);
    const channelGain = fake.gains[2]; // master, chime, then the channel
    expect(channelGain?.outputs).toHaveLength(0);
    // Back up: a fresh source starts and the gain reconnects to master.
    await engine.setLevel(rain, 0.4, '');
    expect(fake.sources).toHaveLength(2);
    expect(channelGain?.outputs).toHaveLength(1);
  });

  it('keeps chimes on their own gain, independent of the master', async () => {
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => asAudioContext(fake));
    engine.setMaster(0);
    await engine.playChime('bell', { volume: 0.7, repeat: 1 });
    const [master, chime] = fake.gains;
    expect(master?.gain.value).toBe(0);
    expect(chime?.gain.value).toBe(1);
    expect(chime?.outputs).toEqual([fake.destination]);
    // The volume lives on the voice's own gain, which feeds the chime bus.
    const voice = fake.gains[2];
    expect(voice?.gain.value).toBe(0.7);
    expect(voice?.outputs).toEqual([chime]);
    expect(fake.state).toBe('running');
  });

  it('decodes a custom file chime fetched from its media URL', async () => {
    const fake = new FakeAudioContext();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const engine = new AudioEngine(() => asAudioContext(fake));
    await engine.playChime('file:7', {
      volume: 1,
      repeat: 2,
      customUrl: 'studyat-media://chime/7',
    });
    expect(fetchMock).toHaveBeenCalledWith('studyat-media://chime/7');
    expect(fake.sources).toHaveLength(2);
  });

  it('a tick does not change the volume of a chime already playing', async () => {
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => asAudioContext(fake));
    await engine.playChime('bell', { volume: 0.9, repeat: 1 });
    const chimeVoice = fake.gains[2];
    engine.tick(0.2);
    expect(chimeVoice?.gain.value).toBe(0.9);
    const chimeBus = fake.gains[1];
    expect(fake.gains.some((g) => g.gain.value === 0.2 && g.outputs.includes(chimeBus as never))).toBe(true);
  });

  it('a pip is skipped while the context is suspended', () => {
    const fake = new FakeAudioContext();
    fake.state = 'suspended';
    const engine = new AudioEngine(() => asAudioContext(fake));
    engine.pip(0.5);
    expect(fake.gains).toHaveLength(2); // master and chime bus only: no voice gain was made
  });

  it.each([
    ['a file that cannot be fetched', 'file:7', 'studyat-media://chime/7'],
    ['an unknown id', 'nonsense', undefined],
    ['a custom id without a URL', 'file:8', undefined],
  ])('falls back to the bell for %s', async (_label, id, customUrl) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('gone'))),
    );
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => asAudioContext(fake));
    await engine.playChime(id as ChimeId, { volume: 1, repeat: 1, customUrl });
    let peak = 0;
    for (const x of fake.render(3)) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeGreaterThan(0.05);
  });

  it('resumes a suspended context on the first key press', async () => {
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(() => asAudioContext(fake));
    engine.setMaster(0.5);
    await engine.setLevel(noiseSound(1, 'white'), 0.5, ''); // creates the context, suspended
    expect(fake.state).toBe('suspended');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await Promise.resolve();
    expect(fake.state).toBe('running');
  });

  it('a file that cannot be loaded leaves the channel silent without throwing', async () => {
    const fake = new FakeAudioContext();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('gone'))),
    );
    const engine = new AudioEngine(() => asAudioContext(fake));
    const gone: Sound = {
      ...noiseSound(9, ''),
      kind: 'file',
      builtin: false,
      source: 'C:\\gone.mp3',
    };
    await expect(engine.setLevel(gone, 0.5, 'studyat-media://sound/9')).resolves.toBeUndefined();
    expect(fake.sources).toHaveLength(0);
  });
});
