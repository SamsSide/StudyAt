// Builds `window.studyat` (spec §3.6; study-dev rule 5): one method per `CHANNELS` request entry
// over `ipcRenderer.invoke`, plus the `on*` subscriptions to main's pushes, each returning its
// unsubscribe. Nothing else of Electron reaches the renderer; main validates every payload.
import { CHANNELS, type StudyAtApi, type Unsubscribe } from '../shared/ipc';

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

/** `<group>.<method>` subscriptions and the push channel each listens on. */
export const EVENT_METHODS = {
  'timer.onState': CHANNELS.events.timerState,
  'timer.onAwayPrompt': CHANNELS.events.timerAway,
  'timer.onSegmentEnd': CHANNELS.events.timerSegmentEnd,
  'app.onFullscreen': CHANNELS.events.appFullscreen,
} as const;

type Fn = (...args: unknown[]) => unknown;

export function buildApi(ipc: IpcRendererLike): StudyAtApi {
  const api: Record<string, Record<string, Fn>> = {};
  for (const [group, methods] of Object.entries(CHANNELS)) {
    if (group === 'events') continue;
    const out: Record<string, Fn> = {};
    for (const [method, channel] of Object.entries(methods as Record<string, string>)) {
      out[method] = (...args: unknown[]) => ipc.invoke(channel, ...args);
    }
    api[group] = out;
  }
  for (const [name, channel] of Object.entries(EVENT_METHODS)) {
    const [group = '', method = ''] = name.split('.');
    (api[group] ??= {})[method] = (cb: unknown): Unsubscribe => {
      // The renderer gets the payload only, never the IpcRendererEvent.
      const listener = (_event: unknown, payload: unknown): void => (cb as (p: unknown) => void)(payload);
      ipc.on(channel, listener);
      return () => ipc.removeListener(channel, listener);
    };
  }
  // The shape is CHANNELS plus EVENT_METHODS; api.test.ts checks it names every StudyAtApi method.
  return api as unknown as StudyAtApi;
}
