# StudyAt — roadmap

> What to build next and what is done. New work goes here first (via `study-plan`). Sam's edits
> win. Statuses: *idea* · *planned* (plan approved) · *in progress* · *done*.

## Where we are

The repo skill set (P0) is in place on `feat/design`. Next: plan P1 with `study-plan`.

## Up next

P1, then P2. P1–P3 together make the first version Sam can use every day (timer + honest
stats); P4–P5 bring back the atmosphere; P6–P8 round it off.

## Rows

| Row | What | appplan | Status | Spec / plan / notes |
| --- | --- | --- | --- | --- |
| P0 | Repo skill set: `study-dev`, `study-plan`, `study-plan-execute`, five agents, `check.sh`, Windows run scripts, planning docs | §8 | done (pending merge) | `docs/superpowers/plans/2026-11-08-studyat-skill-set.md`; branch `feat/design` |
| P1 | App scaffold: Electron + React + TS (no native modules), secure preload bridge, served origin, lint/typecheck/Vitest wired into `check.sh`, Windows dev run + installer build, tray + close-to-tray + single instance, dock and floating-widget shell with persisted positions, auto-hide | §4.1, §4.4 (tray), §6 | idea | |
| P2 | Timer + accounting: main-process Pomodoro state machine, short/long breaks, auto-start toggles, subjects, suspend/lock auto-pause, idle keep-or-discard, 15 s checkpoints, crash recovery, storage + migrations + daily backups, chimes (separate focus/break chimes, ≥5 bundled, custom file, preview, volume, repeat, 1-min tick), notifications | §4.4, §5, §6.4 | idea | |
| P3 | Stats: header tiles, streak (≥25 min, 04:00 rollover), 12-month heatmap, week chart stacked by subject, 12-week trend, by-subject view, sessions list with edit/delete, weekly recap pop-up + archive | §4.7, §4.8, §5 | idea | |
| P4 | Spaces: library with tabs/search/favourites, add local video/image (referenced, relocate state) and YouTube, thumbnails, per-space audio/speed/dim/blur, starter spaces + credits, restore last space | §4.2, §6.2, §6.3 | idea | |
| P5 | Soundboard: master + space audio, generated white/pink/brown noise, bundled CC0 loops, custom sounds, saved mixes, restore mix | §4.3, §6.3 | idea | |
| P6 | Tasks widget: sticky notes, colours, tick off, reorder, done section | §4.5 | idea | |
| P7 | Spotify widget: PKCE setup flow with instructions, now playing, controls, playlists, devices | §4.6 | idea | |
| P8 | Settings + data: all settings, export JSON/CSV, restore from backup, launch at start-up, packaged installer polish | §4.9, §6.4 | idea | |
