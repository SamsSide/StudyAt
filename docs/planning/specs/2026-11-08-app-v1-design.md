# StudyAt v1 (the whole app) — specification

> Status: draft. Roadmap: P1–P8 (all rows, one plan). Branch: `feat/app-v1`
> (worktree `.claude/worktrees/feat-app-v1`).

## 1. Premise

The repo has its skill set, gates and Windows scripts (P0) but no app. Sam wants the **entire
app built from one plan**, unattended, then judged as a whole. appplan §1–§7 already fix *what*
it does; this spec fixes *how*, adds the extras Sam chose during planning, and gives every
value an executor needs.

## 2. What is already true

- `docs/planning/appplan.md` — behaviour (§4 screens, §5 accounting, §6 constraints, §7 calls).
  **Everything in appplan §2–§7 is binding on this build** unless this spec overrides it, and
  where it does, §3.13 says so.
- `.claude/skills/study-dev/SKILL.md` — rules 1–11 (accounting, data safety, clocks, main-process
  timer, Electron security, no native modules, no LifeAt assets, Windows/WSL flow, secrets,
  British English, style).
- `check.sh` runs the agent verifier, then `npm run typecheck`, `npm run lint`, `npm test` once
  `package.json` exists.
- `scripts/win.sh <cmd>` syncs to `C:\Users\samue\dev\StudyAt` and runs there;
  `STUDYAT_WIN_DIR` overrides. Dependencies are added in WSL only; Windows runs `npm ci`.
- Windows user `samue`; Node 22 on both sides; no git remote.

## 3. The design

### 3.1 Stack (decided)

| Concern | Choice |
| --- | --- |
| Shell | Electron (latest stable), `electron-vite` for build/dev, `electron-builder` for packaging |
| UI | React 18 + TypeScript (strict), CSS Modules + one `tokens.css` of CSS variables |
| Renderer state | Zustand |
| Charts | Recharts (bars/lines); the heatmap is a hand-written SVG component |
| Storage | **sql.js** (SQLite compiled to WASM) in the main process, persisted to one file |
| Tests | Vitest (+ jsdom + Testing Library for components); Playwright `_electron` for e2e on Windows |
| Lint | ESLint (typescript-eslint, react-hooks) |
| Package | NSIS installer, per-user, Start menu + desktop shortcut, product name **StudyAt**, appId `io.studyat.app` |

No native modules anywhere (study-dev rule 6). npm scripts: `dev`, `build`, `typecheck`,
`lint`, `test` (Vitest, unit + component, runs in WSL), `e2e` (Playwright, Windows only, via
`scripts/win.sh`), `dist` (electron-builder, Windows only).

### 3.2 Processes and security

- **Main** owns: the database, the timer, power/idle watching, tray, mini window, global hotkey,
  notifications, Spotify auth and API calls, backups, export/restore, the renderer server and the
  media protocol.
- **Renderer** (main window and mini window) is sandboxed: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, `backgroundThrottling: false` (chimes and the
  soundboard keep playing while hidden). It talks only through `window.studyat` from the preload.
- **Renderer origin:** in development the electron-vite dev server; in production a tiny static
  HTTP server in main bound to `127.0.0.1` on a random free port, serving the built renderer
  only (path traversal rejected). This gives YouTube embeds a real `http` origin (appplan §6.2).
  A Content-Security-Policy allows self, `https://www.youtube.com`, `https://i.ytimg.com`,
  `https://i.scdn.co`, `studyat-media:`, `data:`, `blob:`.
- **Media protocol `studyat-media://<kind>/<id>`** (privileged, `stream: true`): resolves a
  space, sound or chime id to a file path **registered in the database** and streams it with
  **HTTP Range support** (video seeking). Unknown ids → 404. No other file access.
- Navigation and `window.open` are blocked except YouTube embeds in iframes; external links
  open in the default browser via `shell.openExternal` (https only).

### 3.3 Data model (schema version 1)

One file `%APPDATA%\StudyAt\studyat.sqlite`. Overridable with the env var
**`STUDYAT_USER_DATA`** (sets `app.setPath('userData')` before anything else; used by every e2e
test so Sam's real data is never touched).

| Table | Columns |
| --- | --- |
| `meta` | `key TEXT PK`, `value TEXT` — holds `schema_version` |
| `settings` | `key TEXT PK`, `value TEXT` (JSON) |
| `subjects` | `id INTEGER PK`, `name TEXT`, `colour TEXT`, `archived INTEGER 0/1`, `sort INTEGER` |
| `sessions` | `id INTEGER PK`, `pomodoro_id TEXT`, `subject_id INTEGER NULL`, `started_at INTEGER` (epoch ms), `ended_at INTEGER NULL`, `checkpoint_at INTEGER`, `focus_ms INTEGER`, `discarded_ms INTEGER DEFAULT 0`, `day_key TEXT` (`YYYY-MM-DD`), `status TEXT` (`running`/`done`) |
| `tasks` | `id INTEGER PK`, `text TEXT`, `colour TEXT`, `done INTEGER`, `sort INTEGER`, `created_at INTEGER`, `done_at INTEGER NULL` |
| `spaces` | `id INTEGER PK`, `kind TEXT` (`video`/`image`/`youtube`), `name TEXT`, `source TEXT` (path or YouTube id), `thumb TEXT NULL` (data URL or YouTube thumb URL), `favourite INTEGER`, `builtin INTEGER`, `opts TEXT` (JSON: `audio`, `volume`, `speed`, `dim`, `blur`), `created_at INTEGER` |
| `sounds` | `id INTEGER PK`, `name TEXT`, `kind TEXT` (`noise`/`file`), `source TEXT` (noise colour or path), `builtin INTEGER`, `sort INTEGER` |
| `mixes` | `id INTEGER PK`, `name TEXT`, `levels TEXT` (JSON `{soundId: 0..1}`) |
| `recaps` | `week_start TEXT PK` (`YYYY-MM-DD`, a Monday day-key), `data TEXT` (JSON `WeeklyRecap`), `shown_at INTEGER NULL` |

- **Seed on first run:** the six subjects in §3.12; built-in sounds (§3.9); built-in spaces
  (§3.8); default settings (§3.11).
- **Persistence:** the in-memory sql.js DB is exported and written **atomically** (write
  `studyat.sqlite.tmp`, fsync, rename) after every mutation, debounced to at most once per
  500 ms, and **immediately** on session start, checkpoint, stop and app quit.
- **Migrations:** an ordered array of `{ version, up(db) }`. On launch, if `schema_version` is
  below the latest, copy the file to `backups/pre-migration-v<from>-<timestamp>.sqlite` first,
  then run each pending `up` in a transaction.
- **Backups:** on the first launch of each calendar day, copy to
  `backups/daily-YYYY-MM-DD.sqlite`; keep the newest **14** daily files.
- **Corrupt file:** if the DB fails to open, rename it to `studyat.corrupt-<timestamp>.sqlite`,
  show a dialog offering "Restore latest backup" (default) or "Start fresh", never delete it.

### 3.4 Timer and accounting (appplan §4.4, §5)

A pure state machine `TimerMachine` (no clock inside; every call takes `now`) plus a
`TimerController` in main that drives it with a 250 ms tick, power and idle events, and the
session writer.

**Modes and defaults:** `focus` 25 min · `short` 5 min · `long` 15 min; long break after every
**4** completed focus segments; `autoStartBreaks` false; `autoStartFocus` false.

**States:** `idle` → `running` ⇄ `paused` → (segment ends) → next mode `idle`, or `running` if the
matching auto-start is on. `reset` returns the current mode to full length, `idle`. `skip` ends
the segment now and moves to the next mode.

**Accounting rules (binding):**
1. Only `focus` segments record time. A `pomodoro_id` (uuid) is created when a focus segment
   first starts; a `sessions` row (`status running`) is inserted **at start**.
2. `focus_ms` accrues only while `running`. The row's `checkpoint_at`/`focus_ms` are updated
   and the DB flushed every **15 s** while running, and on every pause.
3. **Pause reasons:** `user`, `suspend` (`powerMonitor` `suspend`), `lock` (`lock-screen`).
   Suspend/lock auto-pause; on `resume`/`unlock` the timer stays paused and the widget shows
   "Paused while your PC was asleep" / "…locked" until Sam resumes.
4. **Idle:** while running, poll `powerMonitor.getSystemIdleTime()` every 5 s. When it reaches
   the threshold (default **10 min**), record `idleSince = now − idleSeconds·1000` (the timer keeps
   running). When idle time next drops below 5 s, emit an `awayPrompt { awayMs }` where
   `awayMs = now − idleSince`. **Keep** → nothing changes. **Discard** → subtract `awayMs` from
   `focus_ms`, add it to `discarded_ms`, and **give it back to the countdown** (remaining time +=
   awayMs, capped at the segment length). If the segment ended while away, the discard is
   applied to that just-finished session row. No answer within 2 minutes → **discard**
   (honesty default).
5. **Subject change mid-segment:** close the current row (`ended_at = now`, `status done`) and
   insert a new row with the same `pomodoro_id` and the new subject. The countdown is unaffected.
6. **End of a focus row** (segment end, skip, reset, quit, subject change): `ended_at = now`,
   `status done`. Rows with `focus_ms < 60 000` are **deleted** (noise). The 1-minute rule
   applies per row.
7. **Crash recovery:** on launch, every `status running` row is closed with
   `ended_at = checkpoint_at` (and `focus_ms` as last checkpointed), then rule 6 applies. The
   timer starts `idle` in `focus` mode.
8. **Day key:** `day_key` is set at row insert from `started_at` using the local time zone and the
   rollover hour (default **4**): times before 04:00 belong to the previous date.
9. **Quit while running** (tray → Quit): ends the row as in 6, flushes, exits.
10. No API creates time without the timer. Editing a session can only change its subject or
    delete it.

### 3.5 Stats, streak, goal, recap (appplan §4.7, §4.8)

All pure functions in `src/core/stats/`, taking rows and a `StatsContext { now, rolloverHour,
streakMinutes, goalMinutes, weekStartsOn: 1 }`. Main runs them and serves results over IPC.

- **Day totals:** sum `focus_ms` by `day_key` (and by subject).
- **Streak:** consecutive day-keys ending today, each with ≥ **25** focus minutes; if today is
  below threshold, count from yesterday (today doesn't break it until it ends). **Longest
  streak** over all history.
- **Daily goal (Sam's extra):** default **180 min** (3 h). Top bar shows a progress ring for today;
  goal-hit days get a small dot on the heatmap.
- **Heatmap:** last 53 weeks, Monday-first columns; 5 shades: 0, <30 min, <1 h, <2 h, ≥2 h, the
  shade thresholds being constants in one place.
- **Week view:** Mon–Sun bars of hours, stacked by subject (untagged = grey).
- **Trend:** total hours per week, last 12 weeks.
- **By subject:** hours per subject for `week | month | all`.
- **Header tiles:** today, this week (with ±% vs last week; "—" if last week was 0), current
  streak, longest streak, all-time hours.
- **Weekly recap** `WeeklyRecap { weekStart, totalMs, prevTotalMs, daysStudied, bestDay {dayKey,
  ms} | null, topSubjects [{subjectId, name, ms}] (max 3), longestSessionMs, streakAtEnd,
  goalDaysHit }`. On launch, for every fully finished week (Mon–Sun by day-key) since the last
  stored recap (or since the first session's week), compute and store it. If the most recent
  finished week's recap has `shown_at` null, show it as the pop-up and set `shown_at`. A week with
  no study gets a recap with the copy in §3.14.

### 3.6 IPC surface

One typed table in `src/shared/ipc.ts`; preload exposes `window.studyat` with exactly these
methods. Main validates every payload (ids are integers, strings bounded to 500 chars, enums
checked).

| Method | Returns |
| --- | --- |
| `timer.get()` / `timer.start()` / `timer.pause()` / `timer.resume()` / `timer.reset()` / `timer.skip()` | `TimerState` |
| `timer.setMode(mode)` / `timer.setSubject(subjectId \| null)` / `timer.answerAway('keep' \| 'discard')` | `TimerState` |
| `timer.onState(cb)` / `timer.onAwayPrompt(cb)` / `timer.onSegmentEnd(cb)` | unsubscribe fn |
| `stats.overview()` | `StatsOverview` (tiles, today, goal progress, streaks) |
| `stats.heatmap()` / `stats.week(weekStart?)` / `stats.trend()` / `stats.bySubject(range)` | data for each view |
| `stats.sessions({from?, to?, subjectId?})` / `stats.updateSession(id, {subjectId})` / `stats.deleteSession(id)` | rows / ok |
| `recaps.list()` / `recaps.pending()` / `recaps.markShown(weekStart)` | `WeeklyRecap[]` / `WeeklyRecap \| null` |
| `subjects.list()` / `.create({name, colour})` / `.update(id, patch)` / `.archive(id)` | `Subject[]` |
| `tasks.list()` / `.create({text, colour})` / `.update(id, patch)` / `.reorder(ids)` / `.clearDone()` | `Task[]` |
| `spaces.list()` / `.addFiles()` (opens file dialog) / `.addYouTube(url)` / `.update(id, patch)` / `.remove(id)` / `.relocate(id)` / `.setActive(id)` | `Space[]` |
| `sounds.list()` / `.addFiles()` / `.remove(id)`; `mixes.list()` / `.save(name, levels)` / `.remove(id)` | lists |
| `settings.get()` / `settings.set(patch)` | `Settings` |
| `data.exportJson()` / `data.exportCsv()` (save dialog) / `data.listBackups()` / `data.restoreBackup(name)` (confirm dialog, then relaunch) / `data.openDataFolder()` | ok / list |
| `spotify.status()` / `.connect()` / `.disconnect()` / `.nowPlaying()` / `.play()` / `.pause()` / `.next()` / `.previous()` / `.playlists()` / `.playContext(uri)` / `.devices()` / `.transfer(deviceId)` | per call |
| `app.toggleFullscreen()` / `app.showMini(bool)` / `app.onFullscreen(cb)` | — |

`TimerState { mode, status: 'idle'|'running'|'paused', remainingMs, segmentMs, completedFocusCount,
subjectId, pauseReason: 'user'|'suspend'|'lock'|null, todayFocusMs }`.

### 3.7 Window, tray, mini timer, hotkeys

- **Main window:** default 1280×800, min 960×600, bounds remembered; standard frame; F11 and
  `F` toggle fullscreen. Title: `StudyAt` idle, `12:34 · Focus — StudyAt` while running.
- **Close** hides to tray (appplan §4.4). First time only, a notification: "StudyAt is still
  running in the tray." **Single instance**: a second launch focuses the window.
- **Tray:** icon; tooltip shows remaining time and mode; menu: Show/Hide StudyAt · Start/Pause
  · Mini timer ✓ · Quit StudyAt.
- **Mini timer (Sam's extra):** frameless, transparent, always-on-top, 240×96, draggable,
  position remembered. Shows countdown, mode, subject colour dot, a start/pause button and an
  "open StudyAt" button. Toggled from the tray, the timer widget and `M`. Setting
  `miniWhenHidden` (default **on**): shows automatically when the main window is hidden or
  minimised while the timer runs, and hides when the main window returns.
- **Global hotkey (Sam's extra):** default **Ctrl+Alt+P** = start/pause from anywhere; editable
  in Settings; registration failure shows a message there, never a crash.
- **In-app shortcuts (Sam's extra)**, ignored while typing in an input: `Space` start/pause ·
  `R` reset · `N` skip · `1`/`2`/`3` focus/short/long · `S` stats · `T` tasks · `K` sounds ·
  `G` spaces · `M` mini timer · `F` fullscreen · `Esc` close the top overlay/panel · `?`
  shortcut help.
- **Auto-hide:** dock, top bar and side panels fade after **5 s** without mouse movement
  (setting); widgets stay unless set to auto-hide. Any mouse move or key shows them.

### 3.8 Spaces (appplan §4.2)

- Library panel: tabs **All · Videos · Images · YouTube · Favourites**, search by name, grid of
  cards (thumb, name, heart, ⋯ menu: rename, settings, remove).
- **Add files:** native dialog, multi-select; video `mp4 webm mov m4v`, image `jpg jpeg png
  webp gif`. Referenced by path. Video thumbnails are captured in the renderer (seek to 10 % or
  1 s, draw a 320-px-wide frame to canvas, store as JPEG data URL).
- **Add YouTube:** accepts `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/live/`,
  `youtube.com/embed/` URLs; stores the 11-char id; thumb `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
  Plays through the IFrame API muted by default, `controls=0`, looping (`loop=1&playlist=<id>`),
  `playsinline=1`, `rel=0`, `modestbranding=1`, scaled to cover. If the API reports an error
  (embedding disabled = 101/150), the card shows "This video can't be embedded".
- **Per-space options:** `audio` on/off (default off), `volume` 0–1 (0.5), `speed` 0.5–1.5 (1),
  `dim` 0–0.6 (0.15), `blur` 0–12 px (0).
- **Missing file:** card and background show "File moved — Relocate…", which opens a dialog and
  updates the path.
- **Built-in spaces:** 4 YouTube ambience videos (verified embeddable at build time) and 4
  bundled still images (≤ 1.5 MB each, CC0/Unsplash/Pexels licence), all in `assets/CREDITS.md`.
  No bundled video files (installer size).
- Active space restored on launch; background video/YouTube paused while the window is hidden or
  minimised; `prefers-reduced-motion` → the first frame stays still until Sam presses play on
  the space footer.

### 3.9 Soundboard and chimes (appplan §4.3, §4.4)

- **Engine:** one Web Audio `AudioContext` in the renderer. `master` gain → destination.
  Channels: `noise` (generated white/pink/brown noise buffers, 10 s, looped with equal-power
  crossfade-free loop since noise is seamless) and `file` (decoded `AudioBuffer`, `loop = true`).
  Each channel has its own gain; a channel at 0 is disconnected and its source stopped (CPU).
- **Built-in channels:** White noise, Pink noise, Brown noise (generated), plus bundled loops
  sourced CC0 (Freesound CC0 filter, or Wikimedia Commons public domain), each ≤ 2 MB, OGG
  Vorbis, loop-trimmed: **Rain, Thunderstorm, Café, Fireplace, Ocean waves, Forest birds,
  Wind, Keyboard typing, City street, Wind chimes**. If a clean CC0 loop can't be found for one,
  drop that channel and note it in CREDITS; never substitute a non-free file.
- **Panel:** master slider, the active space's audio slider (YouTube volume / video element
  volume), then every channel with mute toggle + slider; "Add sound…" (mp3/ogg/wav/m4a, referenced
  by path); **Mixes**: save current levels with a name, click to apply, delete.
- Levels and master are restored on launch. If the `AudioContext` starts suspended (autoplay
  policy), it resumes on the first click or key press.
- **Chimes:** a separate `chime` gain (setting `chimeVolume` default **0.7**) → destination,
  independent of master. **Five built-in chimes synthesised in code** (no files, no licences):
  **Bell, Singing bowl, Wood block, Marimba, Soft digital**. Settings: `chimeFocusEnd` (default
  Bell), `chimeBreakEnd` (default Marimba), each chosen from the five or a custom file;
  `chimeRepeat` 1–3 (default **1**, 1.2 s apart); preview ▶ beside each; `tickLastMinute`
  (default off: a soft tick each second in the final 60 s of a focus segment); `chimeOnStart`
  (default off: Wood block when a focus segment starts). Chimes are triggered by main's
  `onSegmentEnd` and play while the window is hidden.

### 3.10 Tasks, Spotify (appplan §4.5, §4.6)

- **Tasks widget:** input "Add a task…" + Enter; notes in 6 colours (yellow default, pink, blue,
  green, purple, grey) as small sticky cards; click text to edit; checkbox ticks off (moves to a
  collapsible "Done (n)" list); drag to reorder (pointer events, keyboard: `Alt+↑/↓`); "Clear
  done". Text max 500 chars.
- **Spotify:** Settings → Spotify shows the numbered setup steps (§3.14) and a Client ID field.
  `connect()` opens the system browser to Spotify's authorize URL (Authorization Code + **PKCE**,
  S256) with redirect **`http://127.0.0.1:43821/callback`** and scopes
  `user-read-playback-state user-modify-playback-state user-read-currently-playing
  playlist-read-private playlist-read-collaborative`. Main runs a one-shot HTTP listener on that
  port (closed after the callback or 5 min), exchanges the code, stores tokens encrypted with
  `safeStorage` in `settings.spotifyTokens`, refreshes 60 s before expiry. Disconnect deletes
  them.
- **Widget:** album art, title, artist, progress bar; ⏮ ⏯ ⏭; playlist picker (first 50 of
  Sam's playlists; choosing one plays it on the active device); device picker. Polls
  `nowPlaying` every **3 s** only while the widget is open and the window visible. States:
  not set up → "Set up Spotify in Settings"; no active device → "Open Spotify on any device,
  then press play" + device list; 401 after refresh fails → "Reconnect Spotify"; offline →
  "Spotify is offline". 429 → back off for `Retry-After`.

### 3.11 Settings (appplan §4.9) — keys and defaults

| Key | Default |
| --- | --- |
| `focusMinutes` / `shortMinutes` / `longMinutes` | 25 / 5 / 15 (range 1–180) |
| `longEvery` | 4 |
| `autoStartBreaks` / `autoStartFocus` | false / false |
| `chimeFocusEnd` / `chimeBreakEnd` | `"bell"` / `"marimba"` |
| `chimeVolume` / `chimeRepeat` | 0.7 / 1 |
| `tickLastMinute` / `chimeOnStart` | false / false |
| `notifications` | true |
| `streakMinutes` | 25 |
| `goalMinutes` | 180 |
| `rolloverHour` | 4 (0–23) |
| `idleMinutes` | 10 (range 2–60) |
| `autoHideSeconds` | 5 (0 = never) |
| `miniWhenHidden` | true |
| `globalHotkey` | `"Ctrl+Alt+P"` (empty = off) |
| `launchAtStartup` | false |
| `activeSpaceId` / `soundLevels` / `masterVolume` | first built-in / `{}` / 0.8 |
| `widgets` | `{ timer: {open: true, x: 0.5, y: 0.12, autoHide: false}, tasks: {open: false, …}, spotify: {open: false, …} }` (x/y as fractions of the window) |
| `spotifyClientId` / `spotifyTokens` | `""` / null |
| `onboarded` / `trayNoticeShown` | false / false |

Settings overlay sections: **Timer · Chimes · Goals & streak · Subjects · Spotify · Shortcuts ·
Data · General**. Data: Export JSON, Export CSV, backups list with "Restore…", "Open data
folder". General: launch at start-up, auto-hide delay, mini timer when hidden.

**Export formats.** JSON: `{ exportedAt, schemaVersion, subjects, sessions, tasks, spaces,
sounds, mixes, recaps, settings (without spotifyTokens) }`. CSV (sessions only): header
`date,start,end,minutes,subject` — local times `YYYY-MM-DD HH:mm`, minutes to 1 dp.

### 3.12 Pre-filled subjects (Sam's choice)

| Name | Colour |
| --- | --- |
| COMP2181 Theory of Computation | `#7c9cff` |
| COMP2211 Networks and Systems | `#5ccfb0` |
| COMP2221 Programming Paradigms | `#f2b45c` |
| COMP2261 Artificial Intelligence | `#e57aa8` |
| COMP2271 Data Science | `#9ad06b` |
| COMP2281 Software Engineering | `#b48cf2` |

### 3.13 Overrides of appplan

- appplan §4.4 listed "birdsong" among chimes; chimes are now **five synthesised sounds**
  (§3.9) so no audio licence is needed; custom files still allowed.
- appplan §4.2 "a handful of starter spaces" is pinned to 4 YouTube + 4 images (§3.8).
- Added (Sam, 2026-11-08): daily goal, global hotkey, mini always-on-top timer, in-app shortcuts,
  pre-filled subjects, NSIS installer.
- Idle "no answer within 2 minutes → discard" and "discarded away time is returned to the
  countdown" are new precise rules for appplan §5.

### 3.14 Copy (verbatim)

- Tray notice: "StudyAt is still running in the tray."
- Paused by system: "Paused while your PC was asleep" / "Paused while your PC was locked".
- Away prompt: title "Welcome back", body "You were away for {n} min. Keep that time as study?",
  buttons "Keep it" / "Discard" (Discard is the focused default).
- Recap title: "Your week: {d MMM}–{d MMM}". Empty week body: "No focus time last week — that's
  okay. A fresh week starts now."
- Streak tile label: "Day streak"; goal ring tooltip: "{h}h {m}m of {goal} today".
- Spotify setup steps:
  1. "Go to developer.spotify.com/dashboard and log in."
  2. "Create an app. Any name works, e.g. StudyAt."
  3. "Add this Redirect URI: http://127.0.0.1:43821/callback"
  4. "Tick 'Web API', save, then copy the Client ID here."
- Empty spaces search: "No spaces match." Embed blocked: "This video can't be embedded."
- Missing file: "File moved — Relocate…"

## 4. On screen

- **First launch:** the first built-in space, timer widget open (top centre), a one-time
  welcome card: "Welcome to StudyAt — pick a space, start a Pomodoro, and your study time is
  tracked from here." with "Got it". The six subjects exist.
- **Main view:** background; **top bar** left: 🔥 streak (click → Stats), today's focus `2h 05m`,
  goal ring; right: mini-timer toggle, fullscreen, settings. **Dock** left (icon + label):
  Spaces, Sounds, Timer, Tasks, Spotify, Stats, Settings. Spaces/Sounds open a 360-px side panel;
  Timer/Tasks/Spotify toggle widgets; Stats and Settings are full-window overlays (frosted
  backdrop, `Esc` closes).
- **Timer widget:** mode tabs (Pomodoro · Short break · Long break), big `MM:SS`, Start/Pause,
  Reset, Skip, subject dropdown (coloured dots, "No subject"), small "🍅 2/4" counter, gear →
  Timer settings.
- **Stats overlay:** tiles row; heatmap; "This week" stacked bars with ‹ › week navigation;
  "Last 12 weeks" trend; "By subject" with range toggle; "Sessions" table with subject change
  and delete (confirm); "Weekly recaps" list.
- **Visual direction:** dark frosted panels (`rgba(20,22,28,0.72)` + `backdrop-filter: blur(16px)`),
  12 px radii, Inter/system font stack, accent `#7c9cff`, subtle 150 ms transitions; WCAG AA text
  contrast on panels; visible focus rings.

## 5. Data and IPC

As §3.3 and §3.6. Schema v1 is the first version, so its migration creates every table; a test
proves a v0 (empty file) → v1 migration and the pre-migration backup.

## 6. Accounting impact

This build **creates** the accounting system: appplan §5 plus the precise rules in §3.4. Sam's
rulings: focus-only (2026-11-08), suspend/lock auto-pause + idle keep/discard (2026-11-08),
close-to-tray (2026-11-08). New precise rules flagged for Sam in §3.13.

## 7. Failure and edge cases

| Case | Behaviour |
| --- | --- |
| Crash / power cut mid-focus | ≤ 15 s lost; orphan closed at checkpoint (§3.4.7) |
| DB file corrupt | §3.3 corrupt flow; nothing deleted |
| Clock jumps backwards while running | accrual uses `max(0, Δ)` per tick; never negative |
| Sleep across midnight / week end | session credited to its start day; recaps computed on next launch |
| Video file moved | relocate state, no crash |
| YouTube offline or blocked | space shows its thumbnail with "Offline" / embed message |
| Spotify: no Client ID, no device, token revoked, offline, 429 | §3.10 states |
| Port 43821 busy | connect shows "Port 43821 is in use — close the other app and retry" |
| Global hotkey taken | message in Settings → Shortcuts |
| Paths with spaces / non-ASCII | media protocol and dialogs handle them (tested) |
| Two windows/instances | single instance lock |
| High-DPI | CSS px only; tray icon has 16/32 px variants |

## 8. Out of scope

Rooms, chat, accounts, sync, calendar/planner, Notes, Fortune, Breathe, mobile/macOS, LifeAt
import, manual time entry, auto-update, code signing. None has a roadmap row.

## 9. Acceptance criteria

| # | Criterion | Verified by |
| --- | --- | --- |
| 1 | `./check.sh` green (verifier, typecheck, lint, all unit/component tests) | check.sh |
| 2 | Accounting rules §3.4.1–10 each have a passing unit test with an injected clock | Vitest |
| 3 | Day key, streak (24:59 vs 25:00), goal, heatmap shades, week/trend/subject totals, recap incl. DST and rollover cases pass | Vitest |
| 4 | Migration v0→v1 with pre-migration backup; daily backup rotation keeps 14; corrupt-file rename | Vitest |
| 5 | Media protocol serves only registered ids, supports Range, handles spaces in paths | Vitest |
| 6 | App launches on Windows with a throwaway `STUDYAT_USER_DATA`, shows the first space, timer, six subjects | e2e + screenshot |
| 7 | Start a focus segment with a subject, run ≥ 70 s (test uses `focusMinutes` override via settings to 2), it records a `sessions` row with the right subject and day key; stats overview today ≥ 1 min | e2e |
| 8 | Kill the app mid-focus; relaunch; the row is closed at its checkpoint | e2e |
| 9 | Close → hides to tray, timer keeps running; mini timer appears (miniWhenHidden) | e2e + screenshot |
| 10 | Stats overlay renders tiles, heatmap, week, trend, subject, sessions with seeded data | e2e + screenshot |
| 11 | Adding a local image and a YouTube URL creates spaces and switches background | e2e + screenshot |
| 12 | Soundboard channel volume change persists across relaunch | e2e |
| 13 | Tasks: add, tick, reorder, clear done persist | component tests + e2e |
| 14 | Spotify: PKCE URL, callback exchange, refresh, every widget state | Vitest (mocked API) |
| 15 | Keyboard shortcuts and global hotkey toggle the timer | component test + e2e |
| 16 | Weekly recap pop-up shows once for the last finished week with seeded data | e2e + screenshot |
| 17 | `npm run dist` on Windows produces `release/StudyAt Setup <version>.exe` | study-testing |
| 18 | Every bundled asset has a CREDITS line; no LifeAt URL/name appears in `src/` or `assets/` | grep in check.sh |
| 19 | Looks calm and polished; Spotify works with Sam's account; chimes sound nice | 👤 hand-walk |

## 10. Hand-walk (Sam)

1. Run `scripts/win.sh npm run dev` (or install `release/StudyAt Setup *.exe`).
2. Pick a space; add one of your own videos and a YouTube link.
3. Mix rain + brown noise; save it as a mix.
4. Pick "COMP2261 Artificial Intelligence", start a Pomodoro; let it chime; check the break chime.
5. Lock your PC for a minute mid-focus → it should be paused when you return.
6. Close the window → the mini timer shows; Ctrl+Alt+P pauses from another app.
7. Open Stats: today, streak, heatmap, week bars coloured by subject.
8. Set up Spotify (Settings → Spotify), play a playlist from the widget.
9. Add a few sticky-note tasks, tick one off.
10. Tell me what looks or feels off.

## 11. Open questions

None blocking. Precise rules first stated here (§3.13) are flagged for Sam's read.
