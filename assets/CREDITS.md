# Asset credits

Every bundled file is CC0 / public domain or own work.
Sources were found through the Openverse API with its CC0 licence filter, and each record
reported licence `cc0` (https://creativecommons.org/publicdomain/zero/1.0/) at build time.

## Sounds (`assets/sounds/`)

All ten loops are derived from the Freesound HQ preview of the original, trimmed to a 27-38 s window,
level-matched, joined with a 2 s equal-power crossfade so the loop point is seamless, and encoded as
OGG Vorbis q5. White, pink and brown noise are generated in code and ship no file.
All ten channels of spec §3.9 were sourced; none was dropped.

| File | Title | Author | Source URL | Licence |
|---|---|---|---|---|
| `sounds/rain.ogg` | Rain Loop 1 | richwise | https://freesound.org/people/richwise/sounds/584945 | CC0 1.0 |
| `sounds/thunderstorm.ogg` | Thunderstorm with heavy rain2 | Audeption | https://freesound.org/people/Audeption/sounds/425173 | CC0 1.0 |
| `sounds/cafe.ogg` | cafe ambience | mikemoons | https://freesound.org/people/mikemoons/sounds/579500 | CC0 1.0 |
| `sounds/fireplace.ogg` | Fireplace burning | giddster | https://freesound.org/people/giddster/sounds/414482 | CC0 1.0 |
| `sounds/ocean-waves.ogg` | Zen Ocean Waves, Ocean Waves Ambience | INNORECORDS | https://freesound.org/people/INNORECORDS/sounds/456899 | CC0 1.0 |
| `sounds/forest-birds.ogg` | Forest Birds 02 | VKProduktion | https://freesound.org/people/VKProduktion/sounds/344966 | CC0 1.0 |
| `sounds/wind.ogg` | Looping Gentle Wind Ambience on an Open Desert Plain | dhallcomposer | https://freesound.org/people/dhallcomposer/sounds/697217 | CC0 1.0 |
| `sounds/keyboard-typing.ogg` | Computer keyboard typing snippet mono [loop] | cabled_mess | https://freesound.org/people/cabled_mess/sounds/361639 | CC0 1.0 |
| `sounds/city-street.ogg` | busy city 05 | rucisko | https://freesound.org/people/rucisko/sounds/462494 | CC0 1.0 |
| `sounds/wind-chimes.ogg` | Wind chimes 1 | giddster | https://freesound.org/people/giddster/sounds/437337 | CC0 1.0 |

## Images (`assets/images/`)

Downscaled to 2560 px wide and re-encoded as JPEG; otherwise unmodified. Hosted on Wikimedia Commons.

| File | Title | Author | Source URL | Licence |
|---|---|---|---|---|
| `images/forest-path.jpg` | Forest path, Ånnaboda | DimiTalen | https://commons.wikimedia.org/w/index.php?curid=125157086 | CC0 1.0 |
| `images/lake-shore.jpg` | Dokkadeltaet nord i Randsfjorden | Øyvind Holmstad | https://commons.wikimedia.org/w/index.php?curid=17532497 | CC0 1.0 |
| `images/autumn-canopy.jpg` | Autumn forest canopy (Unsplash) | Andrew Preble (apreble) | https://commons.wikimedia.org/w/index.php?curid=61773974 | CC0 1.0 |
| `images/rainy-window.jpg` | Rainy window and table book (Unsplash) | Rosalind Chang (rosalindjchang) | https://commons.wikimedia.org/w/index.php?curid=61659046 | CC0 1.0 |

## Icons (`assets/icons/`)

Own work (hourglass mark, accent `#7c9cff` on `#14161c`), released by the author under CC0 1.0.

| File | Title | Author | Source URL | Licence |
|---|---|---|---|---|
| `icons/icon.svg` | StudyAt app icon (source) | Sam (own work) | n/a | CC0 1.0 |
| `icons/icon.png` | StudyAt app icon 512 px | Sam (own work) | rendered from `icon.svg` | CC0 1.0 |
| `icons/icon.ico` | StudyAt app icon 16-256 px | Sam (own work) | rendered from `icon.svg` | CC0 1.0 |
| `icons/tray-16.png` | Tray glyph 16 px, white | Sam (own work) | rendered from `icon.svg` | CC0 1.0 |
| `icons/tray-32.png` | Tray glyph 32 px, white | Sam (own work) | rendered from `icon.svg` | CC0 1.0 |

## YouTube spaces (streamed, not bundled)

Played through the official YouTube IFrame API; no YouTube content is stored in the app. Each id
returned HTTP 200 from the oEmbed endpoint on 2026-11-08, so embedding is allowed. A video can be
removed or have embedding disabled later; the card then shows "This video can't be embedded".

| Id | Space | Title | Channel | URL |
|---|---|---|---|---|
| `WDR-5eFoxuQ` | Rain on the window | Rain Sounds for Sleep (8 Hours) - Soft Window Rain, White Noise | Rainy Bedroom | https://www.youtube.com/watch?v=WDR-5eFoxuQ |
| `wFW2_nzAFv8` | Rainy café | Cozy London Cafe Ambience on Rainy Autumn Day - Relaxing Jazz Piano & Rain Sounds | Relaxing Jazz Rhythms | https://www.youtube.com/watch?v=wFW2_nzAFv8 |
| `XxP8kxUn5bc` | Forest birdsong | 4K Forest Birdsong 2 - Birds Sing in the Woods - No Loop Realtime Birdsong | TheSilentWatcher | https://www.youtube.com/watch?v=XxP8kxUn5bc |
| `kTMja8RgJXk` | Night city balcony | SAFE ZONE: Relaxing Blade Runner Hideout for Focus & Sleep - Cozy Cyberpunk Balcony in the City | Focus Soundscapes | https://www.youtube.com/watch?v=kTMja8RgJXk |

## Quotations (`assets/quotes.json`)

Public domain: every quoted author died before 1955. The translations used are public-domain or
paraphrase-free standard renderings (for example Long's Marcus Aurelius and Epictetus, Gummere's
Seneca, Legge's Confucius and Lao Tzu, Jowett's Plato).

Weather data by Open-Meteo.com (CC BY 4.0) — fetched at runtime, not bundled.

## Third-party software

- ical.js 2.2.1 — MPL-2.0 — https://github.com/kewisch/ical.js
