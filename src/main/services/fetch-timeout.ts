// One HTTP GET with a hard deadline, for the widget services (widgets addendum §2, §3: 10 s). The
// response body is read inside the deadline too, so a server that stalls mid-body can't hang a
// refresh, and it is read as a stream against the byte cap, so an endless body can't fill memory.
// Errors never include the URL: calendar addresses are secrets (addendum §2).

export const WIDGET_FETCH_TIMEOUT_MS = 10_000;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FetchFailed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FetchFailed';
  }
}

export interface GetTextOptions {
  /** Follow redirects by hand, refusing any hop (and any final address) that isn't https. */
  httpsOnly?: boolean;
}

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

async function fetchHttpsOnly(fetchFn: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    if (!isHttps(current)) throw new FetchFailed('not https');
    const res = await fetchFn(current, { signal, redirect: 'manual' });
    if (res.url !== '' && !isHttps(res.url)) {
      await discard(res);
      throw new FetchFailed('not https');
    }
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
      if (res.type === 'opaqueredirect') throw new FetchFailed('redirect not followed');
      return res;
    }
    await discard(res);
    if (hop >= MAX_REDIRECTS) throw new FetchFailed('too many redirects');
    try {
      current = new URL(location, current).href;
    } catch {
      throw new FetchFailed('bad redirect');
    }
  }
}

/** The body as text, refusing (and cancelling) it as soon as it is known to exceed `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (Number(res.headers.get('content-length')) > maxBytes) {
    await discard(res);
    throw new FetchFailed('response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchFailed('response too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Resolves with the body text of a 2xx response; rejects with `FetchFailed` otherwise. */
export async function getText(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  maxBytes: number,
  options: GetTextOptions = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = options.httpsOnly
      ? await fetchHttpsOnly(fetchFn, url, controller.signal)
      : await fetchFn(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      await discard(res);
      throw new FetchFailed(`HTTP ${res.status}`);
    }
    return await readCapped(res, maxBytes);
  } catch (err) {
    if (err instanceof FetchFailed) throw err;
    throw new FetchFailed(controller.signal.aborted ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }
}
