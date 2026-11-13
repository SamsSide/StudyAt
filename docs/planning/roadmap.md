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
The build record is `docs/planning/plans/2026-11-09-v1-1-polish-verification.md`. Released as
**v1.1.0** on GitHub (2026-11-10, tag `v1.1.0` at ef9030d), with `StudyAt-Setup-1.1.0.exe` attached.

**V1.2 is built on branch `worktree-feat-v1-2`, not merged or pushed** (commits `d3782a3..c1d0f0d`).
It adds a Tweek-style planner with a board (an Inbox and subject lists, drag and drop, repeat,
reminders, spaced revision), pop-out note stickies, YouTube quality with a live badge, a
background play/pause button and **V**, countdown pips, Deadlines and stats widgets, and session
intention and outcome. Schema v4. The Windows e2e suite passed except the global-hotkey test, which
fails only while Sam's own StudyAt holds Ctrl+Alt+P. Waiting for Sam's hand-walk.

A follow-up **Tweek board feel** pass is built on the same branch (commits `c1cc2ad..2341762`):
a task drags by its whole line, one click opens a small Tweek card (Expand for the full detail),
and a click on any blank board line types a task there. Recorded in the v1.2 verification record,
"Tweek board feel".

**Planned (2026-11-13): simple tasks replace the planner before merge.** Sam ruled the planner too
much: Tweek stays an external app, and StudyAt goes back to the v1.1 sticky-note Tasks widget (with
▶ to start focus). Migration v5 brings back the old stickies and the planner's tasks, and keeps the
planner tables as archives. Spec `docs/planning/specs/2026-11-13-simple-tasks-design.md`, plan
`docs/planning/plans/2026-11-13-simple-tasks.md`.

## Up next

1. **Build the simple-tasks plan** (`docs/planning/plans/2026-11-13-simple-tasks.md`), then Sam's
   v1.2 hand-walk (spec §10, minus the planner steps) and the simple-tasks hand-walk (its spec
   §10), then push and merge `worktree-feat-v1-2`. The Tweek board feel hand-walk is dropped.
2. Sam's v1.1 hand-walk and look calls (verification record §5, §6), if not done yet.
3. The v1.0 hand-walk items, if not done yet: spaces (one of your videos, a YouTube link), a rain
   and brown-noise mix, a Pomodoro tagged COMP2261 with both chimes, locking the PC mid-focus,
   closing the window (mini timer, Ctrl+Alt+P), Stats, Spotify, Calendar, Weather, the glass look.
4. Fix what the hand-walks turn up, as new rows here.
5. Ship as a new release (bump `package.json`, `npm run dist` on Windows, tag `vX.Y.Z`).

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
| V1.1 | v1.1 polish (Sam, 2026-11-09): away-prompt off switch, Countdown mode, task on the timer + By task stats, focus view (`H`), proportional and resizable widgets, image/GIF widgets (file or link, bare mode), pop-out Spotify widget, YouTube embed fix | §4.1, §4.2, §4.4, §4.6, §4.7, §4.10, §5 | done (v1.1.0) | spec `docs/planning/specs/2026-11-09-v1-1-polish-design.md`, plan `docs/planning/plans/2026-11-09-v1-1-polish.md`, verification `docs/planning/plans/2026-11-09-v1-1-polish-verification.md`; commits f4d8dc6…6aee436 on branch `feat/v1-1-polish` |
| V1.2 | v1.2 (Sam, 2026-11-11): Tweek-style planner replacing the sticky-note tasks (Day/Week/Month board, lists linked to subjects, tags, estimates, subtasks, repeat, reminders, quick-add, timer link and ▶), notes pop-out stickies with bare paper, YouTube quality + live badge, background play/pause (V), 3-2-1 countdown pips, deadlines widget with live countdowns, stats widgets, spaced revision tasks, session intention and outcome, Spotify moved into the Widgets popover | §2, §4.1, §4.2, §4.4, §4.5, §4.7, §4.9, §4.10 | built (on branch, not merged) | spec `docs/planning/specs/2026-11-11-v1-2-design.md`, plan `docs/planning/plans/2026-11-11-v1-2.md`, verification `docs/planning/plans/2026-11-11-v1-2-verification.md`; commits `d3782a3..c1d0f0d` on branch `worktree-feat-v1-2` (worktree `.claude/worktrees/feat-v1-2`); screenshots on Windows under `C:\Users\samue\studyat-shots\`: `v1-2-run1`, `v1-2-run2`, `v1-2-t34`, `v1-2-t34b`, `v1-2-t35`, `v1-2-final`, `v1-2-final2`, `v1-2-final3`, `v1-2-tweek`, `v1-2-tweek-full`; Tweek board feel pass: spec `docs/planning/specs/2026-11-12-tweek-board-feel-design.md`, plan `docs/planning/plans/2026-11-12-tweek-board-feel.md`, commits `c1cc2ad..2341762` |
| V1.3 | Revision extras from the v1.2 research shortlist: daily shutdown review, Anki due counts (AnkiConnect, local only), Recall session type, break suggestions; iCal events on the board | — | idea | v1.2 spec §8 |
