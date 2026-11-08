import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { listenForCallback, PortInUseError } from './listener';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function request(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    }).on('error', reject);
  });
}

describe('listenForCallback', () => {
  it('resolves with the callback query, replies with the close-tab page, then frees the port', async () => {
    const port = await freePort();
    const p = listenForCallback(port, 5_000);
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(port, '/callback?code=fake-code&state=fake-state');
    expect(res.status).toBe(200);
    expect(res.text).toBe('You can close this tab and return to StudyAt.');
    const params = await p;
    expect(params.get('code')).toBe('fake-code');
    expect(params.get('state')).toBe('fake-state');
    await expect(request(port, '/callback')).rejects.toThrow(); // closed
  });

  it('ignores other paths and keeps waiting', async () => {
    const port = await freePort();
    const p = listenForCallback(port, 5_000);
    await new Promise((r) => setTimeout(r, 50));
    expect((await request(port, '/favicon.ico')).status).toBe(404);
    await request(port, '/callback?code=c&state=s');
    expect((await p).get('code')).toBe('c');
  });

  it('closes after the timeout', async () => {
    const port = await freePort();
    await expect(listenForCallback(port, 50)).rejects.toThrow(/timed out/);
    await expect(request(port, '/callback')).rejects.toThrow();
  });

  it('EADDRINUSE → PortInUseError with the §7 copy', async () => {
    const blocker: Server = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const { port } = blocker.address() as AddressInfo;
    try {
      const err = await listenForCallback(port, 1_000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PortInUseError);
      expect((err as Error).message).toBe(`Port ${port} is in use — close the other app and retry`);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'EACCES (a reserved or privileged port) → PortInUseError',
    async () => {
      const err = await listenForCallback(80, 1_000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PortInUseError);
    },
  );
});
