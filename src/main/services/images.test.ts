import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_ERRORS, IMAGE_MAX_BYTES } from '../../core/images';
import type { Db } from '../db/db';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import { imagesService, type ImagesService } from './images';

let dir: string;
let cleanup: () => void;
let db: Db;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
});
afterEach(async () => {
  await db.close();
  cleanup();
});

/** A GIF89a header for a w×h image, padded to `size` bytes. */
function gif(size = 64, w = 40, h = 30): Uint8Array {
  const b = new Uint8Array(Math.max(size, 16));
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8]);
  return b;
}

const imagesDir = (): string => join(dir, 'images');

function make(
  fetchFn: typeof fetch = vi.fn(() => Promise.reject(new Error('no network'))) as never,
): ImagesService {
  return imagesService({ db, dir: imagesDir(), now: () => NOW, fetch: fetchFn });
}

const reply = (
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit & { url?: string } = {},
): Response => {
  const res = new Response(body, init);
  if (init.url !== undefined) Object.defineProperty(res, 'url', { value: init.url });
  return res;
};
const image = (bytes: Uint8Array = gif(), type = 'image/gif'): Response =>
  reply(bytes, { status: 200, headers: { 'content-type': type } });

function file(name: string, bytes: Uint8Array | string): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

describe('addFile', () => {
  it('copies the file to images/<id>.<ext> and registers it at the start position', async () => {
    const svc = make();
    const added = await svc.addFile(file('cat.dat', gif(100, 40, 30)));
    expect(added).toMatchObject({
      url: expect.stringMatching(/^studyat-media:\/\/image\/\d+$/),
      width: 40,
      height: 30,
      x: 0.5,
      y: 0.3,
      scale: 1,
      bare: false,
    });
    const id = (added as { id: number }).id;
    expect((added as { url: string }).url).toBe(`studyat-media://image/${id}`);
    expect(existsSync(join(imagesDir(), `${id}.gif`))).toBe(true);
    expect(readdirSync(imagesDir()).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(svc.list()).toHaveLength(1);
    expect(svc.pathOf(id)).toBe(join(imagesDir(), `${id}.gif`));
  });

  it('refuses a file over 20 MB and a text file, writing nothing', async () => {
    const svc = make();
    const big = file('big.gif', gif(IMAGE_MAX_BYTES + 1));
    expect(await svc.addFile(big)).toEqual({ error: IMAGE_ERRORS.size });
    expect(await svc.addFile(file('a.png', 'definitely not a png'))).toEqual({ error: IMAGE_ERRORS.type });
    expect(svc.list()).toEqual([]);
    expect(existsSync(imagesDir())).toBe(false);
  });

  it('refuses a 13th image and writes no file for it', async () => {
    const svc = make();
    const src = file('a.gif', gif());
    for (let i = 0; i < 12; i++) expect(await svc.addFile(src)).toHaveProperty('url');
    expect(await svc.addFile(src)).toEqual({ error: IMAGE_ERRORS.count });
    expect(readdirSync(imagesDir())).toHaveLength(12);
  });

  it('keeps the limit when adds overlap', async () => {
    const svc = make();
    const src = file('a.gif', gif());
    const results = await Promise.all(Array.from({ length: 14 }, () => svc.addFile(src)));
    expect(results.filter((r) => 'url' in r)).toHaveLength(12);
    expect(svc.list()).toHaveLength(12);
  });
});

describe('addUrl', () => {
  it('refuses http without fetching', async () => {
    const fetchFn = vi.fn();
    const svc = make(fetchFn as never);
    expect(await svc.addUrl('http://example.com/a.gif')).toEqual({ error: IMAGE_ERRORS.download });
    expect(await svc.addUrl('not a url')).toEqual({ error: IMAGE_ERRORS.download });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('downloads an image once and keeps a copy', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(image()));
    const svc = make(fetchFn as never);
    const added = await svc.addUrl('https://example.com/a.gif');
    expect(added).toHaveProperty('url');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/a.gif',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(readdirSync(imagesDir())).toHaveLength(1);
  });

  it('refuses text/html, and an image content type on non-image bytes', async () => {
    const html = make((() =>
      Promise.resolve(reply('<html></html>', { headers: { 'content-type': 'text/html' } }))) as never);
    expect(await html.addUrl('https://example.com/page')).toEqual({ error: IMAGE_ERRORS.type });
    const lying = make((() =>
      Promise.resolve(image(new TextEncoder().encode('<html>nope</html>'), 'image/png'))) as never);
    expect(await lying.addUrl('https://example.com/x.png')).toEqual({ error: IMAGE_ERRORS.type });
    expect(existsSync(imagesDir())).toBe(false);
  });

  it('aborts a body over 20 MB while it streams', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 100) controller.close();
      },
    });
    const svc = make((() =>
      Promise.resolve(reply(body, { headers: { 'content-type': 'image/gif' } }))) as never);
    expect(await svc.addUrl('https://example.com/huge.gif')).toEqual({ error: IMAGE_ERRORS.size });
    expect(pulled * chunk.byteLength).toBeLessThan(21 * 1024 * 1024 + 4 * chunk.byteLength);
    expect(pulled).toBeLessThanOrEqual(25);
  });

  it('refuses an oversized content-length without reading the body', async () => {
    const res = image();
    res.headers.set('content-length', String(IMAGE_MAX_BYTES + 1));
    const svc = make((() => Promise.resolve(res)) as never);
    expect(await svc.addUrl('https://example.com/a.gif')).toEqual({ error: IMAGE_ERRORS.size });
  });

  it('follows https redirects but refuses one to http', async () => {
    const hop = reply(null, { status: 302, headers: { location: 'https://cdn.example.com/a.gif' } });
    const fetchFn = vi.fn().mockResolvedValueOnce(hop).mockResolvedValueOnce(image());
    const svc = make(fetchFn as never);
    expect(await svc.addUrl('https://example.com/a')).toHaveProperty('url');
    expect(fetchFn).toHaveBeenLastCalledWith('https://cdn.example.com/a.gif', expect.anything());

    const toHttp = vi
      .fn()
      .mockResolvedValue(reply(null, { status: 301, headers: { location: 'http://evil.test/a.gif' } }));
    expect(await make(toHttp as never).addUrl('https://example.com/b')).toEqual({
      error: IMAGE_ERRORS.download,
    });
    expect(toHttp).toHaveBeenCalledTimes(1);
  });

  it('gives up after five redirects', async () => {
    const loop = vi.fn(() =>
      Promise.resolve(reply(null, { status: 302, headers: { location: 'https://example.com/again' } })),
    );
    expect(await make(loop as never).addUrl('https://example.com/a')).toEqual({
      error: IMAGE_ERRORS.download,
    });
    expect(loop).toHaveBeenCalledTimes(6);
  });

  it('turns a network failure or an HTTP error into the download error', async () => {
    expect(await make().addUrl('https://example.com/a.gif')).toEqual({ error: IMAGE_ERRORS.download });
    const notFound = make((() => Promise.resolve(reply('no', { status: 404 }))) as never);
    expect(await notFound.addUrl('https://example.com/a.gif')).toEqual({ error: IMAGE_ERRORS.download });
  });

  it('fetches the direct i.giphy.com gif for a Giphy page link', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(image()));
    await make(fetchFn as never).addUrl('https://giphy.com/gifs/cat-dance-abc123XYZ');
    expect(fetchFn).toHaveBeenCalledWith('https://i.giphy.com/abc123XYZ.gif', expect.anything());
  });
});

describe('update and remove', () => {
  it('clamps through the repo and returns null for an unknown id', async () => {
    const svc = make();
    const { id } = (await svc.addFile(file('a.gif', gif()))) as { id: number };
    expect(svc.update(id, { x: 3, y: -1, scale: 9, bare: true })).toMatchObject({
      x: 1,
      y: 0,
      scale: 2,
      bare: true,
    });
    expect(svc.update(9999, { x: 0.1 })).toBeNull();
  });

  it('remove deletes the row and the file, and ignores an unknown id', async () => {
    const svc = make();
    const { id } = (await svc.addFile(file('a.gif', gif()))) as { id: number };
    await svc.remove(id);
    expect(svc.list()).toEqual([]);
    expect(existsSync(join(imagesDir(), `${id}.gif`))).toBe(false);
    expect(svc.pathOf(id)).toBeNull();
    await expect(svc.remove(id)).resolves.toBeUndefined();
  });
});
