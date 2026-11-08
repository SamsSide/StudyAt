import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { openTestDb, tempDir } from '../db/test-helpers';
import { SpotifyApiError } from '../spotify/api';
import { safeTokenStore, spotifyCall, type SafeStorageLike } from './spotify';

let cleanup: () => void;
let db: Db;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
});

afterEach(async () => {
  await db.close();
  cleanup();
});

/** Reversible stand-in for safeStorage: never stores the JSON as is. */
const fakeSafe = (available: boolean): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decryptString: (b) => [...b.toString('utf8')].reverse().join(''),
});

const TOKENS = { access: 'acc', refresh: 'ref', expiresAt: 123 };

describe('safeTokenStore', () => {
  it('stores tokens encrypted as base64 and reads them back after a restart', () => {
    safeTokenStore(db, fakeSafe(true)).save(TOKENS);
    const blob = settingsRepo(db).get().spotifyTokens!;
    expect(blob).not.toContain('acc');
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('"access"');
    expect(safeTokenStore(db, fakeSafe(true)).load()).toEqual(TOKENS);
    safeTokenStore(db, fakeSafe(true)).save(null);
    expect(settingsRepo(db).get().spotifyTokens).toBeNull();
  });

  it('keeps tokens in memory only, logging once, without OS encryption', () => {
    const log = vi.fn();
    const store = safeTokenStore(db, fakeSafe(false), log);
    store.save(TOKENS);
    store.save(TOKENS);
    expect(store.load()).toEqual(TOKENS);
    expect(settingsRepo(db).get().spotifyTokens).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable blob as signed out', () => {
    settingsRepo(db).set({ spotifyTokens: 'not-a-blob' });
    expect(safeTokenStore(db, fakeSafe(true)).load()).toBeNull();
  });
});

describe('spotifyCall', () => {
  it('maps API error kinds to readable messages and passes other errors through', async () => {
    await expect(spotifyCall(() => Promise.reject(new SpotifyApiError('offline', 'x')))).rejects.toThrow('Spotify is offline');
    await expect(spotifyCall(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
