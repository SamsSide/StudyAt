import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRendererServer } from './server';

let root: string;
let server: { url: string; close(): Promise<void> };

beforeAll(async () => {
  const parent = mkdtempSync(join(tmpdir(), 'studyat-server-'));
  root = join(parent, 'renderer');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<h1>StudyAt</h1>');
  writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
  writeFileSync(join(parent, 'secret.txt'), 'secret');
  server = await startRendererServer(root);
});

afterAll(async () => {
  await server.close();
  rmSync(join(root, '..'), { recursive: true, force: true });
});

/** Raw GET so `../` reaches the server unnormalised (fetch would collapse it). */
function rawGet(path: string): Promise<{ status: number; type: string | undefined; body: string }> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: Number(port), path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startRendererServer', () => {
  it('binds to 127.0.0.1 on a random port', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('serves index.html at /', async () => {
    const res = await rawGet('/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<h1>StudyAt</h1>');
    expect(res.type).toContain('text/html');
  });

  it('returns 403 for ../ traversal', async () => {
    expect((await rawGet('/../secret.txt')).status).toBe(403);
    expect((await rawGet('/%2e%2e/secret.txt')).status).toBe(403);
    expect((await rawGet('/assets/../../secret.txt')).status).toBe(403);
  });

  it('sets text/javascript for .js', async () => {
    const res = await rawGet('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/javascript');
  });

  it('returns 404 for a missing file', async () => {
    expect((await rawGet('/nope.png')).status).toBe(404);
  });
});
