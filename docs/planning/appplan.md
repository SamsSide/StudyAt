# StudyAt — appplan

> The living description of what StudyAt does. Code, specs and plans cite it as "appplan §N".
> Seeded on 2026-11-08 from the approved design
> (`docs/superpowers/specs/2026-11-08-studyat-design.md`); section numbers are kept identical.
> When a spec changes how the app works, its plan's last task updates the section here.
> Updated on 2026-11-09 for the v1 build (`docs/planning/specs/2026-11-08-app-v1-design.md` and
> `docs/planning/specs/2026-11-09-widgets-addendum.md`), and again for v1.1 polish
> (`docs/planning/specs/2026-11-09-v1-1-polish-design.md`).

## Feature status

| Feature | appplan | Roadmap | Status |
| --- | --- | --- | --- |
| Repo skill set, gates, Windows scripts | §8 | P0 | built |
| App scaffold, Windows run, tray, single instance | §4.1, §4.4, §6 | P1 | built |
| Timer, chimes, focus accounting, storage, backups | §4.4, §5, §6.4 | P2 | built |
| Stats, streak, heatmap, weekly recap | §4.7, §4.8, §5 | P3 | built |
| Spaces | §4.2 | P4 | built |
| Soundboard | §4.3 | P5 | built |
| Tasks widget | §4.5 | P6 | built |
| Spotify widget | §4.6 | P7 | built |
| Settings, export/restore, packaging polish | §4.9, §6.4 | P8 | built |
| Extras: daily goal, global hotkey, mini timer, shortcuts, subjects, glass look | §4.10 | P1–P8 | built |
| Widgets popover, Calendar widget (read-only, iCal) | §4.10, §6.2 | W | built |
| Weather widget (Open-Meteo) | §4.10, §6.2 | W | built |
| Quote widget | §4.10 | W | built |
| Notes widget | §4.10, §6.4 | W | built |
| v1.1 polish: away switch, Countdown, task on the timer, focus view, scaling and resizable widgets, image/GIF widgets, pop-out Spotify, YouTube fix | §4.1, §4.2, §4.4, §4.6, §4.7, §4.9, §4.10, §5, §6.2, §6.4 | V1.1 | built |

## 1. Intent

Sam studies most days inside LifeAt (lifeat.io): a full-screen looping video "space", an
ambient soundboard, a Pomodoro timer and quick sticky-note tasks. They like all of that, but the
part they care about most — **knowing how long they actually studied** — is thin and paywalled
(LifeAt free shows only "longest streak" and "hours on app"; focus-time tracking, notes and
analytics are Pro). They have a 40-day longest streak and 660 hours on the app, so this is a
daily-use tool, not a toy.

StudyAt is a **personal, local-only Windows desktop app** that keeps the LifeAt study
atmosphere and puts **honest, detailed study-time tracking** at the centre. Only Sam uses it,
on their own PC. It must be something they actually switch to and use every day: fast to build,
but functional and polished, not a demo.

What makes it theirs: their own videos as spaces, subject-tagged study time (their university modules,
e.g. COMP2261), a Spotify widget, and stats they don't have to pay for.

## 2. Goals, non-goals, anti-goals

**Goals**
- Pomodoro focus timer whose running time is the single source of study-time truth.
- Rich stats: current/longest streak, study calendar heatmap, hours per day/week, per-subject
  breakdown, week-over-week trend, a weekly recap.
- Custom spaces: their own video files, images and YouTube links as the background.
- Ambient soundboard with per-sound volume, plus their own sound files.
- Sticky-note tasks.
- Spotify widget (they have Premium): now playing, play/pause/next/previous.
- Free-floating draggable widgets over the space, like LifeAt.

**Non-goals** (LifeAt features deliberately left out)
- Rooms, invites, chat, co-working, group timers, accounts, cloud sync.
- LifeAt's calendar/daily planner, task-to-calendar, Fortune, Breathe. (A read-only calendar
  view was added later at Sam's request, §4.10; there is still no planning or editing.)
- Mobile, macOS, multi-user.
- Importing LifeAt history (Sam declined; the app starts from zero).

**Anti-goals** (failure even if it "works")
- **Losing study data** — a crash, quit or power cut mid-session must not lose recorded minutes,
  and there must be a backup.
- **Inflated numbers** — idle, breaks, or the app merely being open must never count as study.
- Needing the internet to track time. Only YouTube spaces, Spotify and the Calendar and Weather
  widgets may need a connection.
- A laggy or battery-hungry background that makes them go back to LifeAt.
- Copying LifeAt's brand, name, logos or media files. The *ideas* and layout are fine; their
  audio/video assets are not (see §6.3).

## 3. Decisions Sam made

| Topic | Decision |
| --- | --- |
| Platform | **Electron + React + TypeScript**, running as a normal Windows app |
| What counts as study | **Only time a focus timer (Pomodoro or Countdown) is running.** Breaks, pauses, idle and app-open time never count (idle counts only if Sam turns the away prompt off, §5) |
| Subjects | **Optional subject tag** per focus session; stats break down by subject |
| Streak rule | A day counts if it has **≥ 25 minutes of focus** (one full Pomodoro's worth) |
| Weekly recap | **Pop-up card on first open of a new week**, past recaps browsable in Stats |
| Widget layout | **Free-floating, draggable**, opened from a side dock, positions remembered |
| Spotify | They have **Premium** → widget (now-playing, controls; a pop-out style since v1.1) via a one-time Spotify developer app setup |
| Repo tooling | A repo skill set **first**, mirroring their Stitched Off repos (§8), then the app |

## 4. The app, screen by screen

### 4.1 Main view (the "space")
- Full-window background: the active space (video loops muted by default, or a still image).
- **Left dock** (icons + labels, like LifeAt): Spaces, Sounds, Timer, Tasks, Spotify, Widgets,
  Stats, Settings. Spaces and Sounds open as a side panel; Timer, Tasks and Spotify toggle floating
  widgets; Widgets opens a popover of toggles for the other widgets (§4.10); Stats and Settings
  open full-window overlays.
- **Top bar**: current streak (🔥 n, click → Stats), today's focus total, fullscreen toggle.
- **Auto-hide**: after ~5 s without mouse movement the dock, top bar and panels fade out;
  widgets stay (each widget can be pinned or set to auto-hide). Moving the mouse brings it back.
- Widgets are draggable by their header, clamped to the window, positions/open state persisted
  per widget, and re-clamped when the window is resized.
- **Proportional layout (v1.1):** positions are fractions of the window, and every widget scales
  with it: `layoutScale = clamp(min(width / 1920, height / 1080), 0.5, 2)` (`LAYOUT_REF` is one
  constant). A smaller window shrinks the layout in place instead of piling widgets at the edges.
- **Resizable widgets (v1.1):** a 16 px corner handle (bottom-right, shown on hover or keyboard
  focus, fading with auto-hide) sets each widget's own scale, 0.5–2 (`+`/`-` step 0.1, `0` or a
  double-click resets). Rendered scale = layout scale × widget scale, shrunk for display only if
  the widget wouldn't fit.
- **Focus view (v1.1):** `H` or the top bar's "Hide interface" button hides the dock, top bar,
  side panel and auto-hide widgets, and they stay hidden through mouse moves and typing. `H`,
  `Esc` (when no overlay is open) or a "Show interface" capsule that appears only while the
  pointer is in the top-left 64 × 64 px corner bring them back. Shortcuts keep working: S and ?
  open their overlay over focus view; W, K and G (and T for an auto-hide Tasks widget) leave focus
  view so what they open is visible. Not remembered between launches.

### 4.2 Spaces
- Library grid with tabs: **All · Videos · Images · YouTube · Favourites**, a search box, and a
  heart on each card.
- **Add space**: pick a local video (mp4/webm/mov) or image (jpg/png/webp/gif), or paste a
  YouTube URL. A thumbnail is generated (a video frame, or YouTube's thumbnail). Name editable.
- Local files are **referenced by path, not copied** (4K loops are large). A missing file shows
  a "file moved — relocate" state rather than breaking.
- Per-space settings: play the space's own audio (on/off + volume, mainly for YouTube mixes),
  playback speed, dim overlay (0–60 %), blur.
- Ships with **8 starter spaces** so the first launch isn't empty: 4 YouTube ambience videos
  (checked embeddable) and 4 bundled free-licence still images. No bundled video files, to keep
  the installer small.
- The last-used space is restored on launch.
- **YouTube embeds (v1.1):** the renderer is served as `http://localhost:<port>` because YouTube
  answers error 150 to a bare-IP referrer for rights-managed videos. Videos whose owner blocks
  embedding still show "This video can't be embedded"; player configuration errors 152/153 show
  the "couldn't play" message and are logged.

### 4.3 Sounds (soundboard)
- Master volume; the space's audio volume; a list of ambience channels, each with a mute toggle
  and a volume slider, all playing at once and looping seamlessly.
- Channels: **generated** white, pink and brown noise (Web Audio, no files), plus bundled
  free-licence loops for rain, thunderstorm, café, fireplace, ocean, forest/birds, wind, keyboard
  typing, city/street, wind chimes (final list depends on what clean CC0/permissive loops exist).
- **Add your own sound** (mp3/ogg/wav) → becomes a channel.
- **Saved mixes** ("Rainy café" = rain 40 % + café 25 %) for one-click recall.
- The mix is restored on launch (but starts muted until the first interaction if autoplay
  policy requires it).

### 4.4 Timer widget
- Modes: **Pomodoro · Short · Long · Countdown**; defaults 25 / 5 / 15 min, long break after
  every 4 Pomodoros; all editable in the widget's settings.
- **Countdown (v1.1):** one focus block of 1–240 min (default 60; shortcut `4`). While idle in
  Countdown, presets 30 · 45 · 60 · 90 · 120 and a number field set its length. It is study time
  exactly like a Pomodoro focus segment. At the end: the focus-done chime and "Countdown done"
  ("{n} min of focus."), then idle in Countdown at full length — no break, no auto-start, and the
  Pomodoro long-break cycle is unaffected. Skip in Countdown resets it.
- Big countdown, Start/Pause, Reset, Skip. Toggles: auto-start breaks, auto-start next
  Pomodoro.
- **Subject picker** on the widget (blank = untagged). Subjects are managed in Settings (name +
  colour). Changing the subject mid-session applies from that point on.
- **Task picker (v1.1)** under the subject picker, in Pomodoro and Countdown: "No task" plus every
  not-done task in list order. Changing the task mid-session splits the session like a subject
  change. A held task that is ticked off or deleted stays while its focus segment runs or is paused
  (no split);
  whenever no focus segment is running — after it ends, on Skip, Reset or a mode change, or if it
  is ticked off while idle or on a break — the timer drops it back to "No task" (cleared in main,
  before any auto-started focus opens its row).
- **Chimes (Sam asked for these explicitly):** a sound plays at the end of every segment, with
  **separate chimes for "focus done → break" and "break done → back to focus"**. Choose each
  from **five chimes synthesised in code** — Bell, Singing bowl, Wood block, Marimba, Soft
  digital (no files, so no audio licence) — or **add your own sound file**. Defaults: Bell for
  focus done, Marimba for break done. Each has a preview ▶ button, chime
  volume is separate from the soundboard, and a repeat count of 1–3. An optional gentle
  "1 minute left" tick and an optional sound when a Pomodoro starts are both off by default.
  Chimes play even when the window is hidden in the tray. A Windows notification fires as well.
- Timing is **timestamp-based**, so it stays correct when minimised or throttled.
- The window/taskbar title shows the remaining time while running.
- **Closing the window (Sam's decision) hides StudyAt to the system tray**; the timer keeps
  running and notifications still fire. The tray icon shows/hides the window, shows the
  remaining time in its tooltip, and has Pause/Resume and **Quit** (Quit ends any running
  session at that moment and saves it). Single-instance: launching again focuses the existing
  window. Background video is paused while hidden, and the mini timer appears (§4.10).

### 4.5 Tasks widget (sticky notes)
- Quick-add box; each task is a small sticky note with text, a tick-off checkbox and one of a
  few colours. Drag to reorder. Completed tasks collapse into a "Done" section that can be
  cleared. Persisted locally.

### 4.6 Spotify widget
- One-time setup in Settings: Sam creates a free app at developer.spotify.com, pastes its
  Client ID; the app signs in with **Authorization Code + PKCE** using a loopback redirect
  (`http://127.0.0.1:<port>/callback`). Tokens are stored locally and refreshed automatically.
  The settings page shows step-by-step instructions for this.
- **Pop-out style (v1.1), like the Windows media flyout:** album art (64 px), title, artist, a
  thin progress line that moves smoothly between polls, and previous / play-pause / next —
  nothing else while playing. Title and artist truncate with the full text in a tooltip. The
  playlist and device pickers were removed from the widget (the main-process API stays); with no
  active device it still lists device buttons to wake one.
- **Playback happens in their Spotify app (desktop or phone) via Spotify Connect**, controlled
  through the Web API. (Playing audio *inside* Electron would need the Widevine DRM build of
  Electron; not worth it.) If no device is active, the widget says so and offers to open
  Spotify.
- Polls now-playing every few seconds only while the widget is open.

### 4.7 Stats (full-screen overlay)
- **Header tiles**: today, this week (vs last week, ±%), current streak, longest streak, total
  hours all time.
- **Study calendar**: GitHub-style heatmap of the last 12 months, shaded by focus minutes;
  hover/click a day for its total and per-subject split; streak days marked.
- **This week**: bar chart of hours per day (Mon–Sun), bars stacked by subject.
- **Weeks over time**: hours per week for the last 12 weeks (trend line or bars).
- **By subject**: hours per subject for a chosen range (week / month / all time).
- **By task (v1.1)**: next to By subject, minutes per task for the same range, largest first,
  top 10, labelled with the task's newest name; sessions without a task aren't listed.
- **Sessions list**: every focus session (date, start–end, minutes, subject, task), filterable.
  Sessions can be edited (subject, delete) to fix mistakes; the task isn't editable.
- **Weekly recaps** list (§4.8).
- Range picker on the charts: week · month · 12 weeks · year · all.

### 4.8 Weekly recap
- Weeks run **Monday–Sunday**. On the first launch after a week ends, a recap card pops up for
  the week just finished: total hours, change vs the previous week, days studied out of 7, best
  day, top subject(s), longest single session, streak at week's end. Dismiss to continue.
- Recaps are stored and browsable in Stats. A week with no study gets a recap too (gently worded).

### 4.9 Settings
- Timer defaults and chime; subjects (add / rename / recolour / archive); streak threshold
  (default 25 min); day rollover hour; auto-hide delay; Spotify setup; data folder location,
  **Export** (JSON and CSV of sessions) and **Restore from backup**; launch at Windows start-up
  (off by default).
- Also: daily goal, global hotkey, mini timer when hidden, Calendar addresses, Weather place and
  units (§4.10).
- Timer (v1.1): **"Ask if I've been away"** (on by default; off: away time still counts, while
  locking or sleeping still pauses — the idle-minutes control is disabled while it's off), and
  **Countdown length** (1–240 min).

### 4.10 Extras (added by Sam during planning and the build)
- **Daily goal**: default 3 h. A progress ring in the top bar shows today against it; goal-hit
  days get a small dot on the heatmap, and the weekly recap counts them.
- **Global hotkey**: Ctrl+Alt+P starts or pauses the timer from any app. Editable in Settings; if
  Windows refuses the key, Settings says so and the old key stays.
- **Mini timer**: a small frameless, always-on-top timer (countdown, mode, subject dot,
  start/pause, open StudyAt). It shows by itself when the main window is hidden or minimised
  while the timer runs (setting, on by default), and can be toggled from the tray, the timer
  widget or `M`. Its position is remembered.
- **In-app shortcuts** (ignored while typing): `Space` start/pause · `R` reset · `N` skip ·
  `1`/`2`/`3`/`4` Pomodoro/short/long/Countdown · `S` stats · `T` tasks · `K` sounds · `G`
  spaces · `W` widgets popover · `M` mini timer · `F` fullscreen · `H` hide or show the interface
  (focus view, §4.1) · `Esc` close the top overlay, leave focus view, or close the panel · `?` help.
- **Pre-filled subjects**: Sam's six modules (COMP2181, COMP2211, COMP2221, COMP2261, COMP2271,
  COMP2281), each with its own colour, ready on first launch.
- **Widgets popover**: a dock item after Spotify that lists Calendar, Weather, Quote and Notes
  with on/off toggles. Each is a free-floating widget like the others, closed by default.
- **Calendar** (read-only): today's events and the next few days, from Google Calendar's "Secret
  address in iCal format" (up to 5 calendars), pasted in Settings → Calendar. Recurring and
  all-day events are handled; refreshed every 15 min while open. Offline, it shows the last good
  list with "Couldn't refresh — showing earlier events". No planning or editing.
- **Weather**: place, current temperature and condition, today's high and low, and a 5-day row,
  from Open-Meteo (free, no account; attribution in the widget). Place and °C/°F are chosen in
  Settings → Weather; refreshed every 30 min while open; the last result is kept for offline
  starts.
- **Quote**: one motivational quote per study day (it changes at the rollover hour) from a
  bundled list of public-domain quotes, with an "Another" button.
- **Notes**: several sticky notes, one shown at a time, in the six task colours, up to 5,000
  characters each. They save themselves as you type, on switching note, on hide and on quit.
- **Image / GIF widgets (v1.1)**: up to 12, added from the Widgets popover's "Add image…" — a
  GIF, PNG, JPEG or WebP file (checked by its bytes, not its name) or an `https` link (a Giphy
  page link is mapped to its GIF), up to 20 MB. Each is copied once into the data folder's
  `images/` and served through the media protocol. A widget is **framed** (the usual glass, title
  "Image") or **bare** (just the image with rounded corners; a toolbar shown on hover or keyboard
  focus has "Show background" and "Remove"). New images cascade slightly down and right of the
  last so they don't stack. Drag to move, resize from the corner, remove after "Remove this
  image?". A file deleted by hand shows "Image missing" (at least 160 × 80 px) with Remove, which also asks first.
- **Look**: a macOS / Liquid Glass feel throughout — layered translucent glass, soft shadows,
  larger rounded corners, capsule buttons, segmented controls and toggles, system fonts. Own
  icons only, no Apple assets. Text keeps WCAG AA contrast and every control has a visible
  focus ring. The glass tint lives in `tokens.css` for Sam to tune.

## 5. Study-time accounting (the core rule)

- A **focus session** is one focus segment (a Pomodoro or a Countdown, v1.1). Only the seconds
  its countdown is actually running are recorded. Pause stops accrual. Breaks are never study
  time.
- A segment that is reset or skipped early still keeps the minutes it actually ran (they were
  studied); a recorded piece under 1 minute is discarded as noise (the rule applies to each
  subject piece on its own).
- **Crash safety**: an in-progress session is written to the database when it starts and
  checkpointed every 15 s (and on every pause), so a crash or power cut loses at most ~15 s. On
  next launch an orphaned in-progress session is closed at its last checkpoint and the timer
  starts fresh.
- **Sleep and lock (Sam's decision):** a running Pomodoro **auto-pauses when the PC sleeps or the
  screen locks** (Electron `powerMonitor` suspend / lock-screen). On return it stays paused with
  "Paused while your PC was asleep" / "…locked" until Sam resumes.
- **Unreported sleep (Sam, A4):** if more than **30 s** pass between two timer ticks while it
  runs (a sleep Windows didn't announce, or the clock jumping forward), the timer is paused as
  asleep at the last tick and the gap never counts. A clock jumping backwards never subtracts.
- **Idle (Sam's decision):** after **10 minutes with no keyboard/mouse input** (system idle time,
  2–60 min in Settings) the timer keeps running, and the next input brings up "You were away for
  N min. Keep that time as study?". N is the **focus time at stake** — the focus that ran while
  Sam was away — not the wall-clock absence (A2).
  - **Keep** changes nothing. **Discard** (the focused default) removes that time from the
    session, records it as discarded, and gives it back to the countdown (capped at the segment
    length) if the away stretch fell inside the segment still running. If the segment ended
    while Sam was away, the discard is taken from that finished session instead.
  - **No answer within 2 minutes → discard.**
  - **Quitting** while away or with the prompt open → discard (A1).
  - **A crash or power cut** during an unanswered away period → discard on the next launch
    (R39). Before Sam returns, the whole away stretch is removed; once the prompt is up, exactly
    the time it asked about is removed and focus earned after Sam's return is kept.
  - **The away prompt can be switched off (Sam, 2026-11-09):** Settings → Timer → "Ask if I've
    been away". Off: no idle polling, no prompt, no discard — away time counts. Sleep, lock and
    the 30 s unreported-sleep rule are unchanged. Switching it off drops an away period not yet
    asked about (its time is kept) and clears the crash marker; a prompt already showing still
    resolves. Switching it back on applies from that moment: an away period never reaches back
    before the switch.
- Because this needs power/idle events, the **timer and session writer live in the Electron main
  process**; the renderer only displays and sends commands.
- **Changing the subject mid-session** closes the current piece and starts a new one with the
  new subject, so each minute is credited to the right subject. The whole Pomodoro stays on the
  day it **started**, even if the change comes after the rollover hour (A3).
- **Changing the task mid-session (v1.1)** splits the same way; each piece records the task's id
  and its name at that moment, so a task later renamed or cleared still shows by its old name.
  Like subject pieces, a task piece under 1 minute is discarded (Sam, 2026-11-09: kept as is).
- A session is credited to the day it **started** on (with the rollover hour from §7). A
  session crossing midnight isn't split.
- **Streak**: the number of consecutive days, ending today or yesterday, each with ≥ threshold
  focus minutes. Today not yet reaching the threshold doesn't break the streak until the day ends.
- No manual "add time" entry (keeps numbers honest); editing existing sessions is allowed
  (§4.7), but only the subject can change, and a session still running can't be edited or
  deleted. Editing or deleting a session recomputes that week's stored recap.

## 6. Constraints

### 6.1 Environment
- Sam's PC is Windows with WSL2 (Ubuntu). The repo lives in WSL at `~/dev/StudyAt`. Node 22 is
  on both sides. The app must run as a **Windows** program; Electron does not run usefully
  from inside WSL.
- **No native Node modules** (e.g. no `better-sqlite3`), so the app builds on Windows without a
  C++ toolchain and nothing needs rebuilding per OS. Use pure-JS/WASM storage.
- The repo needs scripts that (a) run typecheck, lint and unit tests in WSL, and (b) launch the
  dev app and build the installer **on the Windows side** (e.g. sync to a Windows folder and
  run there via `cmd.exe`), so an agent can start the real app without Sam doing anything.
- The installer is an NSIS **one-click, per-user** install (no admin prompt), with Start menu
  and desktop shortcuts.

### 6.2 Electron specifics
- YouTube embeds fail from `file://` origins: the renderer must be served from a proper origin
  (custom privileged protocol or a local http server) so the iframe API works. The built app's
  server is reached as `http://localhost:<port>` (a hostname referrer, which YouTube accepts) but
  binds to `127.0.0.1` only (v1.1).
- Local video/image/audio files are loaded through a custom protocol scoped to paths the user
  has added. No blanket `file://` access. Context isolation on, node integration off, a typed
  preload bridge.
- Background video must stay smooth: hardware decoding, and the background is paused while the
  window is minimised.
- The Content-Security-Policy allows images from YouTube thumbnails and Spotify art only:
  `i.ytimg.com`, `i.scdn.co`, `*.spotifycdn.com` and `mosaic.scdn.co` (the last two added for
  album and playlist covers, R40), plus the media protocol, `data:` and `blob:`.
- **Network calls** are made by the main process only: Spotify's Web API, and for the widgets
  `api.open-meteo.com` and `geocoding-api.open-meteo.com` (Weather) and the user's own `https`
  iCal addresses (Calendar). YouTube embeds and thumbnails load in the renderer.
- **Calendar addresses are secrets**: encrypted on this PC with Electron `safeStorage` like the
  Spotify tokens, never sent to the renderer, never logged and never exported. (Cached event
  titles do sit in the database, so they appear in its backups.)

### 6.3 Assets and licences
- Do not download or ship LifeAt's audio, video or images (their R2/Cloudflare URLs were seen
  during research; leave them alone). Bundled sounds and starter spaces are CC0 or
  similarly permissive, and the source and licence of each are recorded in `assets/CREDITS.md`.
- No "LifeAt" name or logo anywhere in the app.

### 6.4 Data
- Everything is stored in the app's data folder (`%APPDATA%/StudyAt`), in one database file
  plus settings.
- **Daily automatic backup** of the database (keep the last 14) and backup before any schema
  migration. Schema is versioned with migrations from day one (v2 added the Notes table; v3 added
  `task_id`/`task_text` on sessions and the `images` table). The `images/` folder of image-widget
  copies is not in the backups (their database rows are).
- The daily backup is taken at launch and again **whenever the date changes while the app keeps
  running** in the tray (checked hourly and on every resume and unlock); finished weeks' recaps
  are computed the same way.
- **Corrupt database:** the unreadable file is copied aside as `studyat.corrupt-<timestamp>.sqlite`
  (never deleted), the pending choice is saved, and a dialog offers "Restore latest backup"
  (default) or "Start fresh". It is asked again on every launch until Sam chooses. Only backups
  that open cleanly are offered.

## 7. Calls I made (Sam can override)

- Name **StudyAt** (the repo name) for the app.
- Day rollover at **04:00**, so studying past midnight counts for the evening it belongs to.
  Configurable.
- Local files referenced, not copied (§4.2).
- Spotify via the Web API + Spotify Connect, not in-app playback (§4.6).
- No manual time entry; sessions are editable and deletable (§5).
- Generated noise + CC0 loops instead of LifeAt's sounds (§6.3).
- Starter spaces and sounds bundled so first launch isn't empty.
- Windows notifications at segment end; launch-at-start-up off by default.
- Weeks Monday–Sunday.
- A Pomodoro interrupted by a crash is **not** resumed on relaunch; it is closed at its last
  checkpoint and the timer starts fresh.
- Idle "keep or discard" threshold 10 minutes, configurable.

## 8. Repo skill set (built first)

**Sequencing (Sam's decision):** the first plan covers **only this section** — the skill set,
`CLAUDE.md`, `check.sh`, the Windows run scripts and the planning docs (with this design
seeded as `appplan.md`). The app itself (§4–§6) is then planned using the new `study-plan`
skill and built with `study-plan-execute`.

Mirrors the layout of Sam's Stitched Off repos (`~/dev/StitchTracker`,
`~/dev/StitchTrackerWebsite`): skills and agents live **in this repo** under `.claude/`.

- `CLAUDE.md` — what the app is, where things live, the gates, pointers to the skills.
- `.claude/skills/study-dev/` — root router + repo rules (the non-negotiables: focus-only
  accounting, no data loss, no native modules, no LifeAt assets, Windows-side run scripts,
  British English copy) and `agent-contract.md` (gates, report shape, budget) for subagents.
- `.claude/skills/study-plan/` — idea → spec → plan for this repo (replaces superpowers
  brainstorming/writing-plans inside this repo, like `stitch-plan`).
- `.claude/skills/study-plan-execute/` — executes an approved plan task by task, dispatching
  agents, running gates, and keeping a ledger in `.claude/ledger/`.
- `.claude/agents/`: `study-core` (timer, accounting, storage, stats maths), `study-ui` (React
  components, widgets, layout, charts), `study-media` (spaces, video, sounds, Spotify),
  `study-review` (read-only reviewer).
- `docs/planning/`: `appplan.md` (what the app does: this design, kept current) and
  `roadmap.md` (what's built, what's next).
- `check.sh` — the single gate: typecheck, lint, unit tests.

## 9. Left to the builder

- React state/store library, charting library, drag implementation, build tooling
  (electron-vite / electron-builder or similar), styling approach. Keep the stack small.
- Storage engine, provided it's non-native and transactional (e.g. SQLite via WASM persisted to
  disk, with atomic file writes).
- Visual design: dark, calm, LifeAt-like feel (frosted dark panels over the video, rounded
  corners, soft type). Not a copy of LifeAt's exact look. (Settled in the build: the macOS /
  Liquid Glass look in §4.10.)
- Which CC0 sources to use for sounds and starter spaces.
- Test approach: unit tests for accounting/streak/stats maths are required (with fixed clocks,
  rollover and DST edge cases); a smoke test that the packaged app launches is wanted.

## 10. Done means

- Sam can install/launch StudyAt on Windows, pick or add a space, mix sounds, run Pomodoros
  tagged with a subject, and see those minutes in today's total, the streak, the heatmap, weekly
  and per-subject charts, and get a recap at the week's start.
- Killing the app mid-Pomodoro loses ≤ 15 s of recorded focus.
- Spotify widget controls their playback after the one-time setup.
- `./check.sh` passes; the repo skill set exists and routes correctly.
