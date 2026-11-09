// Before the quit closes the database (and so on a Windows sign-out too), every renderer window is
// asked to save what it still holds in memory, such as note text it has not sent yet (study-dev
// rule 2). Main waits for each window's `app:flushed` ack, but never longer than FLUSH_LIMIT_MS,
// which sits well inside QUIT_LIMIT_MS: a hung window can't stop the session row being closed.
import { CHANNELS } from '../shared/ipc';
import type { PushTarget } from './ipc';

export const FLUSH_LIMIT_MS = 1_000;

export interface FlushTarget extends PushTarget {
  id: number;
}

export interface RendererFlushDeps {
  /** The live renderer windows' webContents (the broadcaster's targets). */
  targets: () => Iterable<FlushTarget>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function createRendererFlush(deps: RendererFlushDeps) {
  let waiting: { ids: Set<number>; done: () => void } | null = null;
  /** The flush in flight; a second call (a repeated quit) joins it instead of replacing `waiting`. */
  let inFlight: Promise<void> | null = null;

  return {
    /** Sends `app:flush` to every live window; resolves when all have acked or the limit passes. */
    flush(): Promise<void> {
      if (inFlight) return inFlight;
      const ids = new Set<number>();
      for (const t of deps.targets()) {
        if (t.isDestroyed()) continue;
        try {
          t.send(CHANNELS.events.appFlush, undefined);
          ids.add(t.id);
        } catch (err) {
          console.error('StudyAt: could not ask a window to save before quitting', err);
        }
      }
      if (ids.size === 0) return Promise.resolve();
      inFlight = new Promise<void>((resolve) => {
        const limit = deps.setTimeout(() => {
          console.error(`StudyAt: a window did not save within ${FLUSH_LIMIT_MS} ms; quitting anyway`);
          finish();
        }, FLUSH_LIMIT_MS);
        const finish = (): void => {
          deps.clearTimeout(limit);
          waiting = null;
          inFlight = null;
          resolve();
        };
        waiting = { ids, done: finish };
      });
      return inFlight;
    },

    /** `app:flushed` from `sender`; ignored outside a flush or from a window not asked. */
    ack(sender: { id: number }): void {
      if (!waiting) return;
      waiting.ids.delete(sender.id);
      if (waiting.ids.size === 0) waiting.done();
    },
  };
}

export type RendererFlush = ReturnType<typeof createRendererFlush>;
