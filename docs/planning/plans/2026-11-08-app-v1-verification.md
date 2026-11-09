# StudyAt v1 — verification record

Plan: [2026-11-08-app-v1.md](2026-11-08-app-v1.md) · Spec:
[2026-11-08-app-v1-design.md](../specs/2026-11-08-app-v1-design.md) · Addendum:
[2026-11-09-widgets-addendum.md](../specs/2026-11-09-widgets-addendum.md) · Branch `feat/app-v1`,
verified at **25fd128** (67 commits on `main`, not merged yet, nothing pushed).

Short version: every automated gate is green, all 18 end-to-end tests pass on Windows, and the
installer is in your Downloads folder. What's left is your hand-walk (§6) and a read of the
overnight decisions (§5).

## 1. How the gates were run

| Gate | Where | Result at 25fd128 |
| --- | --- | --- |
| `./check.sh`: agent roster, typecheck (incl. `tsconfig.e2e.json`), lint, unit and component tests | WSL | **green**: 77 test files, **982 tests** passed |
| `scripts/win.sh npm ci` | Windows | exit 0 |
| `scripts/win.sh npm run build` | Windows | exit 0 |
| `scripts/win.sh npx playwright test` | Windows, throwaway `STUDYAT_USER_DATA` per test | **18 passed (7.6 m)** |
| `scripts/win.sh npm run dist` | Windows | exit 0: one-click, per-user NSIS installer |

**Installer:** `StudyAt Setup 0.1.0.exe`, 142,823,617 bytes, sha256
`08efe3f4f508a579fc34b5b5e619cb07abb6fc9ed9f6e22761bd737d6c77f155`, copied to
`C:\Users\samue\Downloads\`. It has not been run; installing it is up to you.

Screenshots (27) from the final e2e run are in `C:\Users\samue\studyat-shots\final-2\`.

Notes on the run:

- Task 19's first run (18/18) was built from an older tree because other fixes landed during it.
  Ruling R42 reran e2e and `dist` on 25fd128 and replaced the installer; the numbers above are
  from that rerun.
- Two extra checks ran as a one-off spec that was not committed: YouTube plays under the new
  permission handlers (the video's `currentTime` advanced 1.6 s → 5.6 s over 4 s), and the keyboard
  focus ring shows in the production build (`timer-start-focus-ring.png`).
- The away prompt was not captured on screen: it needs two minutes of real Windows idle. It is
  covered by unit tests and by hand-walk step 5.

## 2. Acceptance criteria → evidence

Screenshot names are files in `C:\Users\samue\studyat-shots\final-2\`.

| # | Criterion (spec §9) | Evidence | Status |
| --- | --- | --- | --- |
| 1 | `./check.sh` green | 77 files / 982 tests, green at 25fd128 | met |
| 2 | Accounting rules §3.4.1–10 unit-tested with an injected clock | `src/core/timer/machine.test.ts`; `src/main/timer/controller.test.ts` (away prompt and discard, discard after the segment ended, sleep gap, quit with an unanswered prompt (A1), crash during away (R39), rule 6 one-minute deletion); `idle.test.ts`, `power.test.ts` | met |
| 3 | Day key, streak 24:59 vs 25:00, goal, heatmap, week/trend/subject totals, recap incl. DST and rollover | `src/core/time.test.ts` ("03:59 belongs to previous day with rollover 4", DST arithmetic); `src/core/stats/stats.test.ts` ("streak counts 25:00 but not 24:59", heatmap, weekBars and trend, bySubject, recap) | met |
| 4 | Migration with pre-migration backup; daily rotation keeps 14; corrupt file set aside | `migrations.test.ts`; `backup.test.ts` ("dailyBackup keeps newest 14"); `db.test.ts`, `corrupt.test.ts`; e2e `migration.spec.ts`, `corrupt.spec.ts` | met (corrupt file is now copied aside, not renamed; spec §3.3 updated) |
| 5 | Media protocol: registered ids only, Range, paths with spaces | `src/main/protocol.test.ts` ("404 for unknown id", "206 with Content-Range…", "serves path with spaces and accents") | met |
| 6 | Launches on Windows with a throwaway data dir: first space, timer, six subjects | e2e `launch.spec.ts`; `main-view-first-launch.png`, `subject-picker.png` | met |
| 7 | 70 s focus run records a row with subject and day key; today ≥ 1 min | e2e `timer.spec.ts`; `timer-running.png` | met |
| 8 | Kill mid-focus; relaunch closes the row at its checkpoint | e2e `crash.spec.ts` (runs 80 s so the row survives the one-minute rule); also `quit.spec.ts` | met |
| 9 | Close hides to tray, timer keeps running, mini timer shows | e2e `tray.spec.ts`; `mini-window.png` | met |
| 10 | Stats overlay with seeded data | e2e `stats.spec.ts` (8 seeded weeks); `stats-seeded.png` | met |
| 11 | Local image and YouTube URL become spaces and switch the background | e2e `spaces.spec.ts`; `spaces-panel-own-image.png`, `youtube-playing.png` | met |
| 12 | Channel volume persists across relaunch | e2e `sounds.spec.ts`; `sounds-panel.png` | met |
| 13 | Tasks: add, tick, reorder, clear done persist | `TasksWidget.test.tsx`; e2e `tasks.spec.ts`; `tasks.png` | met |
| 14 | Spotify: PKCE URL, callback, refresh, every widget state | `src/main/spotify/auth.test.ts`, `api.test.ts`, `listener.test.ts`, `src/renderer/spotify/SpotifyWidget.test.tsx`; `widget-spotify.png` | met (mocked); your account → hand-walk |
| 15 | Keyboard shortcuts and global hotkey toggle the timer | `Shell.test.tsx`, `Timer.test.tsx`, `hotkey.test.ts`; e2e `shortcuts.spec.ts` (Ctrl+Alt+P pressed as real Windows input) | met |
| 16 | Weekly recap pops up once for last week | e2e `recap.spec.ts`; `recap-popup.png` | met |
| 17 | `npm run dist` produces the installer | `StudyAt Setup 0.1.0.exe`, see §1 | met |
| 18 | Every asset credited; no LifeAt anywhere in `src/` or `assets/` | both grep checks in `check.sh` | met |
| 19 | Calm and polished; Spotify with your account; chimes sound nice | screenshots above | **your hand-walk** |

| Addendum §6 item | Evidence | Status |
| --- | --- | --- |
| ICS parsing: weekly RRULE with EXDATE, all-day, time-zoned event; agenda window | `src/main/services/calendar.test.ts` ("expands recurrences, overrides, exclusions and all-day events…", "reads a summer (BST) event in its own zone", agendaWindow) | met |
| Weather WMO-code mapping; geocoding parse | `src/shared/weather.test.ts`; `src/main/services/weather.test.ts` (searchPlaces, report) | met |
| IPC validation | `src/main/ipc.test.ts` (weather, calendar addresses, notes 5 000-char limit) | met |
| Quote of the day stable per day key, moves on next day | `src/renderer/quote/QuoteWidget.test.tsx` | met |
| Widgets toggle from the popover | `Shell.test.tsx` ("Widgets popover"); e2e `widgets.spec.ts`; `widgets-popover.png` | met |
| States render their copy | `CalendarWidget.test.tsx`, `WeatherWidget.test.tsx`, `NotesWidget.test.tsx`, `QuoteWidget.test.tsx` | met |
| Real-app screenshots of the widgets | `all-seven-widgets.png`, `widget-calendar.png`, `widget-weather.png` (live Open-Meteo: London), `widget-quote.png`, `widget-notes.png`, `settings-calendar.png`, `settings-weather.png` | met; your Google calendar → hand-walk |
| Notes persist (addendum §4b) | e2e `widgets.spec.ts` ("a note persists across a relaunch"); `notes.test.ts`, migration v2 | met |

## 3. Reviews

Every build task went to a `study-review` reviewer (or, where noted, into the final review).
A fix round is one return to the builder followed by a re-review.

| Task | Fix rounds | Task | Fix rounds |
| --- | --- | --- | --- |
| 0 Assets | 0 | 11 Timer UI, mini timer | 2 |
| 1 Scaffold, contract | 1 | 12 Spaces | 1 |
| 2 Storage, backups | 1 | 13 Windows, tray, hotkey | 1 |
| 3 Stats maths | 0 | 14 Stats overlay | 1 |
| 4 Timer machine | 0 | 15 Spotify widget | 2 |
| 5 Media protocol | 1 | 16 Settings | 1 |
| 6 Spotify auth | 1 | 17 Tasks | 1 |
| 7 Timer controller | 2 | 18 App wiring | in final review (R31) |
| 8 Shell | 0 | 19 e2e and installer | proved by its own run, rerun at 25fd128 (R42) |
| 9 Sounds | 1 | 10 IPC, bootstrap | 2 (round 2 accepted on R30) |

| Extra work | Fix rounds |
| --- | --- |
| Data-safety hardening | 1 |
| Notes storage (migration v2) | 0 |
| W1 weather + calendar services | 1 |
| W2 widget IPC and settings | 0 |
| W3a Calendar + Weather UI | 1 (accepted on R30) |
| W3b Quote + Notes UI | 2 |
| Quotes asset, main cleanups, polish P1/P2 and round 2 | in final review (R30) |

**Final whole-branch review** (R37: three parallel reviewers, at c185db0):

| Part | Scope | Found | Fix rounds | Outcome |
| --- | --- | --- | --- | --- |
| A | main, core, shared, packaging | 1 Important (backups only at launch), 7 Minor | 2 (e83c19a, bc31270) | APPROVE |
| B | renderer shell, timer, stats, settings | 2 Important (focus rings hidden, raw error text), 7 Minor | 1 (2a5ff97) + cleanup efe4af2 | closed |
| C | renderer media, widgets, assets | 1 Important (polling while hidden in tray), 9 Minor | 1 (b508f2f) + cleanup efe4af2 | closed |

## 4. Rulings and your decisions

### Your decisions and requests

- **A1 (2026-11-08)** quit while away or with the prompt open → discard — honesty default.
- **A2 (2026-11-08)** the away prompt's minutes = focus time at stake, not real absence — what
  you'd actually lose.
- **A3 (2026-11-08)** a subject change after rollover credits the whole pomodoro to its start day
  — one pomodoro, one day.
- **A4 (2026-11-08)** a gap over 30 s between ticks while running = sleep, never counted — the PC
  wasn't studying.
- **Progress screenshots** — sent after each visual milestone (R5).
- **"Feels well built and professional"** — shell minors fixed, not deferred, plus a dedicated
  polish pass from real screenshots (R21).
- **"Native Apple / Liquid Glass, a bit like a Mac"** — whole-app visual direction (R27).
- **Calendar, Weather and Quote widgets** — addendum spec (R33).
- **Notes widget that saves** — addendum §4b (R34).
- **No questions overnight** — from then on every decision was a ledgered ruling; accounting
  questions took the least-time-counted default and are listed in §5.

### Rulings R1–R42

- **R1** SoundsPanel takes an optional `spaceAudio` prop — keeps Tasks 9 and 12 independent.
- **R2** Task 0 tools (ffmpeg etc.) only in the scratch dir — tools, not app dependencies.
- **R3** chime tests use a small pure-TS fake offline audio context — no native audio packages;
  the real sound is your call.
- **R4** model tiers: Opus for accounting, storage, layout; Sonnet elsewhere — effort where risk is.
- **R5** a Windows screenshot run after each visual batch — your request.
- **R6** Task 1 fix covers CSP scope, settings patch type, token privacy, custom chime ids — later
  tasks build on them.
- **R7** Tasks 3, 4, 6 start alongside the Task 1 fix — they don't touch that surface.
- **R8** the controller ticks at `now` before every other event — a segment that ran out between
  ticks ends properly.
- **R9** "give back" only when the away time fell in the still-running segment, else the discard
  goes to the finished row — honest totals.
- **R10** skip/reset → idle, no chime, no auto-start — predictable.
- **R11** media protocol allows CORS for the app's own origin only — thumbnails and audio need it.
- **R12** dependency-driven scheduling (up to 5 agents) instead of strict batches — faster, same
  safety.
- **R13** Task 7 starts before Task 2's review returns — critical path; repo API was stable.
- **R14** every renderer task styles its own components with a CSS module over `tokens.css` —
  no unstyled widgets.
- **R15** `SpacePatch` gains `thumb` — thumbnails survive a save.
- **R16** keep the fresh DB after corruption, skip that day's backup, offer the latest backup
  before the corruption — a broken file never becomes "latest".
- **R17** first seed writes the timer and goal defaults explicitly — a future default change
  can't silently alter your settings.
- **R18** a newer-schema file stops with a dialog and writes nothing — protects data from an
  older build.
- **R19** `sounds.relocate(id)` keeps a sound's id and mixes — relocating shouldn't break mixes.
- **R20** default widget spots moved clear of the dock — Spotify sat under it.
- **R21** polish pass from real screenshots of every view — your "professional" request.
- **R22** Prettier added (single quotes, width 110), one formatting commit — consistent source.
- **R23** a window-visibility store pauses the background when hidden — no video in the tray.
- **R24** main pushes mini-timer and visibility events — the shell stays in sync.
- **R25** main refuses edits to running rows and recomputes the stored recap of an edited week —
  stats stay honest.
- **R26** no synchronous blocking work in main while the timer can run — the timer never stalls.
- **R27** macOS / Liquid Glass look: translucent glass, larger radii, capsule buttons, system
  font stack, no Apple assets, WCAG AA kept — your request; supersedes spec §4's radii and blur.
- **R28** global 1/2/3 keys keep switching mode — deliberate keys from spec §3.7.
- **R29** restore asks once (main's native dialog) — two confirmations was clumsy.
- **R30** a small reviewer-specified fix with a fail-first test is accepted without a separate
  re-review; the final review re-checks — saves a round on narrow changes.
- **R31** Task 18 (wiring, done by the dispatcher) reviewed in the final review — small task.
- **R32** an unresolved corrupt database is remembered in `meta` across a relaunch — you always
  get the choice.
- **R33** widgets: Google Calendar via the private iCal address (read-only, stored encrypted),
  Open-Meteo weather (no key), bundled public-domain quotes, one "Widgets" dock item — no
  accounts, no keys.
- **R34** Notes: autosaving sticky notes in a new `notes` table via migration v2 — your request;
  also exercises the migration backup path.
- **R35** glass lightened one step — the first version was too dark.
- **R36** keep the lighter glass with lifted text colours and the three-column widget layout —
  readable over bright spaces.
- **R37** final review split three ways — the diff was too large for one reviewer.
- **R38** user-facing errors are a fixed plain sentence; the technical reason goes to the
  console (except the hotkey and Spotify port messages) — calm copy.
- **R39** a crash or power cut during an unanswered away period discards the away time — follows
  A1.
- **R40** CSP `img-src` allows Spotify's artwork hosts — album art was blocked.
- **R41** glass tint .68/.64 for a clear three-step text hierarchy, AA verified — readability.
- **R42** rerun e2e and `dist` on the final HEAD and replace the installer — the first run was
  built from an older tree.

## 5. For Sam to read

Decisions made overnight that you may want to change:

| Item | What was decided | Where to change it |
| --- | --- | --- |
| **R39** crash during away | A crash while the away prompt is unanswered discards only the away time; focus before and after it counts. | Timer controller; reversible. |
| **R35 / R36 / R41** glass look | Lighter glass, tint .68/.64, three text tiers, all AA. | `src/renderer/styles/tokens.css` (tint and text colours). |
| **R40** CSP hosts | `img-src` adds `https://*.spotifycdn.com` and `https://mosaic.scdn.co`. | CSP in main; spec and appplan note it. |
| **R27** overall look | Mac / Liquid Glass across the app. | Judge it in the hand-walk. |
| Calendar data in backups | Event titles and locations sit in the calendar cache, so they are inside your local daily backups. The iCal address itself is stored encrypted. | Nothing leaves the PC. |

**Known limits:**

- A calendar feed with invalid RRULE syntax can't be parsed, so that calendar shows its last
  good copy (stale).
- YouTube's own title text (and a white bar) shows briefly while a video starts
  (`youtube-playing.png`).
- Widgets saved in old positions (before 7bb4aee) stay on screen after the clamp but can
  overlap; Notes can cover Spotify's title bar (`old-widget-spots-clamped.png`). Dragging fixes it.
- Windows can't fsync a directory, so a power cut in the instant after a backup rename is not
  fully guarded. Files themselves are fsynced.
- A Tasks edit is lost if its save fails after the widget has closed. (Notes retry; Tasks don't.)

## 6. Your hand-walk

**Launching:** run `StudyAt Setup 0.1.0.exe` from Downloads (one click, installs for you only),
then open **StudyAt** from the Start menu or desktop. Or run `scripts/win.sh npm run dev` from WSL.

Spec §10:

1. Launch (above).
2. Pick a space; add one of your own videos and a YouTube link.
3. Mix rain + brown noise; save it as a mix.
4. Pick "COMP2261 Artificial Intelligence", start a Pomodoro; let it chime; check the break chime.
5. Lock your PC for a minute mid-focus → it should be paused when you return.
6. Close the window → the mini timer shows; Ctrl+Alt+P pauses from another app.
7. Open Stats: today, streak, heatmap, week bars coloured by subject.
8. Set up Spotify (Settings → Spotify), play a playlist from the widget.
9. Add a few sticky-note tasks, tick one off.

Added for the widgets and the look:

10. **Calendar:** Google Calendar → Settings → your calendar → "Secret address in iCal format";
    paste it into StudyAt Settings → Calendar; check today's events.
11. **Weather:** Settings → Weather, search your town, pick it; check the widget.
12. **Notes:** write a note, quit StudyAt from the tray, relaunch; the note is still there.
13. **Quote:** open it from the Widgets dock item; it changes daily.
14. **Glass look:** judge the glass over a bright and a dark space; tell me if the tint or text
    should change (`tokens.css`).
15. Tell me what looks or feels off.
