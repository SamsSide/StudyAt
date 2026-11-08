// Generated noise buffers for the soundboard (spec §3.9, appplan §4.3): nothing shipped, nothing licensed.

export type NoiseColour = 'white' | 'pink' | 'brown';

/** Peak the generated noise is normalised to; leaves headroom for the channel and master gains. */
const PEAK = 0.5;

/** Seconds of the loop's tail blended into its head so a looped buffer has no step at the seam. */
const SEAM_SECONDS = 0.05;

function fill(data: Float32Array, colour: NoiseColour): void {
  const n = data.length;
  if (colour === 'white') {
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * PEAK;
    return;
  }
  if (colour === 'pink') {
    // Paul Kellet's economy filter over white noise.
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // Brown: integrated white noise with a slight leak so it cannot drift away.
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last;
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  const scale = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < n; i++) data[i] = (data[i] ?? 0) * scale;
}

/** Blends the head into the tail (equal-power) so the loop point is continuous for the integrated colours. */
function smoothSeam(data: Float32Array, length: number): void {
  const n = Math.min(length, Math.floor(data.length / 4));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const head = data[i] ?? 0;
    const tailIdx = data.length - n + i;
    const tail = data[tailIdx] ?? 0;
    data[tailIdx] = tail * Math.cos((t * Math.PI) / 2) + head * Math.sin((t * Math.PI) / 2);
  }
}

export function makeNoise(ctx: BaseAudioContext, colour: NoiseColour, seconds = 10): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  fill(data, colour);
  if (colour !== 'white') smoothSeam(data, Math.round(ctx.sampleRate * SEAM_SECONDS));
  return buffer;
}
