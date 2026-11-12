# StudyAt v1.2 — verification record

Plan: [2026-11-11-v1-2.md](2026-11-11-v1-2.md) · Spec:
[2026-11-11-v1-2-design.md](../specs/2026-11-11-v1-2-design.md) (see its §12 for the amendments made
during the build) · Branch `worktree-feat-v1-2` (worktree `.claude/worktrees/feat-v1-2`), verified
at **c1d0f0d**, 74 commits on top of `main` (b792c1a). Nothing is pushed or merged.

In short: every automated gate is green. On Windows the whole e2e suite passes except the global
hotkey test, which fails only because your own StudyAt.exe was running and holding Ctrl+Alt+P.
What's left for you: the hand-walk (§4), the look calls (§5) and one check of last night's sessions
(§6).

## 1. How the gates were run

| Gate | Where | Result |
| --- | --- | --- |
| `./check.sh`: agent roster, typecheck (incl. `e2e/`), lint, unit and component tests | WSL | **green** at c1d0f0d: 115 test files, **1726 tests** (baseline before v1.2: 82 files, 1160 tests) |
| `scripts/win.sh npm ci` / `npm run build` | Windows mirror `C:\Users\samue\dev\StudyAt-v1-2` | exit 0 |
| `scripts/win.sh npx playwright test` (whole suite) | Windows, throwaway `STUDYAT_USER_DATA` per test, system idle stubbed inside the test app | **47 passed, 1 failed, 4 skipped (14.6 m)** |

- The failure is `shortcuts.spec.ts › the global hotkey is registered…`: "Ctrl+Alt+P should be
  registered (is another StudyAt running?)". Your StudyAt.exe was running and owns the key. Re-run it
  with your app closed to confirm (`scripts/win.sh npx playwright test e2e/shortcuts.spec.ts`).
- The 4 skips are the screenshot-only specs (they run when `STUDYAT_SHOTS_DIR` is set).
- New spec files: `e2e/v1-2-shell.spec.ts` (9), `e2e/v1-2-planner.spec.ts` (15). Existing specs
  updated for the v1.2 dock and planner, no assertion weakened.
- Every e2e check of a behaviour reads main's state or the database, not only the screen.

No installer was built (not asked for in this plan).

## 2. Acceptance criteria → evidence (spec §9)

| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Dock without Spotify | `Shell.test`, `App.test`; e2e `v1-2-shell` dock test + shots | met |
| 2 | Widgets popover toggles and adds | `Shell.test`; e2e popover test (Spotify saved in main, stats/image add) | met |
| 3 | Sticky pops out, survives restart, docks back | `notes.test` (repo), `stickies.test`; e2e (position within 2 px after relaunch) | met |
| 4 | Bare sticky, toolbar on hover, ≤ 12 | `stickies.test`, `WidgetFrame.test`; e2e (13th rejected by main, button disabled) | met — tooltip on hover left to 👤 |
| 5 | YouTube quality; 4K reaches hd2160; badge | spike T1 (hd2160 at 4K); `youtube.test`, `SpaceSettings.test`; e2e (badge 2160p at 4K, Auto ≤ 1080p at 1080p device px, 4K→Auto drops at once) | met — 👤 step 3 |
| 6 | V and top-bar play/pause; reset on space change; hidden for images | `spacesStore.test`, `TopBar.test`, `SpaceBackground.test`; e2e | met |
| 7 | Pips 3·2·1 then the end chime; none on pause/skip/reset; switch | `useChimes.test` (8 cases); e2e (switch survives relaunch) | met — 👤 listen, step 4 |
| 8 | Migration v4 | `migrations.test` (archive, sequence, Inbox + lists, CHECKs, rollback, backup); e2e (v3 file → v4, backup present) | met |
| 9 | Quick-add parser | `quickAdd.test` | met |
| 10 | Create / move / reorder; effective subject; delete with confirm | `taskWrites.test`, `planner.test`, `dnd.test`, `TaskDetail.test`; e2e real-pointer and keyboard drags, delete | met |
| 11 | Repeat on the right day | `schedule.test`, `taskWrites.test`; e2e | met |
| 12 | Roll forward: off by default, idempotent | `schedule.test`, `taskWrites.test`, `date-watch.test`; e2e (relaunch moves it with "from Wed 11 Nov") | met |
| 13 | Reminders | core and main `reminders.test` (injected clock, London zone pinned), `notify.test`; e2e (`reminded_day` on disk) | met — 👤 step 11 |
| 14 | Widget and board views render tasks, deadlines, totals | `PlannerWidget.test`, `board.test`, `views.test`; e2e | met |
| 15 | Task sets its subject in one split; ▶ four cases | `controller.test`, `ipc.test`; e2e (▶ with subject, session row) | met |
| 16 | Actual includes the running row; amber when over | `planner.test`, `PlannerWidget.test`, `board.test` | met |
| 17 | Revision offer, exam cap | `schedule.test`, `taskWrites.test`, `revision.test`; e2e (+1, +3, +7, +9 with exam 10 days out) | met |
| 18 | Deadlines CRUD, countdowns, board chips | `deadlines.test`, `DeadlinesWidget.test`, `DeadlineChip.test`; e2e (formats, chips clear when deleted or done) | met |
| 19 | Intention without a split; outcome after ≥ 1 min; off switch | `controller.test`, `Timer.test`; e2e ("Partly" on every row of the pomodoro) | met |
| 20 | Stats widgets ≤ 6, card × range, Today live, survive restart | `cards.test`, `stats.test`, `statWidgets.test`; e2e | met |
| 21 | No study-time change; task + subject = one new row | existing accounting tests unchanged; `controller.test` "splits once"; final whole-branch review | met |
| 22 | `./check.sh` green; e2e green on Windows | §1 | met, except the hotkey test while your app runs |
| 23 | appplan and roadmap | appplan §2, §4.1, §4.2, §4.4, §4.5, §4.7, §4.9, §4.10, §6.4; roadmap V1.2 row | met |

## 3. Screenshots

All on Windows under `C:\Users\samue\studyat-shots\`: `v1-2-run1`, `v1-2-run2` (the first two
look checks), `v1-2-t34`, `v1-2-t34b` (shell e2e), `v1-2-t35` (planner e2e), `v1-2-final`,
`v1-2-final2`, `v1-2-final3` (the latest look). The best overview: `v1-2-final2\final2-01-board-week.png`,
`final2-03-board-lists.png`, `final2-04-everyday.png`, and `v1-2-final3\final3-week-tab-today.png`.

## 4. Your hand-walk (spec §10)

Run it with `scripts/win.sh npm run dev` from the worktree. That uses your real data folder: your
database migrates to v4 and a `pre-migration-v3-*` backup is taken first. The v1.1.0 app will then
refuse the v4 file, so only do this when you're ready to stay on v1.2.

1. Dock: no Spotify. Open Widgets → turn Spotify on and off.
2. Notes: make three, pop two out, drag them apart, hide one's background, restart — both stickies
   where you left them; dock one back. With 12 popped out, hover the disabled Pop out button: does
   "Up to 12 notes on the screen" show?
3. YouTube space with 4K: Quality → 4K, watch the badge reach 2160p; V pauses and plays; switch space
   and check it plays.
4. Focus at 1 min: listen for pip · pip · pip · focus chime; let the break end: pip · pip · pip ·
   break chime.
5. B: the board. Quick-add `Lecture 5 notes #lecture ~1h @2221` on today; drag a task from the
   COMP2221 list to Thursday; try Month and Day.
6. ▶ on the lecture task: focus starts with COMP2221 and the task; type an intention; skip after a
   minute and answer "Partly".
7. Tick the lecture task: accept "Schedule revision" and find the Revise tasks.
8. Add an exam for COMP2221 next month and a coursework due tomorrow; turn on Deadlines; see "Exam in
   N days" on the COMP2221 list.
9. Three stats widgets (Total · Today, By subject · Week, Estimates · Month); run a focus and watch
   Today tick; hide one's background.
10. Settings → Tasks: turn on "Move unfinished tasks to today", leave a task on yesterday, relaunch,
    check it moved with "from …".
11. A reminder two minutes ahead: wait for the notification.
12. Global hotkey: with only one StudyAt running, Ctrl+Alt+P toggles the timer.

## 5. Look calls for you

- **The board vs Tweek** (your direction). Days and lists are ruled-line columns, the lists sit in
  one row under the week with Inbox first, and drag works between any of them. Is it close enough?
- **Long board titles** wrap over two or three ruled lines (as Tweek does). Keep, or one line with an
  ellipsis?
- **Estimate chip** on a title that only just overflows wraps alone onto the next rule. Keep
  (recommended), glue it to the last word, or drop it when it doesn't fit?
- **Day columns:** plain ruled lines, or a light paper fill?
- **Month titles** clamp at two lines (full title on hover).
- **Bare stickies:** only a thin margin around the text drags the paper; the bare toolbar fades with
  the rest of the chrome. **Bare stats cards** keep a small glass panel for readability.
- **Timer:** the "No task" picker is now full width; once an intention is filled from a task it
  doesn't follow later task changes (spec-literal).
- **"+ Add" and "Past"** sit in a bar inside the Deadlines widget, not in its header.

## 6. One thing to check from last night

During one Windows test run (about 01:46–02:33 on 12 Nov) a test agent kept the PC awake with a
script that moved the mouse every 20 s. Your own StudyAt was open. If it had a focus session
running then, its idle/away detection would not have fired, so that time may be counted. Please look
at Stats → sessions for that window and edit or delete anything you didn't study. This was stopped,
banned for the rest of the build, and replaced by stubbing idle inside the throwaway test app.

## 7. Rulings

Every ruling, with its reason and cost, is in the build ledger
`.claude/ledger/2026-11-11-v1-2/progress.md` (git-ignored). The ones that change what you see:

- **Your calls:** the YouTube Quality control ships with the spec hint; the spike's "fail" was Auto
  reaching hd1440 at 150 % scaling. The board looks like Tweek with an Inbox list (spec §12).
- **Planner:** Inbox seeded first (migration v4 edited before release; v1–v3 untouched). Board Week
  rows compact (dot + estimate). One-page board scroll, one list row, "+ New list" at the end, a dot
  instead of a repeated subject chip. Re-ticking a repeating task never makes a second copy. A
  paused break also shows "Task set for your next focus.".
- **Deadlines:** notes 0–5000; impossible dates rejected; done ones listed under Past as "Done".
- **Timer:** the intention counts characters (emoji = 1) and a long paste keeps the first 140.
- **Background:** the top-bar play/pause also shows with reduced motion and shares one state with V
  and the footer.
- **Reminders** are checked before tasks roll forward at the start of a study day.
- **Stats widgets** add live time only for running focus since their last fetch, so deleted time
  never reappears.
- **New dependency:** `@dnd-kit/core` and `@dnd-kit/sortable` (pure JS, dev dependencies).

Left as small display-only follow-ups: board deadline pruning uses the default rollover hour if
it runs before settings load; a few tests could pin rollover-boundary and unmount cases. None
touches study time or data.
