import { createServer } from 'node:http';

/** Spec §7 copy, shown by Settings when connect fails on a busy port. */
export class PortInUseError extends Error {
  constructor(port: number) {
    super(`Port ${port} is in use — close the other app and retry`);
    this.name = 'PortInUseError';
  }
}

export type CallbackListener = (port: number, timeoutMs: number) => Promise<URLSearchParams>;

const PAGE = 'You can close this tab and return to StudyAt.';

/**
 * One-shot loopback server for the OAuth redirect (spec §3.10): resolves with the
 * /callback query, then closes; also closes (rejecting) after `timeoutMs`.
 */
export const listenForCallback: CallbackListener = (port, timeoutMs) =>
  new Promise<URLSearchParams>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      fn();
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end(PAGE, () => finish(() => resolve(url.searchParams)));
    });
    const timer = setTimeout(
      () => finish(() => reject(new Error('Spotify sign-in timed out'))),
      timeoutMs,
    );
    server.on('error', (err: NodeJS.ErrnoException) => {
      finish(() => reject(err.code === 'EADDRINUSE' ? new PortInUseError(port) : err));
    });
    server.listen(port, '127.0.0.1');
  });
