import { describe, expect, it } from 'vitest';
import { CSP, installPermissionHandlers, permissionAllowed, shouldApplyCsp } from './security';

describe('shouldApplyCsp', () => {
  const origin = 'http://127.0.0.1:41234';

  it('applies to the app origin', () => {
    expect(shouldApplyCsp('http://127.0.0.1:41234/', origin)).toBe(true);
    expect(shouldApplyCsp('http://127.0.0.1:41234/assets/index.js', origin)).toBe(true);
  });

  it('leaves third-party responses alone', () => {
    expect(shouldApplyCsp('https://www.youtube.com/embed/abc', origin)).toBe(false);
    expect(shouldApplyCsp('https://rr1---sn.googlevideo.com/videoplayback', origin)).toBe(false);
    expect(shouldApplyCsp('https://i.ytimg.com/vi/abc/hq.jpg', origin)).toBe(false);
  });

  it('is false for another local port, no origin or a bad url', () => {
    expect(shouldApplyCsp('http://127.0.0.1:9999/', origin)).toBe(false);
    expect(shouldApplyCsp('http://127.0.0.1:41234/', null)).toBe(false);
    expect(shouldApplyCsp('not a url', origin)).toBe(false);
  });
});

describe('CSP', () => {
  it('allows Spotify album art from its CDNs (R40)', () => {
    const img = CSP.split('; ').find((d) => d.startsWith('img-src '));
    expect(img?.split(' ')).toEqual(
      expect.arrayContaining(['https://i.scdn.co', 'https://*.spotifycdn.com', 'https://mosaic.scdn.co']),
    );
  });
});

describe('permissionAllowed', () => {
  const origin = 'http://127.0.0.1:41234';

  it('allows notifications and fullscreen for the app origin only', () => {
    expect(permissionAllowed('notifications', 'http://127.0.0.1:41234/', origin)).toBe(true);
    expect(permissionAllowed('fullscreen', 'http://127.0.0.1:41234/mini.html', origin)).toBe(true);
    expect(permissionAllowed('notifications', 'https://www.youtube.com/embed/x', origin)).toBe(false);
    expect(permissionAllowed('fullscreen', 'http://127.0.0.1:9999/', origin)).toBe(false);
  });

  it('denies everything else, and everything with no app origin or a bad url', () => {
    for (const p of ['media', 'geolocation', 'clipboard-read', 'openExternal', 'midi', 'hid'])
      expect(permissionAllowed(p, 'http://127.0.0.1:41234/', origin)).toBe(false);
    expect(permissionAllowed('notifications', 'http://127.0.0.1:41234/', null)).toBe(false);
    expect(permissionAllowed('notifications', 'not a url', origin)).toBe(false);
  });
});

describe('installPermissionHandlers', () => {
  type RequestHandler = (
    wc: unknown,
    p: string,
    cb: (ok: boolean) => void,
    d: { requestingUrl: string },
  ) => void;
  type CheckHandler = (wc: unknown, p: string, requestingOrigin: string) => boolean;

  it('routes both the request and the check handler through permissionAllowed', () => {
    let request: RequestHandler | null = null;
    let check: CheckHandler | null = null;
    installPermissionHandlers(
      {
        setPermissionRequestHandler: (h) => (request = h as unknown as RequestHandler),
        setPermissionCheckHandler: (h) => (check = h as unknown as CheckHandler),
      },
      () => 'http://127.0.0.1:41234',
    );
    const answers: boolean[] = [];
    request!(null, 'notifications', (ok) => answers.push(ok), { requestingUrl: 'http://127.0.0.1:41234/' });
    request!(null, 'media', (ok) => answers.push(ok), { requestingUrl: 'http://127.0.0.1:41234/' });
    expect(answers).toEqual([true, false]);
    expect(check!(null, 'fullscreen', 'http://127.0.0.1:41234')).toBe(true);
    expect(check!(null, 'geolocation', 'http://127.0.0.1:41234')).toBe(false);
    expect(check!(null, 'notifications', 'https://www.youtube.com')).toBe(false);
  });
});
