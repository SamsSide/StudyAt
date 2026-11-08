// Spotify wiring for IPC (spec §3.10; study-dev rule 9): the safeStorage-backed token store, and
// readable errors for the control calls. Tokens are JSON encrypted with `safeStorage`, stored as
// base64 in `settings.spotifyTokens`. Without OS encryption they stay in memory only (Sam signs
// in again next launch): never plaintext on disk.
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { SpotifyApiError } from '../spotify/api';
import type { Tokens, TokenStore } from '../spotify/auth';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const isTokens = (v: unknown): v is Tokens =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Tokens).access === 'string' &&
  typeof (v as Tokens).refresh === 'string' &&
  typeof (v as Tokens).expiresAt === 'number';

export function safeTokenStore(db: Db, safe: SafeStorageLike, log: (msg: string) => void = console.warn): TokenStore {
  const settings = settingsRepo(db);
  let cached: Tokens | null | undefined;
  let warned = false;

  const available = (): boolean => {
    const ok = safe.isEncryptionAvailable();
    if (!ok && !warned) {
      warned = true;
      log('StudyAt: OS encryption is unavailable, so Spotify sign-in is kept in memory only');
    }
    return ok;
  };

  return {
    load() {
      if (cached !== undefined) return cached;
      cached = null;
      const blob = settings.get().spotifyTokens;
      if (blob && available()) {
        try {
          const parsed: unknown = JSON.parse(safe.decryptString(Buffer.from(blob, 'base64')));
          if (isTokens(parsed)) cached = parsed;
        } catch {
          // Unreadable (another Windows user, a reset key): treated as signed out.
        }
      }
      return cached;
    },
    save(t) {
      cached = t;
      if (t === null) {
        settings.set({ spotifyTokens: null });
        return;
      }
      settings.set({ spotifyTokens: available() ? safe.encryptString(JSON.stringify(t)).toString('base64') : null });
    },
  };
}

/** Spec §3.10 copy for a failed control call; the renderer shows the rejection's message. */
const MESSAGES: Record<SpotifyApiError['kind'], string> = {
  disconnected: 'Reconnect Spotify',
  offline: 'Spotify is offline',
  'rate-limited': 'Spotify is busy, try again in a moment',
  'no-device': 'Open Spotify on any device, then press play',
  failed: "Spotify couldn't do that",
};

/** Runs a control call, turning a `SpotifyApiError` into an Error with readable copy. */
export async function spotifyCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SpotifyApiError) throw new Error(MESSAGES[err.kind], { cause: err });
    throw err;
  }
}
