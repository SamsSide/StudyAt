// Image widgets' pure half (v1.1 spec §3.6): what a file is, by its magic bytes, and how big. The
// extension and the content type are never trusted. No I/O, so every header shape is unit-tested.

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 12;

/** Verbatim copy (spec §3.6). */
export const IMAGE_ERRORS = {
  type: "That isn't a GIF, PNG, JPEG or WebP image.",
  size: 'That image is over 20 MB.',
  download: "Couldn't download that link. Check it and your connection.",
  count: 'You can have up to 12 images. Remove one first.',
} as const;

export type ImageExt = 'gif' | 'png' | 'jpg' | 'webp';

export interface SniffedImage {
  ext: ImageExt;
  width: number;
  height: number;
}

const ascii = (b: Uint8Array, at: number, s: string): boolean =>
  b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u24le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

const found = (ext: ImageExt, width: number, height: number): SniffedImage | null =>
  width > 0 && height > 0 ? { ext, width, height } : null;

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // SOF0..SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null;
      return found('jpg', u16be(b, i + 7), u16be(b, i + 5));
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers with no length
      continue;
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return found('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const width = 1 + (b[21]! | ((b[22]! & 0x3f) << 8));
    const height = 1 + ((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10));
    return found('webp', width, height);
  }
  if (ascii(b, 12, 'VP8X')) {
    if (b.length < 30) return null;
    return found('webp', 1 + u24le(b, 24), 1 + u24le(b, 27));
  }
  return null;
}

/** The type and pixel size of a GIF, PNG, JPEG or WebP, or null for anything else or a cut-off header. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) {
    return bytes.length < 10 ? null : found('gif', u16le(bytes, 6), u16le(bytes, 8));
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) {
    if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null;
    return found('png', u32be(bytes, 16), u32be(bytes, 20));
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return sniffJpeg(bytes);
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return sniffWebp(bytes);
  return null;
}

/**
 * A Giphy page link (`giphy.com/gifs/<slug>-<id>` or `giphy.com/gifs/<id>`) as the direct gif,
 * `https://i.giphy.com/<id>.gif`; null for any other address (`media.giphy.com/media/<id>/…` is
 * fetched as given).
 */
export function giphyDirectUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || (u.hostname !== 'giphy.com' && u.hostname !== 'www.giphy.com')) return null;
  const m = /^\/gifs\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
  if (m === null) return null;
  const id = (m[1] ?? '').split('-').pop() ?? '';
  return /^[A-Za-z0-9]+$/.test(id) ? `https://i.giphy.com/${id}.gif` : null;
}
