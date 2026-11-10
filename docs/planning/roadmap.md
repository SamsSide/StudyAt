# StudyAt — roadmap

> What to build next and what is done. New work goes here first (via `study-plan`). Sam's edits
> win. Statuses: *idea* · *planned* (plan approved) · *in progress* · *done*.

## Where we are

P0–P8 and the widgets addendum (W) are done and released as **v1.0.0** on GitHub
(`SamsSide/StudyAt`, `origin`), with the Windows installer attached to the release.

**V1.1 polish is done and merged to `main`** (version 1.1.0). It adds:
- an away-prompt off switch and a Countdown mode;
- a task on the timer, with By task stats;
- focus view (`H`) and proportional, resizable widgets;
- image and GIF widgets;
- a pop-out Spotify widget and the YouTube embed fix.

Every task was reviewed, `./check.sh` is green (1160 tests) and 29/29 e2e tests pass on Windows.
The build record is `docs/planning/plans/2026-11-09-v1-1-polish-verification.md`. The 1.1.0
installer is built in `C:\Users\samue\Downloads\StudyAt-1.1.0\` but **not yet released on
GitHub**: Sam reviews it first.

## Up next

1. **Sam's v1.1 hand-walk and look calls** (verification record §5, §6), then publish the
   v1.1.0 GitHub release with the installer attached, if it holds up.
2. The v1.0 hand-walk items below, if not done yet:
   - pick and add spaces (one of your videos, a YouTube link);
   - mix rain + brown noise and save it;
   - run a Pomodoro tagged COMP2261 and listen to both chimes;
   - lock the PC mid-focus;
   - close the window (mini timer, Ctrl+Alt+P);
   - Stats; Spotify; tasks; Calendar (Google iCal secret address); Weather (your town);
     Notes and Quote; the glass look (`tokens.css`).
3. Fix what the hand-walk turns up, as new rows here.
4. Ship fixes as new releases (bump `package.json`, `npm run dist` on Windows, tag `vX.Y.Z`).

## Rows

| Row | What | appplan | Status | Spec / plan / notes |
| --- | --- | --- | --- | --- |
| P0 | Repo skill set: `study-dev`, `study-plan`, `study-plan-execute`, five agents, `check.sh`, Windows run scripts, planning docs | §8 | done | `docs/superpowers/plans/2026-11-08-studyat-skill-set.md`; branch `feat/design` |
| P1 | App scaffold: Electron + React + TS (no native modules), secure preload bridge, served origin, lint/typecheck/Vitest wired into `check.sh`, Windows dev run + installer build, tray + close-to-tray + single instance, dock and floating-widget shell with persisted positions, auto-hide | §4.1, §4.4 (tray), §6 | done (v1.0.0) | spec `docs/planning/specs/2026-11-08-app-v1-design.md`, plan `docs/planning/plans/2026-11-08-app-v1.md` (one plan for P1–P8), verification `docs/planning/plans/2026-11-08-app-v1-verification.md`, branch `feat/app-v1` |
| P2 | Timer + accounting: main-process Pomodoro state machine, short/long breaks, auto-start toggles, subjects, suspend/lock auto-pause, idle keep-or-discard, 15 s checkpoints, crash recovery, storage + migrations + daily backups, chimes (separate focus/break chimes, ≥5 bundled, custom file, preview, volume, repeat, 1-min tick), notifications | §4.4, §5, §6.4 | done (v1.0.0) | as P1 |
| P3 | Stats: header tiles, streak (≥25 min, 04:00 rollover), 12-month heatmap, week chart stacked by subject, 12-week trend, by-subject view, sessions list with edit/delete, weekly recap pop-up + archive | §4.7, §4.8, §5 | done (v1.0.0) | as P1 |
| P4 | Spaces: library with tabs/search/favourites, add local video/image (referenced, relocate state) and YouTube, thumbnails, per-space audio/speed/dim/blur, starter spaces + credits, restore last space | §4.2, §6.2, §6.3 | done (v1.0.0) | as P1 |
| P5 | Soundboard: master + space audio, generated white/pink/brown noise, bundled CC0 loops, custom sounds, saved mixes, restore mix | §4.3, §6.3 | done (v1.0.0) | as P1 |
| P6 | Tasks widget: sticky notes, colours, tick off, reorder, done section | §4.5 | done (v1.0.0) | as P1 |
| P7 | Spotify widget: PKCE setup flow with instructions, now playing, controls, playlists, devices | §4.6 | done (v1.0.0) | as P1 |
| P8 | Settings + data: all settings, export JSON/CSV, restore from backup, launch at start-up, packaged installer polish | §4.9, §6.4 | done (v1.0.0) | as P1 |
| W | Widgets addendum: dock Widgets popover, Calendar (read-only, Google iCal secret address, encrypted), Weather (Open-Meteo), Quote (public-domain, one per day), Notes (autosaving sticky notes, migration v2) | §4.10, §6.2, §6.4 | done (v1.0.0) | addendum `docs/planning/specs/2026-11-09-widgets-addendum.md` (Sam's request, 2026-11-09), built in the P1–P8 plan's run; verification as P1; branch `feat/app-v1` |
| V1.1 | v1.1 polish (Sam, 2026-11-09): away-prompt off switch, Countdown mode, task on the timer + By task stats, focus view (`H`), proportional and resizable widgets, image/GIF widgets (file or link, bare mode), pop-out Spotify widget, YouTube embed fix | §4.1, §4.2, §4.4, §4.6, §4.7, §4.10, §5 | done (1.1.0, merged; GitHub release pending Sam's review) | spec `docs/planning/specs/2026-11-09-v1-1-polish-design.md`, plan `docs/planning/plans/2026-11-09-v1-1-polish.md`, verification `docs/planning/plans/2026-11-09-v1-1-polish-verification.md`; commits f4d8dc6…6aee436 on branch `feat/v1-1-polish` |
