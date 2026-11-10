# StudyAt v1.1 polish — verification record

Plan: [2026-11-09-v1-1-polish.md](2026-11-09-v1-1-polish.md) · Spec:
[2026-11-09-v1-1-polish-design.md](../specs/2026-11-09-v1-1-polish-design.md) · Branch
`feat/v1-1-polish`, verified at **6aee436** (version 1.1.0).

The short version: every automated gate is green and all 29 end-to-end tests pass on Windows. The
1.1.0 installer is in your Downloads folder, **not** on GitHub. What's left is your hand-walk (§5)
and the look calls (§6).

## 1. How the gates were run

| Gate | Where | Result |
| --- | --- | --- |
| `./check.sh`: agent roster, typecheck (incl. `e2e/`), lint, unit and component tests | WSL | **green** at 6aee436: 82 test files, **1160 tests** |
| `scripts/win.sh npm ci` | Windows mirror `C:\Users\samue\dev\StudyAt-v1-1` | exit 0 |
| `scripts/win.sh npm run build` | Windows | exit 0 |
| `scripts/win.sh npx playwright test` (all 17 spec files) | Windows, throwaway `STUDYAT_USER_DATA` per test | **29 passed (10.3 m)** |
| `scripts/win.sh npm run dist` | Windows | exit 0: one-click, per-user NSIS installer |

**Installer:** `StudyAt Setup 1.1.0.exe`, 142,835,394 bytes, sha256
`8606dbbacc8a6e1f510690dc6d3cd3d1852ab74d57900a1d5faa7aac92ce555e`, in
`C:\Users\samue\Downloads\StudyAt-1.1.0\` (with its `.blockmap`). It has not been run or
uploaded. It is unsigned, and electron-builder warns that `author` is missing from `package.json`
(as in v1.0.0).

Screenshots: 64 from the final run are in `C:\Users\samue\studyat-shots\v1-1-final\`. The ones the
review rounds asked for (`v11-*`, `v11-fix9-*`, `v11-final-*`) are also in the build ledger.

The e2e run was built from the tree at `ba36bbc` plus `58e11de`. `58e11de` changes docs only, and
`6aee436` is the spec file that run used. So the installer's code is the code at 6aee436.

## 2. Acceptance criteria → evidence (spec §9)

| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | `awayPrompt` off: 15 min idle in focus → no prompt, all 15 min kept | `src/main/timer/controller.test.ts` (injected clock) | met |
| 2 | `awayPrompt` on: behaviour unchanged | existing idle tests pass in `./check.sh` | met |
| 3 | Switch off with an unprompted away period keeps the time; a showing prompt still resolves | `controller.test.ts` (plus switch-back-on clamp tests) | met |
| 4 | Countdown accrues into one row, chime, "Countdown done", idle in Countdown, `completedFocusCount` unchanged | unit: `machine.test.ts`, `controller.test.ts`, `notify.test.ts`, `useChimes.test.tsx`. e2e ran a 1-min Countdown | met (the chime and notification are unit-only; hand-walk step 2) |
| 5 | Countdown 1–240 enforced; presets set it | settings sanitiser tests; `Timer.test.tsx` | met |
| 6 | Task change mid-segment splits the row; day key and `task_id`/`task_text` right | `controller.test.ts` | met |
| 7 | Migration v3 with backup first; existing rows kept | `migrations.test.ts` v3 fixture; e2e `migration.spec.ts` | met |
| 8 | Task column and By task card with correct totals | `stats.test.ts`, stats component tests; e2e `v1-1.spec.ts` | met |
| 9 | `H` focus view; `H`, `Esc` and the capsule bring it back | `Shell.test.tsx`; e2e with screenshots | met |
| 10 | Widgets scale proportionally at 960 × 540 | e2e at two sizes | met: half size, same centre. The top edge is clamped below the top bar (allowed by spec §7) |
| 11 | Resize handle and keyboard +/−/0 change and persist `scale` | `WidgetFrame.test.tsx`; e2e (survives relaunch) | met |
| 12 | Old settings without `scale` load as 1 | `settings.test.ts` | met |
| 13 | GIF from file, direct link and Giphy link; bare mode; drag/resize/remove; refusals verbatim | e2e: file, https link, both errors verbatim, bare, drag, focus view, remove, thin missing image, scheme-less link. Giphy mapping and the 20 MB refusal are unit-only | met; "it animates" → hand-walk step 6 |
| 14 | Protocol serves `image/<id>` for registered ids only | `protocol.test.ts` | met |
| 15 | Spotify playing state shows only art, title, artist, progress, transport | `SpotifyWidget.test.tsx` | 👤 your sign-off (not seen playing on Windows) |
| 16 | Built app: `dQw4w9WgXcQ` plays, starter spaces play, `jfKfPfyJRdk` honest message, bind 127.0.0.1, 152/153 | e2e on the built app; `server.test.ts` | met |
| 17 | `./check.sh` green | 82 files / 1160 tests | met |

Added after the final review (Sam's rulings, §4):

- A done task clears while idle: `controller.test.ts` (9 cases) and e2e (`v11-final-held-task-cleared.png`).
- New images cascade: `images.test.ts` and e2e, which reads the stored positions (`v11-final-images-cascade.png`).
- The toolbar hides after a click: e2e asserts opacity 0.
- Removing a missing image asks first: `images.test.tsx` and e2e (`v11-final-missing-confirm.png`).

## 3. Tasks and reviews

Every task was reviewed by `study-review`. The whole branch then had a final review, and its
fixes were re-reviewed.

| Task | Commits | Review |
| --- | --- | --- |
| 1 Shared types and settings | f4d8dc6 | clean |
| 2 Migration v3, repos | 08edd83 | clean |
| 3 Timer: countdown, task, away switch | af9e1db, 3dfb068 | clean after 1 fix round |
| 4 Stats by task + IPC | 8e7fad9 | clean |
| 5 Images, main side | 8c92edd | clean |
| 6 YouTube on localhost | e1a8ee7, f3a73cf | clean after 1 fix round |
| 7 Layout scale + resize | 03b0925, f18c6ea | clean after 1 fix round |
| 8 Focus view | 05dfb06, b55a48c | clean after 1 fix round |
| 9 Image widgets UI | 5c340f1, 00b6f85, 8e10511 | clean after 1 fix round |
| 10 Timer UI, task picker, away toggle | d6a41a7 | clean after 1 fix round |
| 11 Stats task UI | 4a44bea | clean |
| 12 Spotify pop-out | 228c5e0 | clean |
| 13 e2e on Windows | 28e8b85, 6aee436 | 29/29 pass |
| 14 Docs | 33ff682, ffb7e20, 58e11de, this record | — |
| Final review fixes | d15e855, 0be1905, 361eb1c, e8d6d54 | clean after 2 rounds |
| Release | ba36bbc (1.1.0) | — |

## 4. Rulings

Yours (2026-11-09):

- Task-switch fragments under one minute are dropped, like subject splits.
- **A done or deleted task leaves the timer whenever no focus segment is running or paused.** That
  covers its end, Skip, Reset, a mode change, and a tick-off while idle or on a break. This is done
  in the main process, before any auto-started focus opens its row, so no sliver is lost. A running
  or paused focus is never split.
- New image widgets cascade (+0.03, +0.04 per existing image, wrapping after 6).
- The bare image toolbar shows on hover or keyboard focus. A mouse click doesn't pin it.

Made during the build, without you (each with its cost if wrong):

- Away switch turned back on: the idle threshold uses full system idle, but the charge is
  clamped to the moment it was switched on. This is spec-conformant.
- Focus view: `W`, `K` and `G` leave focus view, because a shortcut that opens a panel must
  show it. `T` leaves it only when the Tasks widget is auto-hide. `Esc` closes an open panel
  before it exits focus view.
- "Image missing" → Remove asks "Remove this image?" first. A file that fails to decode
  must not lose its only copy. Cost: one extra click.
- The "Image missing" frame is at least 160 × 80 px, so the text and Remove fit on thin images.
- The add-image form uses the app's own validation, not Chromium's US-English bubble.
- Stats: By subject and By task sit side by side; the Task cell shows the full text as a tooltip.
- New copy: "Couldn't add that image." and the field label "Link".
- Countdown-end notification `{n}` is the planned length. This is always the real focus time,
  because discarded away time is given back to the Countdown.

## 5. Hand-walk (you)

Install `StudyAt Setup 1.1.0.exe` from `Downloads\StudyAt-1.1.0`, or run
`scripts/win.sh npm run dev`. Then:

1. Settings → Timer: turn off "Ask if I've been away". Run a Pomodoro, leave the PC for 11 min
   without locking it: no prompt, and the time counts. Turn it back on.
2. Press `4`, pick 60 (or set 2 min to test), pick a subject and a task, then start. Let it end:
   you should get the chime, "Countdown done" and no break.
3. Run a Pomodoro with a task and switch task halfway. In Stats, both pieces appear and By task
   shows both. Tick a task off, then press Reset: the picker goes back to "No task".
4. Press `H`: the dock and top bar go away and stay away when the mouse moves. Hover the top-left
   corner → "Show interface". Press `H` again.
5. Drag a widget's corner to make it bigger. Relaunch: it's still bigger. Shrink the window and
   the layout shrinks in place.
6. Widgets → Add image…: add a GIF from disk and a Giphy link, and check they **animate**. Turn
   one's background off, then drag it, resize it, and remove the other.
7. Spotify: play something; the widget looks like the Windows media pop-out.
8. Add the YouTube video that failed before; it plays.

## 6. Look calls and open items

- **Focus ring after a click:** a clicked bare image keeps its blue focus ring (the toolbar does
  hide). Keep it, or show it for keyboard focus only (one selector)?
- **First image position:** the first new image starts at (0.5, 0.3), which on a 1280 × 800 window
  sits over the Timer's Start/Reset/Skip row. Drag it away, or pick another start spot (one constant).
- **Bare toolbar after Cancel:** clicking Remove on a bare image and then Cancel with the mouse
  leaves the toolbar showing until focus moves. This is needed so the question stays visible
  while you answer.
- **Look sign-offs from the plan:** the Spotify pop-out, the Stats half/half layout, and slightly
  soft text at non-whole widget scales.
- **Small deferred items (no behaviour change):**
  - Spotify ticker resets on each poll answer; a width transition animates big jumps.
  - Test gaps:
    - the download timeout is untested;
    - the streaming-cap assertion is loose;
    - the migration e2e doesn't look at the `images` table;
    - the tasks listener test doesn't restore its spies in a `finally`.
  - Duplicated fetch helpers in the image service; a comment about `::1` in `server.test.ts`.
  - Import order in `Shell.tsx`; invented hint copy "One focus block, set on the timer's
    Countdown tab".
