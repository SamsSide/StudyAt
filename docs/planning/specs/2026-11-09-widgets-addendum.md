# StudyAt v1 — addendum: Calendar, Weather and Quote widgets

> Status: approved by Sam's request (2026-11-09, mid-build): "Can you add a Google calendar widget to, and a weather widget. Basically widgets that can look like a Mac. Also a motivational quote widget." Decisions below were ruled by the executor while Sam was asleep (he asked for no questions); each is a ledgered ruling he can revisit. Overrides spec §8's "calendar/planner out of scope" for a read-only calendar view only (no planning, no editing).

## 1. Widgets

All three are free-floating widgets like Timer/Tasks/Spotify: `WidgetId` gains `'calendar' | 'weather' | 'quote'`; `settings.widgets` gains entries (default closed): calendar `{x: 0.18, y: 0.62}`, weather `{x: 0.18, y: 0.14}`, quote `{x: 0.5, y: 0.86}` — x is the centre, y the top, as fractions. Look: macOS-widget-like glass tiles (R27 tokens), rounded 22 px, compact.

The dock gets one new item, **Widgets**, after Spotify: it opens a small glass popover listing Calendar, Weather and Quote with on/off toggles (Timer, Tasks, Spotify keep their own dock items). Shortcut: `W` toggles the popover. Help sheet lists it.

## 2. Calendar (read-only, Google Calendar via iCal)

- Source: the calendar's **"Secret address in iCal format"** (Google Calendar → Settings → your calendar → Integrate calendar). Sam pastes it in Settings → Calendar. Multiple URLs allowed (one per line, max 5). Treated as a secret: stored with `safeStorage` like Spotify tokens (`settings.calendarUrls` encrypted, never returned to the renderer — the renderer sees only `calendarConfigured: boolean` and per-calendar display names/colours), never logged.
- Main fetches each URL (`https` only; host allow-list not required, but only `https:` URLs accepted) every **15 min** while the widget is open and on demand; 10 s timeout; parses with `ical.js` (MPL-2.0, pure JS); expands recurrences (RRULE/EXDATE/RECURRENCE-ID) for **today + next 6 days**; all-day events supported; times shown in local time.
- Widget: header "Today" with weekday and date (e.g. "Monday 9 November"); list of today's events (time range · title · calendar colour bar), then "Tomorrow" and later days up to 6 items total; "No more events today" when empty; states: not set up → "Add your Google Calendar in Settings"; offline/failed → last good list plus "Couldn't refresh — showing earlier events" (or "Calendar unavailable" with none cached).
- Settings → Calendar section: the steps (1. "Open Google Calendar on the web and go to Settings." 2. "Under 'Settings for my calendars', choose your calendar, then 'Integrate calendar'." 3. "Copy the 'Secret address in iCal format' and paste it here.") , a password-style field per URL, "Remove", and a note "This link is private — StudyAt keeps it encrypted on this PC."
- IPC: `calendar.status(): { configured: boolean; calendars: { name: string; colour: string }[] }`, `calendar.setUrls(urls: string[]): CalendarStatus` (validated https, ≤ 2000 chars each, ≤ 5), `calendar.agenda(): CalendarAgenda` where `CalendarAgenda = { state: 'unconfigured' | 'ok' | 'stale' | 'error'; fetchedAt: number | null; events: { id: string; title: string; start: number; end: number; allDay: boolean; calendar: string; colour: string; location: string | null }[] }`.

## 3. Weather (Open-Meteo, no key)

- Data: `https://api.open-meteo.com/v1/forecast` (current temperature, weather code, is_day; daily max/min and code for 5 days; timezone auto), and place search via `https://geocoding-api.open-meteo.com/v1/search?name=…&count=5&language=en`. Free, no account. Attribution "Weather data by Open-Meteo.com" (CC BY 4.0) shown small in the widget's footer and in CREDITS.
- Fetched in main (renderer CSP unchanged), every **30 min** while the widget is open, 10 s timeout, last good result cached in memory + `settings.weatherCache` for offline start.
- Settings → Weather section: place search box → pick a result ("Durham, England, United Kingdom") → stores `weatherPlace: { name, latitude, longitude, country, admin1 } | null`; units `weatherUnits: 'celsius' | 'fahrenheit'` (default celsius).
- Widget (Mac Weather-widget look): place name, big current temperature, condition text + own SVG icon from the WMO code (clear, partly cloudy, cloudy, fog, drizzle, rain, snow, showers, thunder; day/night variants for clear/partly), "H:12° L:5°", a 5-day row (weekday, icon, high/low). States: not set up → "Choose your location in Settings"; offline → last cached with "Updated 14:30"; error with none → "Weather unavailable".
- IPC: `weather.searchPlaces(q: string): Place[]` (q 2–100 chars), `weather.current(): WeatherReport` (`{ state: 'unconfigured' | 'ok' | 'stale' | 'error'; place: Place | null; fetchedAt: number | null; current?: { tempC: number; code: number; isDay: boolean }; daily?: { date: string; maxC: number; minC: number; code: number }[] }`). Units converted in the renderer.

## 4. Quote

- Bundled `assets/quotes.json`: ~80 short motivational/study quotes from authors who died before 1955 (public domain), `{ text, author }`, British spelling kept as attributed. CREDITS: "Quotations: public domain (authors died before 1955)".
- One quote per study day (index from the day key, so it changes at the 04:00 rollover), a "Another" button cycles locally; typographic quotes. Look: Mac widget with large serif-ish quote text (system serif stack: "New York", "Iowan Old Style", Georgia, serif — no bundled fonts), author in small caps.
- Renderer-only; quotes loaded through IPC `quotes.list()` from main (assets path) or bundled into the renderer at build — ruling: import the JSON into the renderer bundle (simplest, offline, no IPC).

## 5. Security and data

New network calls are main-process only, to `api.open-meteo.com`, `geocoding-api.open-meteo.com`, and the user's own `https` iCal URLs. No study-time accounting is affected. Settings keys added: `weatherPlace`, `weatherUnits`, `weatherCache`, `calendarUrls` (encrypted, main-only, stripped from PublicSettings like spotifyTokens), `calendarCache` (main-only). Sanitiser and export (exportJson omits calendarUrls and caches) updated; migrations not needed (settings are key/value rows; defaults fill missing keys).

## 6. Acceptance

- Unit tests: ICS parsing incl. a weekly RRULE with EXDATE, an all-day event, a timezone'd event; agenda window; weather mapping of WMO codes; geocoding parse; IPC validation; quote of the day stable for a day key and changes next day; widgets toggle from the popover; states render their copy.
- Real-app screenshots of the three widgets (with a fixture iCal served locally or a public holiday calendar's iCal URL, and a real Open-Meteo call).

## 4b. Notes (Sam, 2026-11-09: "Also a sticky note widget so I can make little notes of things that save")

- A **Notes** widget (`WidgetId` `'notes'`, default closed, `{x: 0.82, y: 0.38}`), Mac Stickies-like: a glass frame showing one note at a time as a soft coloured sticky sheet; a small header row with ‹ › (or a dot strip) to switch notes, "New note" (+), colour picker (the six task colours: yellow default, pink, blue, green, purple, grey), and delete (with an in-place "Delete this note?" Delete/Cancel, Cancel focused).
- Free text (plain, multi-line), max **5 000** chars, placeholder "Write a note…". **Autosaves** 500 ms after typing stops, and immediately on blur, on switching notes and on window hide; never loses text on quit (main flushes on quit as for every write).
- Storage: new table `notes` (`id INTEGER PK AUTOINCREMENT`, `text TEXT`, `colour TEXT`, `sort INTEGER`, `created_at INTEGER`, `updated_at INTEGER`) via **migration v2** (pre-migration backup as spec §3.3). Repo `notesRepo(db).list/create/update/remove/reorder`. Export JSON includes `notes`.
- IPC: `notes.list(): Note[]`, `notes.create({ colour? }): Note[]`, `notes.update(id, { text?, colour? }): Note[]` (text ≤ 5000), `notes.remove(id): Note[]`. `Note { id: number; text: string; colour: TaskColour; sort: number; createdAt: number; updatedAt: number }`.
- Listed in the Widgets popover with Calendar, Weather and Quote.
