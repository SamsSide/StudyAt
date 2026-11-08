# StudyAt — appplan

> The living description of what StudyAt does. Code, specs and plans cite it as "appplan §N".
> Seeded on 2026-11-08 from the approved design
> (`docs/superpowers/specs/2026-11-08-studyat-design.md`); section numbers are kept identical.
> When a spec changes how the app works, its plan's last task updates the section here.

## Feature status

| Feature | appplan | Roadmap | Status |
| --- | --- | --- | --- |
| Repo skill set, gates, Windows scripts | §8 | P0 | built |
| App scaffold, Windows run, tray, single instance | §4.1, §4.4, §6 | P1 | planned |
| Timer, chimes, focus accounting, storage, backups | §4.4, §5, §6.4 | P2 | planned |
| Stats, streak, heatmap, weekly recap | §4.7, §4.8, §5 | P3 | planned |
| Spaces | §4.2 | P4 | planned |
| Soundboard | §4.3 | P5 | planned |
| Tasks widget | §4.5 | P6 | planned |
| Spotify widget | §4.6 | P7 | planned |
| Settings, export/restore, packaging polish | §4.9, §6.4 | P8 | planned |

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
- Spotify widget (they have Premium): now playing, play/pause/next/previous, pick a playlist.
- Free-floating draggable widgets over the space, like LifeAt.

**Non-goals** (LifeAt features deliberately left out)
- Rooms, invites, chat, co-working, group timers, accounts, cloud sync.
- LifeAt's calendar/daily planner, task-to-calendar, Fortune, Breathe.
- Mobile, macOS, multi-user.
- Importing LifeAt history (Sam declined; the app starts from zero).

**Anti-goals** (failure even if it "works")
- **Losing study data** — a crash, quit or power cut mid-session must not lose recorded minutes,
  and there must be a backup.
- **Inflated numbers** — idle, breaks, or the app merely being open must never count as study.
- Needing the internet to track time. Only YouTube spaces and Spotify may need a connection.
- A laggy or battery-hungry background that makes them go back to LifeAt.
- Copying LifeAt's brand, name, logos or media files. The *ideas* and layout are fine; their
  audio/video assets are not (see §6.3).

## 3. Decisions Sam made

| Topic | Decision |
| --- | --- |
| Platform | **Electron + React + TypeScript**, running as a normal Windows app |
| What counts as study | **Only time the focus (Pomodoro) timer is running.** Breaks, pauses, idle and app-open time never count |
| Subjects | **Optional subject tag** per focus session; stats break down by subject |
| Streak rule | A day counts if it has **≥ 25 minutes of focus** (one full Pomodoro's worth) |
| Weekly recap | **Pop-up card on first open of a new week**, past recaps browsable in Stats |
| Widget layout | **Free-floating, draggable**, opened from a side dock, positions remembered |
| Spotify | They have **Premium** → full widget (now-playing, controls, playlists) via a one-time Spotify developer app setup |
| Repo tooling | A repo skill set **first**, mirroring their Stitched Off repos (§8), then the app |

## 4. The app, screen by screen

### 4.1 Main view (the "space")
- Full-window background: the active space (video loops muted by default, or a still image).
- **Left dock** (icons + labels, like LifeAt): Spaces, Sounds, Timer, Tasks, Spotify, Stats,
  Settings. Spaces and Sounds open as a side panel; Timer, Tasks and Spotify toggle floating
  widgets; Stats opens a full-screen overlay.
- **Top bar**: current streak (🔥 n, click → Stats), today's focus total, fullscreen toggle.
- **Auto-hide**: after ~5 s without mouse movement the dock, top bar and panels fade out;
  widgets stay (each widget can be pinned or set to auto-hide). Moving the mouse brings it back.
- Widgets are draggable by their header, clamped to the window, positions/open state persisted
  per widget, and re-clamped when the window is resized.

### 4.2 Spaces
- Library grid with tabs: **All · Videos · Images · YouTube · Favourites**, a search box, and a
  heart on each card.
- **Add space**: pick a local video (mp4/webm/mov) or image (jpg/png/webp/gif), or paste a
  YouTube URL. A thumbnail is generated (a video frame, or YouTube's thumbnail). Name editable.
- Local files are **referenced by path, not copied** (4K loops are large). A missing file shows
  a "file moved — relocate" state rather than breaking.
- Per-space settings: play the space's own audio (on/off + volume, mainly for YouTube mixes),
  playback speed, dim overlay (0–60 %), blur.
- Ships with a handful of free-licence starter spaces so the first launch isn't empty.
- The last-used space is restored on launch.

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
- Modes: **Pomodoro · Short break · Long break**; defaults 25 / 5 / 15 min, long break after
  every 4 Pomodoros; all editable in the widget's settings.
- Big countdown, Start/Pause, Reset, Skip. Toggles: auto-start breaks, auto-start next
  Pomodoro.
- **Subject picker** on the widget (blank = untagged). Subjects are managed in Settings (name +
  colour). Changing the subject mid-session applies from that point on.
- **Chimes (Sam asked for these explicitly):** a sound plays at the end of every segment, with
  **separate chimes for "focus done → break" and "break done → back to focus"**. Choose each
  from a bundled set of at least 5 soft chimes (bell, wood block, singing bowl, digital beep,
  birdsong; free-licence), or **add your own sound file**. Each has a preview ▶ button, chime
  volume is separate from the soundboard, and a repeat count of 1–3. An optional gentle
  "1 minute left" tick and an optional sound when a Pomodoro starts are both off by default.
  Chimes play even when the window is hidden in the tray. A Windows notification fires as well.
- Timing is **timestamp-based**, so it stays correct when minimised or throttled.
- The window/taskbar title shows the remaining time while running.
- **Closing the window (Sam's decision) hides StudyAt to the system tray**; the timer keeps
  running and notifications still fire. The tray icon shows/hides the window, shows the
  remaining time in its tooltip, and has Pause/Resume and **Quit** (Quit ends any running
  session at that moment and saves it). Single-instance: launching again focuses the existing
  window. Background video is paused while hidden.

### 4.5 Tasks widget (sticky notes)
- Quick-add box; each task is a small sticky note with text, a tick-off checkbox and one of a
  few colours. Drag to reorder. Completed tasks collapse into a "Done" section that can be
  cleared. Persisted locally.

### 4.6 Spotify widget
- One-time setup in Settings: Sam creates a free app at developer.spotify.com, pastes its
  Client ID; the app signs in with **Authorization Code + PKCE** using a loopback redirect
  (`http://127.0.0.1:<port>/callback`). Tokens are stored locally and refreshed automatically.
  The settings page shows step-by-step instructions for this.
- Shows album art, track, artist and progress; play/pause, previous, next; a playlist picker
  from their library; a device picker.
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
- **Sessions list**: every focus session (date, start–end, minutes, subject), filterable.
  Sessions can be edited (subject, delete) to fix mistakes.
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

## 5. Study-time accounting (the core rule)

- A **focus session** is one Pomodoro segment. Only the seconds the Pomodoro countdown is
  actually running are recorded. Pause stops accrual. Breaks are never study time.
- A segment that is reset or skipped early still keeps the minutes it actually ran (they were
  studied); segments under 1 minute are discarded as noise.
- **Crash safety**: an in-progress session is written to the database when it starts and
  checkpointed every ~15 s, so a crash or power cut loses at most ~15 s. On next launch an
  orphaned in-progress session is closed at its last checkpoint.
- **Away time (Sam's decision):** a running Pomodoro **auto-pauses when the PC sleeps or the
  screen locks** (Electron `powerMonitor` suspend / lock-screen), with a notice on return. In
  addition, after **10 minutes with no keyboard/mouse input** (system idle time, threshold
  configurable), the next input brings up "You were away for N min — keep or discard that
  time?". Discard removes the idle stretch from the session. Because this needs power/idle
  events, the **timer and session writer live in the Electron main process**; the renderer only
  displays and sends commands.
- **Changing the subject mid-session** closes the current sub-segment and starts a new one with
  the new subject, so each minute is credited to the right subject (my call).
- A session is credited to the day it **started** on (with the rollover hour from §7). A
  session crossing midnight isn't split.
- **Streak**: the number of consecutive days, ending today or yesterday, each with ≥ threshold
  focus minutes. Today not yet reaching the threshold doesn't break the streak until the day ends.
- No manual "add time" entry (keeps numbers honest); editing existing sessions is allowed
  (§4.7).

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

### 6.2 Electron specifics
- YouTube embeds fail from `file://` origins: the renderer must be served from a proper origin
  (custom privileged protocol or a local http server) so the iframe API works.
- Local video/image/audio files are loaded through a custom protocol scoped to paths the user
  has added. No blanket `file://` access. Context isolation on, node integration off, a typed
  preload bridge.
- Background video must stay smooth: hardware decoding, and the background is paused while the
  window is minimised.

### 6.3 Assets and licences
- Do not download or ship LifeAt's audio, video or images (their R2/Cloudflare URLs were seen
  during research; leave them alone). Bundled sounds and starter spaces are CC0 or
  similarly permissive, and the source and licence of each are recorded in `assets/CREDITS.md`.
- No "LifeAt" name or logo anywhere in the app.

### 6.4 Data
- Everything is stored in the app's data folder (`%APPDATA%/StudyAt`), in one database file
  plus settings.
- **Daily automatic backup** of the database (keep the last 14) and backup before any schema
  migration. Schema is versioned with migrations from day one.

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
  corners, soft type). Not a copy of LifeAt's exact look.
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
