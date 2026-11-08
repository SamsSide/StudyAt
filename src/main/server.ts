// Tiny static server for the built renderer (spec §3.2): gives YouTube embeds a real http origin.
// Loopback only, random port, serves files under rootDir and nothing else.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export async function startRendererServer(
  rootDir: string,
): Promise<{ url: string; close(): Promise<void> }> {
  const root = resolve(rootDir);

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
      let pathname: string;
      try {
        // The raw target, not a normalised URL, so `..` segments are seen as sent.
        pathname = decodeURIComponent((req.url ?? '/').split('?')[0]?.split('#')[0] ?? '/');
      } catch {
        return reply(res, 400, 'Bad request');
      }
      if (pathname.includes('\0')) return reply(res, 400, 'Bad request');
      if (pathname === '/') pathname = '/index.html';

      const target = resolve(root, '.' + pathname);
      if (target !== root && !target.startsWith(root + sep)) return reply(res, 403, 'Forbidden');

      try {
        const info = await stat(target);
        if (!info.isFile()) return reply(res, 404, 'Not found');
        res.writeHead(200, {
          'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': 'no-cache',
        });
        if (req.method === 'HEAD') return void res.end();
        createReadStream(target).on('error', () => res.destroy()).pipe(res);
      } catch {
        reply(res, 404, 'Not found');
      }
    })();
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}
