import { createHash, randomBytes } from 'node:crypto';

// appplan §4.6 / spec §3.10: Authorization Code + PKCE (S256), loopback redirect.
export const REDIRECT_URI = 'http://127.0.0.1:43821/callback';
export const CALLBACK_PORT = 43821;
export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** A 64-char verifier (48 random bytes, base64url) and its S256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return b64url(randomBytes(16));
}

export function authorizeUrl(clientId: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return `https://accounts.spotify.com/authorize?${q.toString()}`;
}
