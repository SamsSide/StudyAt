# StudyAt — roadmap

> What to build next and what is done. New work goes here first (via `study-plan`). Sam's edits
> win. Statuses: *idea* · *planned* (plan approved) · *in progress* · *done*.

## Where we are

P0 (skill set) is merged to `main`. P1–P8 and the widgets addendum (W) are built on `feat/app-v1`
(worktree `.claude/worktrees/feat-app-v1`): the whole app, plus the Calendar, Weather, Quote and
Notes widgets Sam asked for on 2026-11-09. Every task was reviewed and `./check.sh` is green. The
build record is in `docs/planning/plans/2026-11-08-app-v1-verification.md`.

The build merges `feat/app-v1` into local `main` and installs StudyAt on Windows; there is no git
remote yet, so nothing is pushed.

## Up next

1. **Sam's hand-walk** (spec §10): run `scripts/win.sh npm run dev` or the installed StudyAt; pick
   and add spaces (one of your videos, a YouTube link); mix rain + brown noise and save it; run a
   Pomodoro tagged COMP2261 and listen to both chimes; lock the PC mid-focus; close the window
   (mini timer, Ctrl+Alt+P); open Stats; set up Spotify; add and tick a few tasks. Then also:
   - **Calendar**: paste your Google Calendar "Secret address in iCal format" in Settings →
     Calendar and check today's events.
   - **Weather**: choose your town in Settings → Weather.
   - **Notes** and **Quote**: write a note, relaunch, check it's still there; try "Another".
   - **The look**: judge the glass (tint, text, layout); the tint is tunable in `tokens.css`.
   - Read the rulings made while you were asleep (verification record), especially the
     accounting ones (R39) and the glass tint (R35, R36, R41).
2. Fix what the hand-walk turns up, as new rows here.
3. **Push** to a remote whenever Sam sets one up.

## Rows

| Row | What | appplan | Status | Spec / plan / notes |
| --- | --- | --- | --- | --- |
| P0 | Repo skill set: `study-dev`, `study-plan`, `study-plan-execute`, five agents, `check.sh`, Windows run scripts, planning docs | §8 | done | `docs/superpowers/plans/2026-11-08-studyat-skill-set.md`; branch `feat/design` |
| P1 | App scaffold: Electron + React + TS (no native modules), secure preload bridge, served origin, lint/typecheck/Vitest wired into `check.sh`, Windows dev run + installer build, tray + close-to-tray + single instance, dock and floating-widget shell with persisted positions, auto-hide | §4.1, §4.4 (tray), §6 | done (pending merge) | spec `docs/planning/specs/2026-11-08-app-v1-design.md`, plan `docs/planning/plans/2026-11-08-app-v1.md` (one plan for P1–P8), verification `docs/planning/plans/2026-11-08-app-v1-verification.md`, branch `feat/app-v1` |
| P2 | Timer + accounting: main-process Pomodoro state machine, short/long breaks, auto-start toggles, subjects, suspend/lock auto-pause, idle keep-or-discard, 15 s checkpoints, crash recovery, storage + migrations + daily backups, chimes (separate focus/break chimes, ≥5 bundled, custom file, preview, volume, repeat, 1-min tick), notifications | §4.4, §5, §6.4 | done (pending merge) | as P1 |
| P3 | Stats: header tiles, streak (≥25 min, 04:00 rollover), 12-month heatmap, week chart stacked by subject, 12-week trend, by-subject view, sessions list with edit/delete, weekly recap pop-up + archive | §4.7, §4.8, §5 | done (pending merge) | as P1 |
| P4 | Spaces: library with tabs/search/favourites, add local video/image (referenced, relocate state) and YouTube, thumbnails, per-space audio/speed/dim/blur, starter spaces + credits, restore last space | §4.2, §6.2, §6.3 | done (pending merge) | as P1 |
| P5 | Soundboard: master + space audio, generated white/pink/brown noise, bundled CC0 loops, custom sounds, saved mixes, restore mix | §4.3, §6.3 | done (pending merge) | as P1 |
| P6 | Tasks widget: sticky notes, colours, tick off, reorder, done section | §4.5 | done (pending merge) | as P1 |
| P7 | Spotify widget: PKCE setup flow with instructions, now playing, controls, playlists, devices | §4.6 | done (pending merge) | as P1 |
| P8 | Settings + data: all settings, export JSON/CSV, restore from backup, launch at start-up, packaged installer polish | §4.9, §6.4 | done (pending merge) | as P1 |
| W | Widgets addendum: dock Widgets popover, Calendar (read-only, Google iCal secret address, encrypted), Weather (Open-Meteo), Quote (public-domain, one per day), Notes (autosaving sticky notes, migration v2) | §4.10, §6.2, §6.4 | done (pending merge) | addendum `docs/planning/specs/2026-11-09-widgets-addendum.md` (Sam's request, 2026-11-09), built in the P1–P8 plan's run; verification as P1; branch `feat/app-v1` |
