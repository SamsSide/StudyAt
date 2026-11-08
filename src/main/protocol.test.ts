// studyat-media:// protocol handler (spec §3.2, §7; study-dev rule 5).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

import { protocol } from 'electron';
import { handleMediaRequest, installMediaProtocol, registerMediaScheme } from './protocol';

let dir: string;
let plain: string;
let accented: string;
const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'); // 36 bytes

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studyat-protocol-'));
  plain = join(dir, 'clip.mp4');
  accented = join(dir, 'café rain.mp4');
  writeFileSync(plain, bytes);
  writeFileSync(accented, bytes);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const req = (url: string, headers?: Record<string, string>) =>
  new Request(url, { headers });
const resolveTo = (path: string | null) => (): string | null => path;

describe('handleMediaRequest', () => {
  it('404 for unknown id', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/9'),
      resolveTo(null),
    );
    expect(res.status).toBe(404);
  });

  it('404 when the file is missing on disk', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/1'),
      resolveTo(join(dir, 'gone.mp4')),
    );
    expect(res.status).toBe(404);
  });

  it('400 for bad kind', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://video/1'),
      resolveTo(plain),
    );
    expect(res.status).toBe(400);
  });

  it('passes kind and numeric id to the resolver', async () => {
    const seen: Array<[string, number]> = [];
    await handleMediaRequest(req('studyat-media://chime/42'), (k, id) => {
      seen.push([k, id]);
      return plain;
    });
    expect(seen).toEqual([['chime', 42]]);
  });

  it('200 full body with Content-Type by extension', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/1'),
      resolveTo(plain),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe('36');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('206 with Content-Range for Range bytes=10-19', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/1', { Range: 'bytes=10-19' }),
      resolveTo(plain),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/36');
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(await res.text()).toBe('abcdefghij');
  });

  it('supports open-ended and suffix ranges and clamps the end', async () => {
    const open = await handleMediaRequest(
      req('studyat-media://space/1', { Range: 'bytes=30-' }),
      resolveTo(plain),
    );
    expect(open.headers.get('Content-Range')).toBe('bytes 30-35/36');
    expect(await open.text()).toBe('uvwxyz');
    const suffix = await handleMediaRequest(
      req('studyat-media://space/1', { Range: 'bytes=-4' }),
      resolveTo(plain),
    );
    expect(await suffix.text()).toBe('wxyz');
    const clamped = await handleMediaRequest(
      req('studyat-media://space/1', { Range: 'bytes=34-999' }),
      resolveTo(plain),
    );
    expect(clamped.headers.get('Content-Range')).toBe('bytes 34-35/36');
    await clamped.arrayBuffer();
  });

  it('416 for range past end', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/1', { Range: 'bytes=36-40' }),
      resolveTo(plain),
    );
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */36');
  });

  it('serves path with spaces and accents', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://sound/2'),
      resolveTo(accented),
    );
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(36);
  });

  it("never serves a path the resolver didn't return", async () => {
    let called = false;
    const resolve = (): string | null => {
      called = true;
      return plain;
    };
    for (const url of [
      'studyat-media://space/1/../../etc',
      'studyat-media://space/1/extra',
      'studyat-media://space/1?x=2',
      'studyat-media://space/1/',
      'studyat-media://space/..',
      'studyat-media://space/-1',
      'studyat-media://space/',
      'studyat-media://space',
    ]) {
      const res = await handleMediaRequest(req(url), resolve);
      expect(res.status, url).toBe(400);
    }
    expect(called).toBe(false);
  });

  it('maps common extensions to media types', async () => {
    const cases: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
    };
    for (const [ext, type] of Object.entries(cases)) {
      const p = join(dir, `x.${ext.toUpperCase()}`);
      writeFileSync(p, 'x');
      const res = await handleMediaRequest(
        req('studyat-media://space/1'),
        resolveTo(p),
      );
      expect(res.headers.get('Content-Type'), ext).toBe(type);
      await res.arrayBuffer();
    }
  });
});

describe('handleMediaRequest hardening', () => {
  it('lets id 0 reach the resolver (unknown -> 404)', async () => {
    const seen: number[] = [];
    const res = await handleMediaRequest(req('studyat-media://space/0'), (_k, id) => {
      seen.push(id);
      return null;
    });
    expect(seen).toEqual([0]);
    expect(res.status).toBe(404);
  });

  it('500 when the resolver throws', async () => {
    const res = await handleMediaRequest(req('studyat-media://space/1'), () => {
      throw new Error('db closed');
    });
    expect(res.status).toBe(500);
  });

  it('streams an accented path with a Range', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://sound/2', { Range: 'bytes=10-19' }),
      resolveTo(accented),
    );
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('abcdefghij');
  });

  it('serves a zero-byte file as an empty 200', async () => {
    const empty = join(dir, 'empty.mp3');
    writeFileSync(empty, '');
    const res = await handleMediaRequest(req('studyat-media://sound/3'), resolveTo(empty));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('0');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('HEAD returns headers and no body', async () => {
    const res = await handleMediaRequest(
      new Request('studyat-media://space/1', { method: 'HEAD' }),
      resolveTo(plain),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('36');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe('CORS for the renderer origin', () => {
  const origin = 'http://127.0.0.1:5173';
  const opts = { allowedOrigins: [origin] };

  it('echoes an allowed origin on 200 and 206', async () => {
    for (const range of [undefined, 'bytes=0-3']) {
      const res = await handleMediaRequest(
        req('studyat-media://space/1', range ? { Origin: origin, Range: range } : { Origin: origin }),
        resolveTo(plain),
        opts,
      );
      expect(res.status).toBe(range ? 206 : 200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Vary')).toBe('Origin');
      expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
        'Content-Range, Accept-Ranges, Content-Length',
      );
      await res.arrayBuffer();
    }
  });

  it('sends no ACAO to a foreign origin', async () => {
    const res = await handleMediaRequest(
      req('studyat-media://space/1', { Origin: 'https://www.youtube.com' }),
      resolveTo(plain),
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await res.arrayBuffer();
  });

  it('serves requests without an Origin as before', async () => {
    const res = await handleMediaRequest(req('studyat-media://space/1'), resolveTo(plain), opts);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await res.arrayBuffer();
  });

  it('also tags 416 and 404 for an allowed origin', async () => {
    const bad = await handleMediaRequest(
      req('studyat-media://space/1', { Origin: origin, Range: 'bytes=99-' }),
      resolveTo(plain),
      opts,
    );
    expect(bad.status).toBe(416);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
});

describe('scheme wiring', () => {
  it('registers the scheme with corsEnabled', () => {
    registerMediaScheme();
    const arg = vi.mocked(protocol.registerSchemesAsPrivileged).mock.calls[0]?.[0];
    expect(arg?.[0]?.privileges?.corsEnabled).toBe(true);
  });

  it('installMediaProtocol reads the allowed origins per request', async () => {
    let origins: string[] = [];
    installMediaProtocol(resolveTo(plain), () => origins);
    const handler = vi.mocked(protocol.handle).mock.calls[0]?.[1];
    origins = ['http://127.0.0.1:9'];
    const res = await handler?.(req('studyat-media://space/1', { Origin: 'http://127.0.0.1:9' }));
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:9');
    await res?.arrayBuffer();
  });
});
