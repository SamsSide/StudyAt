# Simple tasks — verification record

Plan `docs/planning/plans/2026-11-13-simple-tasks.md`, spec
`docs/planning/specs/2026-11-13-simple-tasks-design.md`. Branch `worktree-feat-v1-2`, built
2026-11-13 with `study-plan-execute`. Not pushed.

## 1. Commits

| Commit | What |
| --- | --- |
| `ed78617` | feat(db): migration v5 brings back sticky tasks and archives the planner (Task 1) |
| `da7027b` | refactor(main): remove the planner services and restore the sticky task contract (Task 2) |
| `bf99469` | feat(tasks): bring back the sticky-note Tasks widget with ▶ and remove the planner UI (Task 3) |
| `e389062` | test(e2e): sticky tasks and ▶, v5 migration, planner specs removed (Task 4) |
| `28c2649` | test(e2e): build the v4 fixture like real data and tighten the ▶ test (Task 4, fix round 1) |
| `c4a60dc` | test(e2e): sticky screenshots, a >=1 min focus for the ▶ session row, and the picker selector (Task 5) |
| `c913a55` | fix(tasks): ▶ keeps its slot so a long sticky doesn't reflow on hover (Sam's ruling) |
| `3b87a15` | test(e2e): assert a long sticky keeps its height when ▶ appears; no-hover and focus shots (Task 5) |
| `a628d01` | docs(db): name the estimates-widget delete in the v5 header and fix a test title (final review) |
| `4cf4440` | test(tasks): cover the ▶ notice for focus, a paused break, the next ▶ and Alt+arrow from ▶ (final review) |
| (this commit) | docs: record the move from the planner back to sticky tasks (Task 6) |

Tasks 1–4 were built as one parallel batch. Each commit holds one task's files, so the commits
between `ed78617` and `bf99469` don't build on their own; the tree builds from `bf99469` on.

## 2. Gates

- **Baseline** (`9fd8f6c`, before Task 1): `./check.sh` green, 116 files, 1773 tests.
- **Whole tree after the batch:** `Test Files  95 passed (95)` · `Tests  1422 passed (1422)` ·
  `check.sh: green`. The counts dropped because the planner's test files were deleted.
- **Final** (`4cf4440`, whole tree): `Test Files  95 passed (95)` · `Tests  1427 passed (1427)` ·
  `check.sh: green`.
- **e2e typecheck:** `npx tsc --noEmit -p tsconfig.e2e.json` is clean (it also runs inside `check.sh`).
- **Windows, Playwright for Electron** (mirror `C:\Users\samue\dev\StudyAt-v1-2`, throwaway user
  data, after `npm ci` and `npm run build`):
  - first full run: **"4 failed, 38 passed (14.6m)"** (42 tests);
  - three failures were e2e defects:
    - the ▶ test needed at least 1 minute of focus, because shorter sessions are dropped;
    - the pop-up test used a stale selector for main's picker;
    - the new screenshot test didn't start the break.
    They were fixed in `c4a60dc` and passed in targeted re-runs: `v1-2-misc.spec.ts` passed, and
    `tasks.spec.ts` gave **"3 passed (1.3m)"** (re-run again after `c913a55`, with the height check);
  - the fourth failure was `shortcuts.spec.ts` ("Ctrl+Alt+P is in use by another app"). Sam's own
    StudyAt was running and held the hotkey. This is environmental, the same as the v1.2 record.
  - Sam chose not to re-run the full suite.

## 3. Acceptance criteria (spec §9)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | v4 → v5: backup, v1 columns, ids kept, archives intact, estimates gone, sessions byte-identical | `migrations.test.ts` (v5 test); e2e `v1-2-misc.spec.ts` migration test on Windows (schema 5, `pre-migration-v4-*.sqlite`, archive 1 row, ids 1 and 2 in order); `migrated.png` |
| 2 | A new task's id is above every archived id and `sessions.task_id` | `migrations.test.ts` (planner sequence 30 and session `task_id` 40 give id 41) |
| 3 | v3 → v5: stickies back once | `migrations.test.ts` (v3 test) |
| 4 | Widget adds, ticks, edits, recolours, reorders, clears done; persists | restored `TasksWidget.test.tsx`; e2e `tasks.spec.ts` test 1 on Windows |
| 5 | ▶ starts focus; session row gets `task_id`/`task_text`; subject unchanged; done has no ▶ | `controller.test.ts`, `TasksWidget.test.tsx`; e2e `tasks.spec.ts` ▶ test on Windows (one session row, task and subject checked on disk) |
| 6 | Picker lists open stickies; picking splits; a done or deleted held task leaves after the segment | `controller.test.ts` (release tests), `Timer.test.tsx` (TaskSelect); `timer-picker.png` |
| 7 | No B, no board, no Settings → Tasks, no Estimates | `Shell.test.tsx`, `SettingsOverlay.test.tsx`, `statWidgets.test.tsx`; e2e `v1-2-misc.spec.ts` on Windows |
| 8 | No import of the planner dirs or `@dnd-kit` | `grep -rnE "renderer/planner\|core/planner\|shared/planner\|@dnd-kit" src e2e package.json`: one hit, a comment inside the frozen v4 migration body (shipped migrations are never edited); `./check.sh` green |
| 9 | JSON export: `tasks` in v1 shape, no `tasksV1`/`taskLists` | `data.test.ts` |
| 10 | Surviving v1.2 features work | existing unit tests; e2e: pop-up layering and the YouTube Auto badge (moved to `v1-2-misc.spec.ts`), and the other v1.2 specs, passed on Windows |
| 11 | 👤 Sam's real data migrates and looks right | hand-walk, §5 |

## 4. Screenshots

Windows `C:\Users\samue\studyat-shots\simple-tasks\` (WSL `/mnt/c/Users/samue/studyat-shots/simple-tasks/`):
- `tasks-widget.png`: stickies in four colours, one done;
- `tasks-no-hover.png`, `tasks-play-hover.png`: a long sticky without and with hover, the same
  height (89.93 px both, asserted in the e2e);
- `tasks-play-focus.png`: Tab onto ▶, with its focus ring;
- `tasks-next-focus.png`: "Task set for your next focus." during a break;
- `timer-picker.png`: the timer picker listing the open stickies;
- `migrated.png`: after the v4 → v5 e2e, "Old sticky" then "Planner task".

## 5. 👤 Hand-walk (spec §10)

- [ ] 1. Quit StudyAt. Install the build (or `scripts/win.sh npm run dev` on the worktree mirror
  against a copy of the data folder, if you want a dry run first).
- [ ] 2. Launch. Open Tasks (T). Your old v1.1 stickies are there, followed by any v1.2 planner
  tasks. Done ones sit under "Done (n)".
- [ ] 3. Add "Test task", tick it, untick it, change its colour, drag it to the top, then Clear done.
- [ ] 4. Hover a sticky and press ▶. Focus starts with that task in the timer picker. Stop the timer.
- [ ] 5. Open Stats → By task. The history is unchanged.
- [ ] 6. Press B: nothing happens. Settings has no Tasks section. The Widgets popover has no Estimates.
- [ ] 7. Check that `backups/` in the data folder has a `pre-migration-v4-…sqlite`.
- [ ] Look call: ▶ now keeps its slot, so a note has a 22 px gap before the colour dot even when ▶
  is hidden. Check that the gap looks fine on short and long stickies.

## 6. Rulings

**Sam's (clickable, during the build):**
- The ▶ reflow: **"Reserve its space"**. ▶ always holds its slot, hidden with opacity until hover or
  focus within, so a long note no longer grows on hover. This overrides the plan's "clip pattern"
  wording.
- No full Windows e2e re-run after the e2e fixes; this record cites the targeted re-runs and the one
  environmental failure.
- Roadmap V1.3: the "iCal events on the board" item is dropped with the board.

**Dispatcher and agents:**
- The fresh-install archive `task_lists_v4_archive` holds v4's frozen Inbox row (the plan said it
  would be empty). v4 is shipped and never edited.
- The v5 unit fixture uses the `'goal'` widget card, not `'streak'`, because v4's CHECK rejects `'streak'`.
- In the pinned v4 test, the `studyat.sqlite` publish-order check is dropped; the v1 and v2 tests
  still cover it.
- v5 has no guard for an id clash between the v1 archive and the planner table, because v4 always
  started planner ids above the archive. A hand-edited database would roll back to v4 with its
  backup in place.
- `tasks:update` keeps main's "No such task" error. Only `timer.setTask` and `timer.startTask` use
  `TASK_GONE`.
- `TaskSelect` keeps v1.2's "Couldn't set that task." for failures other than `TASK_GONE`.
- "No Estimates" is asserted in the stat-widget card menu, where cards are chosen (WidgetsPopover
  doesn't list cards), and in `stats.test.ts` for `STAT_CARDS`.
- The v1.2-shell stats-widgets e2e now uses the "Goal + streak" card in place of Estimates.
- The ▶ e2e reads the session row after quit, so it is on disk, and runs 62 s of focus, because
  sessions under a minute are dropped.
- The v4 → v5 e2e fixture is built like real data (v3 sticky, then v4, then the planner task). The
  first version gave two rows the same id, and v5 would have failed on it.
- The e2e B test presses `b` literally, with a comment. It is the one intended exemption from the
  leftover grep.
- The final review covers `9fd8f6c..HEAD` (this plan), not the whole v1.2 branch, whose earlier
  passes were reviewed in their own runs.

## 7. Final review

One `study-review` (Opus) went over `9fd8f6c..3b87a15`: **approve**, with no Critical or Important
findings. It checked the renderer ↔ preload ↔ main ↔ repo seam end to end, `onTasksChanged`
reaching the controller, every `TASK_GONE` path, and a whole-tree grep for leftovers. That grep
found only negative assertions, history comments and the frozen v4 body.

Fixed before merge:
- The v5 header now names the Estimates widget delete (`a628d01`). v5 is not shipped yet, so this
  was the last chance to edit it.
- The fresh-install test title now says what it asserts (`a628d01`).
- The ▶ notice tests (`4cf4440`) now cover:
  - running focus, which shows no notice (awaited);
  - a paused break, which shows the notice;
  - the next ▶, which clears the notice;
  - Alt + ArrowDown from ▶, which keeps focus on ▶.

Left as they are (minor):
- `setTask` or ▶ on a done sticky is only possible from a stale UI. Focus then starts on "No task"
  without a message, and no study time changes.
- **The commits from `ed78617` to `da7027b` don't build on their own** (a parallel batch, one commit
  per task). Sam's call at merge: squash them, or accept that `git bisect` can't stop there.
- The full e2e suite last ran before the e2e fixes and the ▶ CSS change, and Sam declined a re-run.
- These are cosmetic:
  - the `db = { raw }` wrapper in the pinned v4 test;
  - the primary-key rewrite in one controller test;
  - the "22px slot" comment, which leaves out the row gap;
  - the ▶ notice showing `TASK_GONE` for any rejection, which is what the spec says.
