// A minimal pure-TS stand-in for (Offline)AudioContext, for jsdom tests (study-dev rule 6 bans native
// web-audio packages). It models just what the engine and chimes use: oscillators, gains with
// automation, and buffer sources, and can `render` the graph to a Float32Array.

type AutomationEvent =
  | { kind: 'set' | 'linear' | 'exp'; time: number; value: number }
  | { kind: 'target'; time: number; value: number; tc: number };

export class FakeParam {
  readonly events: AutomationEvent[] = [];
  constructor(public value: number) {}

  private add(e: AutomationEvent): this {
    this.events.push(e);
    this.events.sort((a, b) => a.time - b.time);
    return this;
  }
  setValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'set', time, value });
  }
  linearRampToValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'linear', time, value });
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'exp', time, value });
  }
  setTargetAtTime(value: number, time: number, tc: number): this {
    return this.add({ kind: 'target', time, value, tc });
  }

  /** The parameter's value at time `t`, following the scheduled events. */
  valueAt(t: number): number {
    let v = this.value;
    let prevT = 0;
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (!e) continue;
      if (e.kind === 'set') {
        if (e.time > t) break;
        v = e.value;
        prevT = e.time;
      } else if (e.kind === 'target') {
        if (e.time > t) break;
        const next = this.events[i + 1];
        const end = next && next.time <= t ? next.time : t;
        v = e.value + (v - e.value) * Math.exp(-(end - e.time) / e.tc);
        prevT = end;
      } else if (e.time <= t) {
        v = e.value;
        prevT = e.time;
      } else {
        const f = (t - prevT) / (e.time - prevT);
        if (e.kind === 'linear') return v + (e.value - v) * f;
        return v > 0 && e.value > 0 ? v * Math.pow(e.value / v, f) : v;
      }
    }
    return v;
  }
}

export abstract class FakeNode {
  inputs: FakeNode[] = [];
  outputs: FakeNode[] = [];
  private memoIdx = -1;
  private memoVal = 0;

  connect<T extends FakeNode>(dest: T): T {
    dest.inputs.push(this);
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    for (const o of this.outputs) o.inputs = o.inputs.filter((n) => n !== this);
    this.outputs = [];
  }
  protected abstract compute(i: number, t: number, sampleRate: number): number;
  /** One sample at index `i`, memoised so fan-out nodes advance their state once. */
  sample(i: number, t: number, sampleRate: number): number {
    if (this.memoIdx !== i) {
      this.memoVal = this.compute(i, t, sampleRate);
      this.memoIdx = i;
    }
    return this.memoVal;
  }
  protected mix(i: number, t: number, sampleRate: number): number {
    let sum = 0;
    for (const n of this.inputs) sum += n.sample(i, t, sampleRate);
    return sum;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  protected compute(i: number, t: number, sr: number): number {
    return this.gain.valueAt(t) * this.mix(i, t, sr);
  }
}

export class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  private startAt = Infinity;
  private stopAt = Infinity;
  private phase = 0;
  start(when = 0): void {
    this.startAt = when;
  }
  stop(when = 0): void {
    this.stopAt = when;
  }
  protected compute(_i: number, t: number, sr: number): number {
    if (t < this.startAt || t >= this.stopAt) return 0;
    this.phase = (this.phase + this.frequency.valueAt(t) / sr) % 1;
    const p = this.phase;
    switch (this.type) {
      case 'square':
        return p < 0.5 ? 1 : -1;
      case 'sawtooth':
        return 2 * p - 1;
      case 'triangle':
        return 4 * Math.abs(p - 0.5) - 1;
      default:
        return Math.sin(2 * Math.PI * p);
    }
  }
}

export class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(
    channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get numberOfChannels(): number {
    return this.data.length;
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c] as Float32Array;
  }
}

/** Records start/stop; its audio is not rendered (the offline tests only need synthesised voices). */
export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  started = 0;
  stopped = 0;
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  protected compute(): number {
    return 0;
  }
}

export class FakeDestination extends FakeNode {
  protected compute(i: number, t: number, sr: number): number {
    return this.mix(i, t, sr);
  }
}

/** Serves both the realtime and offline roles. */
export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly destination = new FakeDestination();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeBufferSource[] = [];
  /** Bytes handed to decodeAudioData, in order. */
  readonly decoded: ArrayBuffer[] = [];

  constructor(readonly sampleRate = 22050) {}

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
    this.decoded.push(bytes);
    return Promise.resolve(new FakeBuffer(1, 10, this.sampleRate));
  }

  /** Samples the graph at the destination for `seconds`. */
  render(seconds: number): Float32Array {
    const n = Math.floor(seconds * this.sampleRate);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.destination.sample(i, i / this.sampleRate, this.sampleRate);
    return out;
  }
}

/** Casts the fake to the DOM type the engine and chimes are written against. */
export const asAudioContext = (ctx: FakeAudioContext): AudioContext => ctx as unknown as AudioContext;
