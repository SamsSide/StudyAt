// Settings as they leave main (spec §3.10, §3.11; widgets addendum §5; study-dev rule 9): the
// main-only keys (Spotify tokens, calendar addresses, the widget caches) are stripped from
// everything the renderer or an export sees.
import type { PublicSettings, Settings } from '../../shared/types';

export function publicSettings(s: Settings): PublicSettings {
  const { spotifyTokens: _tokens, calendarUrls: _urls, calendarCache: _agenda, weatherCache: _weather, ...rest } = s;
  return rest;
}
