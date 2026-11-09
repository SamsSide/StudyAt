import { describe, expect, it } from 'vitest';
import { giphyDirectUrl, sniffImage } from './images';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u32le = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u32be = (n: number): number[] => u32le(n).reverse();
const u16be = (n: number): number[] => [(n >> 8) & 255, n & 255];

const gif = (w: number, h: number): Uint8Array =>
  Uint8Array.from([...ascii('GIF89a'), w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0]);

const png = (w: number, h: number): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(w),
    ...u32be(h),
    8,
    6,
    0,
    0,
    0,
  ]);

const jpeg = (w: number, h: number): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii('JFIF\0'),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0, // APP0, length 16
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    ...u16be(h),
    ...u16be(w),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);

const riff = (chunk: number[]): Uint8Array =>
  Uint8Array.from([...ascii('RIFF'), ...u32le(chunk.length + 4), ...ascii('WEBP'), ...chunk]);

const webpLossy = (w: number, h: number): Uint8Array =>
  riff([
    ...ascii('VP8 '),
    ...u32le(10),
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    w & 255,
    w >> 8,
    h & 255,
    h >> 8,
  ]);

const webpLossless = (w: number, h: number): Uint8Array => {
  const a = w - 1;
  const b = h - 1;
  return riff([
    ...ascii('VP8L'),
    ...u32le(5),
    0x2f,
    a & 255,
    ((a >> 8) & 0x3f) | ((b & 3) << 6),
    (b >> 2) & 255,
    (b >> 10) & 15,
  ]);
};

const webpExtended = (w: number, h: number): Uint8Array =>
  riff([
    ...ascii('VP8X'),
    ...u32le(10),
    0,
    0,
    0,
    0,
    (w - 1) & 255,
    ((w - 1) >> 8) & 255,
    ((w - 1) >> 16) & 255,
    (h - 1) & 255,
    ((h - 1) >> 8) & 255,
    ((h - 1) >> 16) & 255,
  ]);

describe('sniffImage (spec §3.6)', () => {
  it('reads a GIF by its magic bytes and little-endian size', () => {
    expect(sniffImage(gif(300, 200))).toEqual({ ext: 'gif', width: 300, height: 200 });
  });
  it('reads a PNG IHDR', () => {
    expect(sniffImage(png(640, 480))).toEqual({ ext: 'png', width: 640, height: 480 });
  });
  it('finds the JPEG SOF after an APP0 segment', () => {
    expect(sniffImage(jpeg(1024, 768))).toEqual({ ext: 'jpg', width: 1024, height: 768 });
  });
  it('reads the three WebP variants', () => {
    expect(sniffImage(webpLossy(320, 240))).toEqual({ ext: 'webp', width: 320, height: 240 });
    expect(sniffImage(webpLossless(321, 241))).toEqual({ ext: 'webp', width: 321, height: 241 });
    expect(sniffImage(webpExtended(4000, 3000))).toEqual({ ext: 'webp', width: 4000, height: 3000 });
  });
  it('rejects HTML, text and empty input', () => {
    expect(sniffImage(Uint8Array.from(ascii('<!DOCTYPE html><html></html>')))).toBeNull();
    expect(sniffImage(Uint8Array.from(ascii('hello world, not an image')))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
  it('rejects a truncated header and a zero size', () => {
    expect(sniffImage(gif(3, 3).slice(0, 8))).toBeNull();
    expect(sniffImage(png(3, 3).slice(0, 20))).toBeNull();
    expect(sniffImage(jpeg(3, 3).slice(0, 25))).toBeNull();
    expect(sniffImage(webpLossy(3, 3).slice(0, 24))).toBeNull();
    expect(sniffImage(gif(0, 5))).toBeNull();
  });
});

describe('giphyDirectUrl', () => {
  it('maps a page link to the direct gif, with or without a slug', () => {
    expect(giphyDirectUrl('https://giphy.com/gifs/cat-dance-abc123XYZ')).toBe(
      'https://i.giphy.com/abc123XYZ.gif',
    );
    expect(giphyDirectUrl('https://giphy.com/gifs/abc123XYZ')).toBe('https://i.giphy.com/abc123XYZ.gif');
    expect(giphyDirectUrl('https://www.giphy.com/gifs/cat-abc123XYZ?x=1')).toBe(
      'https://i.giphy.com/abc123XYZ.gif',
    );
  });
  it('leaves everything else alone', () => {
    expect(giphyDirectUrl('https://example.com/a.gif')).toBeNull();
    expect(giphyDirectUrl('https://giphy.com.evil.test/gifs/abc')).toBeNull();
    expect(giphyDirectUrl('https://media.giphy.com/media/abc123/giphy.gif')).toBeNull();
    expect(giphyDirectUrl('not a url')).toBeNull();
  });
});
