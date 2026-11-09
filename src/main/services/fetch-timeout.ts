// One HTTP GET with a hard deadline, for the widget services (widgets addendum §2, §3: 10 s). The
// response body is read inside the deadline too, so a server that stalls mid-body can't hang a
// refresh. Errors never include the URL: calendar addresses are secrets (addendum §2).

export const WIDGET_FETCH_TIMEOUT_MS = 10_000;

export class FetchFailed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FetchFailed';
  }
}

/** Resolves with the body text of a 2xx response; rejects with `FetchFailed` otherwise. */
export async function getText(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new FetchFailed(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > maxBytes) throw new FetchFailed('response too large');
    return text;
  } catch (err) {
    if (err instanceof FetchFailed) throw err;
    throw new FetchFailed(controller.signal.aborted ? 'timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }
}
