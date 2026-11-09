import { describe, expect, it, vi } from 'vitest';
import { FetchFailed, getText } from './fetch-timeout';

const URL_A = 'https://example.invalid/a-secret.ics';

/** A body that streams `chunk` forever, counting how much was pulled and whether it was cancelled. */
function endless(chunk: string) {
  const bytes = new TextEncoder().encode(chunk);
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls++;
      controller.enqueue(bytes);
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe('getText', () => {
  it('returns the body of a 2xx response', async () => {
    const fetchFn: typeof fetch = async () => new Response('hello £', { status: 200 });
    expect(await getText(fetchFn, URL_A, 1_000, 1_000)).toBe('hello £');
  });

  it('rejects a non-2xx response without the address in the error', async () => {
    const fetchFn: typeof fetch = async () => new Response('nope', { status: 404 });
    const err = await getText(fetchFn, URL_A, 1_000, 1_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchFailed);
    expect(String(err)).not.toContain('secret');
  });

  it('counts the cap in bytes, not characters', async () => {
    // Four characters, eight bytes in UTF-8.
    const fetchFn: typeof fetch = async () => new Response('££££', { status: 200 });
    await expect(getText(fetchFn, URL_A, 1_000, 7)).rejects.toThrow('response too large');
    expect(await getText(fetchFn, URL_A, 1_000, 8)).toBe('££££');
  });

  it('rejects at once when Content-Length is over the cap, without reading the body', async () => {
    const { stream, seen } = endless('x'.repeat(1024));
    const fetchFn: typeof fetch = async () =>
      new Response(stream, { status: 200, headers: { 'content-length': '999999' } });
    await expect(getText(fetchFn, URL_A, 1_000, 4_096)).rejects.toThrow('response too large');
    expect(seen.pulls).toBeLessThanOrEqual(1);
  });

  it('stops reading and cancels a streamed body once it passes the cap', async () => {
    const { stream, seen } = endless('x'.repeat(1024));
    const fetchFn: typeof fetch = async () => new Response(stream, { status: 200 });
    await expect(getText(fetchFn, URL_A, 1_000, 4_096)).rejects.toThrow('response too large');
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeLessThan(10);
  });

  describe('httpsOnly', () => {
    const redirect = (location: string, status = 302): Response =>
      new Response(null, { status, headers: { location } });

    it('follows https redirects itself, re-checking each hop', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(redirect('/moved.ics'))
        .mockResolvedValueOnce(redirect('https://other.invalid/final.ics', 301))
        .mockResolvedValueOnce(new Response('BEGIN:VCALENDAR', { status: 200 }));
      expect(await getText(fetchFn, URL_A, 1_000, 1_000, { httpsOnly: true })).toBe('BEGIN:VCALENDAR');
      expect(fetchFn.mock.calls.map(([u, init]) => [String(u), init?.redirect])).toEqual([
        [URL_A, 'manual'],
        ['https://example.invalid/moved.ics', 'manual'],
        ['https://other.invalid/final.ics', 'manual'],
      ]);
    });

    it('refuses a redirect to a non-https address and never fetches it', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(redirect('http://example.invalid/plain.ics'))
        .mockResolvedValue(new Response('BEGIN:VCALENDAR', { status: 200 }));
      await expect(getText(fetchFn, URL_A, 1_000, 1_000, { httpsOnly: true })).rejects.toBeInstanceOf(
        FetchFailed,
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('gives up after too many redirects', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => redirect('/again.ics'));
      await expect(getText(fetchFn, URL_A, 1_000, 1_000, { httpsOnly: true })).rejects.toThrow(
        'too many redirects',
      );
      expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it('refuses a response whose final address is not https', async () => {
      const res = new Response('BEGIN:VCALENDAR', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'http://example.invalid/plain.ics' });
      const fetchFn: typeof fetch = async () => res;
      await expect(getText(fetchFn, URL_A, 1_000, 1_000, { httpsOnly: true })).rejects.toBeInstanceOf(
        FetchFailed,
      );
    });
  });
});
