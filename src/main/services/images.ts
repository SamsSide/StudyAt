// Image and GIF widgets in main (v1.1 spec §3.6, appplan §4.10): a file from the picker or an https
// link is checked by its magic bytes, copied to `<userData>/images/<id>.<ext>` and registered in the
// `images` table. The renderer only ever sees `studyat-media://image/<id>`; this service is the one
// place that writes or deletes those files. Link downloads are https-only on every hop and the size
// cap is enforced while the body streams, so an endless response can't fill memory.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  giphyDirectUrl,
  IMAGE_ERRORS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_COUNT,
  sniffImage,
  type SniffedImage,
} from '../../core/images';
import type { ImageAddResult, ImagePatch, ImageWidget } from '../../shared/types';
import type { Db } from '../db/db';
import { imagesRepo, type ImageRow } from '../db/repos/images';

/** Longer than the widget fetches' 10 s: the body can be 20 MB. */
export const IMAGE_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Where the first image lands, as fractions of the window. */
const START = { x: 0.5, y: 0.3 } as const;
/** Each further image steps down and right, so new ones don't stack; it wraps to stay on screen. */
const CASCADE = { x: 0.03, y: 0.04, steps: 6 } as const;

export interface ImagesServiceDeps {
  db: Db;
  /** `<userData>/images`; created on first write. */
  dir: string;
  now: () => number;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export type ImagesService = ReturnType<typeof imagesService>;

class DownloadFailed extends Error {}
class TooLarge extends Error {}
class WrongType extends Error {}

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

const discard = async (res: Response): Promise<void> => {
  await res.body?.cancel().catch(() => undefined);
};

/** Follows redirects by hand; every hop (and the final address) must be https. */
async function fetchHttpsOnly(fetchFn: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    if (!isHttps(current)) throw new DownloadFailed('not https');
    const res = await fetchFn(current, { signal, redirect: 'manual' });
    if (res.url !== '' && !isHttps(res.url)) {
      await discard(res);
      throw new DownloadFailed('not https');
    }
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
      if (res.type === 'opaqueredirect') throw new DownloadFailed('redirect not followed');
      return res;
    }
    await discard(res);
    if (hop >= MAX_REDIRECTS) throw new DownloadFailed('too many redirects');
    try {
      current = new URL(location, current).href;
    } catch {
      throw new DownloadFailed('bad redirect');
    }
  }
}

/** Reads the body chunk by chunk and stops the moment it passes the cap. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length')) > maxBytes) {
    await discard(res);
    throw new TooLarge();
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function imagesService(deps: ImagesServiceDeps) {
  const repo = imagesRepo(deps.db);
  const timeoutMs = deps.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS;

  const pathFor = (row: Pick<ImageRow, 'id' | 'ext'>): string => join(deps.dir, `${row.id}.${row.ext}`);
  const toWidget = (r: ImageRow): ImageWidget => ({
    id: r.id,
    url: `studyat-media://image/${r.id}`,
    width: r.width,
    height: r.height,
    x: r.x,
    y: r.y,
    scale: r.scale,
    bare: r.bare,
  });

  /** One add at a time, so two quick adds can't both pass the limit of 12. */
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  /** Row first (the id names the file), then the file, written beside its name and renamed in. */
  async function store(
    bytes: Uint8Array,
    sniffed: SniffedImage,
    sourceUrl: string | null,
  ): Promise<ImageWidget> {
    const step = repo.count() % CASCADE.steps;
    const row = repo.create({
      ext: sniffed.ext,
      width: sniffed.width,
      height: sniffed.height,
      sourceUrl,
      x: START.x + CASCADE.x * step,
      y: START.y + CASCADE.y * step,
      createdAt: deps.now(),
    });
    const target = pathFor(row);
    const temp = `${target}.tmp`;
    try {
      await mkdir(deps.dir, { recursive: true });
      await writeFile(temp, bytes);
      await rename(temp, target);
    } catch (err) {
      repo.remove(row.id);
      await rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
    return toWidget(row);
  }

  async function download(url: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchHttpsOnly(deps.fetch, giphyDirectUrl(url) ?? url, controller.signal);
      if (!res.ok) {
        await discard(res);
        throw new DownloadFailed(`HTTP ${res.status}`);
      }
      if (!/^image\//i.test(res.headers.get('content-type') ?? '')) {
        await discard(res);
        throw new WrongType();
      }
      return await readCapped(res, IMAGE_MAX_BYTES);
    } catch (err) {
      if (err instanceof TooLarge || err instanceof WrongType || err instanceof DownloadFailed) throw err;
      throw new DownloadFailed(controller.signal.aborted ? 'timed out' : 'network error');
    } finally {
      clearTimeout(timer);
    }
  }

  const failure = (err: unknown): { error: string } => {
    if (err instanceof TooLarge) return { error: IMAGE_ERRORS.size };
    if (err instanceof WrongType) return { error: IMAGE_ERRORS.type };
    if (err instanceof DownloadFailed) return { error: IMAGE_ERRORS.download };
    throw err;
  };

  const checked = (bytes: Uint8Array): SniffedImage => {
    const sniffed = sniffImage(bytes);
    if (sniffed === null) throw new WrongType();
    return sniffed;
  };

  return {
    list: (): ImageWidget[] => repo.list().map(toWidget),

    /** The file behind a registered id for the media protocol; null for any other id. */
    pathOf(id: number): string | null {
      const row = repo.list().find((r) => r.id === id);
      return row ? pathFor(row) : null;
    },

    /** Copies a picked file in. The type comes from its bytes, never its extension. */
    addFile(path: string): Promise<ImageAddResult> {
      return serial(async () => {
        if (repo.count() >= IMAGE_MAX_COUNT) return { error: IMAGE_ERRORS.count };
        try {
          if ((await stat(path)).size > IMAGE_MAX_BYTES) throw new TooLarge();
          const bytes = new Uint8Array(await readFile(path));
          if (bytes.byteLength > IMAGE_MAX_BYTES) throw new TooLarge();
          return await store(bytes, checked(bytes), null);
        } catch (err) {
          return failure(err);
        }
      });
    },

    /** Downloads an https link once and keeps a copy. */
    addUrl(url: string): Promise<ImageAddResult> {
      return serial(async () => {
        if (repo.count() >= IMAGE_MAX_COUNT) return { error: IMAGE_ERRORS.count };
        if (!isHttps(url)) return { error: IMAGE_ERRORS.download };
        try {
          const bytes = await download(url);
          return await store(bytes, checked(bytes), url);
        } catch (err) {
          return failure(err);
        }
      });
    },

    /** The repo clamps x, y and scale; null for an unknown id. */
    update(id: number, patch: ImagePatch): ImageWidget | null {
      const row = repo.update(id, patch);
      return row ? toWidget(row) : null;
    },

    /** Deletes the row, then its file; a file already gone is fine. */
    async remove(id: number): Promise<void> {
      const row = repo.remove(id);
      if (row) await rm(pathFor(row), { force: true }).catch(() => undefined);
    },
  };
}
