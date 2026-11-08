// Settings as they leave main (spec §3.10, §3.11; study-dev rule 9): `spotifyTokens` is main-owned
// and stripped from everything the renderer or an export sees.
import type { PublicSettings, Settings } from '../../shared/types';

export function publicSettings(s: Settings): PublicSettings {
  const { spotifyTokens: _tokens, ...rest } = s;
  return rest;
}
