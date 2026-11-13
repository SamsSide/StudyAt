# Simple tasks — specification

> Status: draft. Roadmap: V1.2 (replaces its planner before merge). Branch: `worktree-feat-v1-2`.

## 1. Premise

The v1.2 Tweek-style planner (board, Day/Week/Lists widget, lists, tags, subtasks, estimates,
repeat, reminders, spaced revision, roll forward, quick card) is too much and doesn't feel right.
Sam (2026-11-13): planning belongs in a dedicated app (Tweek, used on its own as it is now). StudyAt
goes back to a **basic task list**: the v1.1 sticky-note Tasks widget.

A spike first checked the alternative of embedding tweek.so in the app: it loads fine in an Electron
45 `WebContentsView` (no frame-blocking headers; "Continue with Google" opens Google's real sign-in).
Sam chose not to embed it. Tweek stays external, and nothing in this spec links to it.

## 2. What is already true

- **On `main` (v1.1.0)** the Tasks widget is sticky notes. Files: `src/renderer/tasks/TasksWidget.tsx`,
  `TaskNote.tsx`, `TasksWidget.module.css`, `TasksWidget.test.tsx`, `src/main/db/repos/tasks.ts`
  (+test), `e2e/tasks.spec.ts`. Channels `tasks:list|create|update|reorder|clearDone`. Every call
  returns the full `Task[]`. Type `Task { id, text, colour, done, sort, createdAt, doneAt }`. The
  timer's `TaskSelect` lists open tasks from `tasks.list()`. `onTasksChanged` lets the timer release
  a held task once it is done or gone. Commit `fb6d42c` removed all of this on this branch.
- **On this branch (v1.2, schema v4)** the planner replaced it. appplan §4.5 describes it. Schema
  v4 (`src/main/db/migrations.ts` 139–206):
  - renamed the v1 table to `tasks_v1_archive`;
  - added `task_lists`, a new `tasks` (title, note, colour NULL, day | list_id, subject_id,
    estimate_min, repeat, reminder, kind, …), `task_tags` and `subtasks`;
  - set `tasks`' `sqlite_sequence` above every old id and every `sessions.task_id`.
- **By-task stats don't join `tasks`.** `byTask` (`src/core/stats/totals.ts` 149–170) groups
  `sessions.task_id` and shows the newest `task_text` snapshot, so removing or reshaping tasks
  never changes history.
- **Migrations:** `MIGRATIONS` entries `{version, up}`, with `LATEST_VERSION = MIGRATIONS.length`.
  `migrate()` copies the file to `backups/pre-migration-v<from>-<stamp>.sqlite` before running,
  and runs each step in a transaction. Shipped migrations are never edited.
- **Survivors that import `src/shared/planner.ts`:**

  | Constant | Used by |
  | --- | --- |
  | `INTENTION_MAX` | the session intention |
  | `TASK_GONE` | the timer task picker, the ▶ notice |
  | `NEXT_FOCUS_NOTE` | the ▶ notice |
  | `MAX_POPPED_NOTES` | notes |
  | `MAX_STAT_WIDGETS` | stat widgets |
  | `DEADLINE_TITLE_MAX`, `DEADLINE_NOTE_MAX` | deadlines |
  | `LIMIT_COPY.notes`, `LIMIT_COPY.statWidgets` | notes, stat widgets |

## 3. The design

### 3.1 The Tasks widget (appplan §4.5 returns to v1.1)

The v1.1 widget comes back from `main` as it was. Features:
- the quick-add box (placeholder **"Add a task…"**);
- small sticky notes in six colours, yellow by default;
- click the text to edit (at most 500 characters);
- tick a task to move it to a collapsible **"Done (n)"** section, cleared with **"Clear done"**;
- reorder with the drag handle (`Drag to reorder: <text>`) or Alt + Up / Down.

Dock item **Tasks**, key **T**, as on main. Widget position and state persist as before.

**One addition, ▶ (kept from v1.2 at Sam's request).**
- An open sticky shows a ▶ button on hover and on keyboard focus within the note, with
  `aria-label` **`Start focus on "<text>"`**.
- It calls `timer.startTask(id)`.
- Done stickies have no ▶.
- The widget shows one notice line (`role="status"`) under the add box:
  - **"Task set for your next focus."** when the returned timer state is a running or paused break
    (a mode other than `focus` / `countdown`, and not idle);
  - **"That task no longer exists."** (`TASK_GONE`) when the call rejects, after which the list
    reloads.

  The notice clears on the next ▶ or add.
- As in v1.1, a sticky has no delete. It is removed by ticking it, then **Clear done**.

### 3.2 The timer link (kept)

- `timer.setTask(id | null)` and `timer.startTask(id)` stay. Main snapshots the sticky's `text`
  and passes `(id, text)`.
- **No subject travels with a task** (stickies have none). `subjectId` leaves `setTask`,
  `startTask` and `changeTask`, and the timer's subject never changes because of a task.
- `startTask`, unchanged otherwise:
  - an idle focus mode starts;
  - an idle break switches to Focus and starts;
  - a running or paused focus only takes the task (one split);
  - a running or paused break goes on.
- Picking a task still fills an empty intention with its text, when the intention setting is on.
- `TaskSelect` returns to main's version: "No task" then open tasks in list order, and the held
  task is shown by its remembered text even when done or deleted. It keeps v1.2's `TASK_GONE` error
  copy for a task deleted between opening the picker and choosing it.
- `onTasksChanged` returns from main's repo. A done or deleted held task leaves the timer whenever
  no focus segment is open, as in v1.1.

### 3.3 Removed

Everything else of the planner is removed: code, tests, e2e, settings and copy.

| Removed | Notes |
| --- | --- |
| Board overlay, key **B**, `Overlay` `full` prop and `.scrimFull`/`.dialogFull` | only the board used them |
| Day / Week / Lists widget, quick card, detail popover, quick-add parser | `src/renderer/planner/**`, `src/core/planner/**` |
| Lists, tags, subtasks, estimates, repeat, reminders, spaced revision, roll forward | and their IPC groups `planner`, `subtasks`, `lists`, the v1.2 `tasks` group, events `plannerOpenTask`, `plannerChanged` |
| Settings → Tasks section | settings `rollTasksForward`, `revisionTags`, `revisionDays` go; stored rows are ignored by `settingsRepo.get` |
| Estimates stat card (`'estimates'`) | from `StatCard`, `CardData`, `STAT_CARDS`, `stats.ts`, `cards.ts`, `StatWidget.tsx`, `cards.tsx` |
| Reminder notifications | `src/main/reminders.ts`, `notifyReminder`, `onOpenTask` |
| `newStudyDay` hook in `date-watch.ts` | existed only for roll forward |
| Planner list seeding in `seed.ts` | Inbox and per-subject lists |
| `@dnd-kit/core`, `@dnd-kit/sortable` | planner-only dependencies; removed in WSL with `npm uninstall` |

These stay untouched: the deadlines widget, notes and their pop-outs, stat widgets (other cards),
the session intention and outcome, the 3-2-1 countdown, YouTube quality, background play/pause,
and Spotify in the Widgets popover. Surviving constants move from `src/shared/planner.ts` to
`src/shared/limits.ts` with the same names and values, and `src/shared/planner.ts` is deleted.

### 3.4 Data: migration v5

A new migration **v5**, run after the usual automatic pre-migration backup, in one transaction:

1. Archive the planner tables untouched:
   - `tasks` → `planner_tasks_v4_archive`
   - `task_lists` → `task_lists_v4_archive`
   - `task_tags` → `task_tags_v4_archive`
   - `subtasks` → `subtasks_v4_archive`

   SQLite carries indexes and the `sqlite_sequence` row with each rename.
2. Create `tasks` in the v1 shape, exactly as v1 created it: `id INTEGER PRIMARY KEY AUTOINCREMENT,
   text TEXT NOT NULL, colour TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL
   DEFAULT 0, created_at INTEGER NOT NULL, done_at INTEGER NULL`.
3. Copy back every `tasks_v1_archive` row with its own id, text, colour, done, sort, created_at and
   done_at. `tasks_v1_archive` itself stays.
4. Append every `planner_tasks_v4_archive` row with its own id:
   - `text = substr(title, 1, 500)`
   - `colour = coalesce(colour, 'yellow')`
   - `done = done`
   - `done_at = CASE WHEN done = 1 THEN coalesce(done_at, updated_at) ELSE NULL END`
   - `created_at = created_at`
   - `sort = base + ROW_NUMBER() OVER (ORDER BY day IS NULL, day, sort, id) - 1`, where `base` is
     `coalesce(max(sort) + 1, 0)` over the rows copied in step 3

   So the old stickies come first and the planner's day tasks follow in date order, then its list
   tasks. Notes, tags, subtasks, estimates and the rest stay in the archive only.
5. Set `sqlite_sequence` for `tasks` to the largest of:
   - `max(tasks.id)`
   - the `planner_tasks_v4_archive` and `tasks_v1_archive` sequence values
   - `max(sessions.task_id)`

   Same pattern as v4 lines 190–205, so a new sticky never reuses an id that a session row points at.
6. `DELETE FROM stat_widgets WHERE card = 'estimates'`.

Sessions are not touched, so all study time, `task_id` and `task_text` are unchanged. A database
already at v5 is not re-run. A database at v1–v3 runs v4 then v5 as usual, so its v1 stickies come
back and nothing is duplicated, because v4 created no planner tasks.

**JSON export** (`src/main/services/data.ts`): `tasks` is `tasksRepo(db).list()`, the v1 shape as
on main. `tasksV1`, `taskLists` and the planner `tasks` leave the export. The archives remain in
the database and in every backup.

## 4. On screen

- **Dock:** Tasks (T) toggles the sticky-note widget. No board, no B.
- **Tasks widget:** as v1.1 (§3.1), plus ▶ on hover or focus of an open sticky.
- **Timer:** the task picker lists open stickies, and ▶ starts focus on one.
- **Settings:** no Tasks section. The intention switch stays in Timer settings.
- **Stats overlay:** By task unchanged. **Stat widgets:** no Estimates card in the Widgets popover.

## 5. Data and IPC

- **Schema:** v5 (§3.4). `LATEST_VERSION` becomes 5.
- **Channels:**
  - `tasks:list`, `tasks:create`, `tasks:update`, `tasks:reorder`, `tasks:clearDone` (main's
    shapes: `create({text, colour})`, `update(id, {text?, colour?, done?})`, `reorder(ids)`, each
    returning `Task[]`);
  - `timer:setTask(id | null)`, `timer:startTask(id)`.
- **Removed:**
  - channel groups `planner:*`, `subtasks:*`, `lists:*`;
  - the v1.2 `tasks:*` shapes (replaced);
  - events `planner:openTask`, `planner:changed` and preload `planner.onOpenTask`, `planner.onChanged`.
- **Types:**
  - add `Task` and `TaskPatch` (main's);
  - remove `PlannerTask`, `TaskList`, `Subtask`, `RepeatRule`, `TaskKind`, `PlannerRange`,
    `ListsView`, `TaskChange`, `ListsChange`, `TaskInput`, `TaskUpdate`, `TaskMove`, `ListInput`,
    `ListPatch` and `EstimatesCardData`;
  - drop `'estimates'` from `StatCard` and `CardData`.

## 6. Accounting impact

None to appplan §5's rules. Study time is still focus-timer time only. A task change splits the
segment exactly as before. Removing the task → subject link means a task never changes the
subject; the user picks the subject. No session row is changed by the migration.

## 7. Failure and edge cases

- **Migration fails mid-way:** the transaction rolls back, and the pre-migration backup exists. The
  app shows the existing migration-failure path (unchanged).
- **The planner has a task over 500 characters:** it is truncated to 500 in the sticky. The full
  title stays in the archive.
- **The same text is a v1 sticky and a v1.2 task:** both appear. Sam ticks the duplicate and uses Clear done.
- **The held task is deleted or ticked while focus runs:** the timer keeps it until the segment
  ends, then releases it (v1.1).
- **A stat widget showed Estimates:** it disappears after v5. The other widgets stay in place.
- **A stored setting `rollTasksForward` / `revisionTags` / `revisionDays`:** ignored.

## 8. Out of scope

- Embedding Tweek, or any Tweek API link. Not planned; Tweek stays an external app.
- Due dates, subjects or lists on stickies. Not planned.
- Deleting the archive tables. Not planned; they cost nothing.
- The version bump and installer for this change. Sam's call after the merge.

## 9. Acceptance criteria

1. A v4 database migrates to v5:
   - a backup file `pre-migration-v4-*.sqlite` exists;
   - `tasks` has the v1 columns, holding the v1 archive rows (same ids) then the v4 tasks (same ids,
     text from title, default colour yellow, done kept);
   - the four `*_v4_archive` tables exist with their row counts unchanged;
   - `estimates` stat widgets are gone;
   - sessions are byte-identical.

   *Unit test (migrations.test.ts) and e2e on Windows.*
2. After v5, a new task's id is above every archived id and every `sessions.task_id`. *Unit test.*
3. A v3 database migrates to v5 with its v1 stickies back and no duplicates. *Unit test.*
4. The Tasks widget adds, ticks, edits, recolours, reorders (drag and Alt + arrows) and clears
   done, and it persists across a relaunch. *Restored unit tests and `e2e/tasks.spec.ts` on Windows.*
5. ▶ on an open sticky starts focus on it. The session row gets that `task_id` and `task_text`,
   and the subject is unchanged. Done stickies have no ▶. *Unit tests (controller, TaskNote) and e2e.*
6. The timer picker lists open stickies, and picking one splits the segment. A done or deleted held
   task leaves after the segment. *Unit tests (controller, TaskSelect).*
7. B does nothing, and there is no board overlay, no Settings → Tasks section and no Estimates card.
   *Unit tests (Shell, SettingsOverlay, WidgetsPopover) and an e2e check.*
8. No file imports `src/renderer/planner`, `src/core/planner`, `src/shared/planner` or `@dnd-kit`.
   *`grep` in the final task, and `./check.sh` green.*
9. The JSON export has `tasks` in the v1 shape and no `tasksV1` / `taskLists`. *Unit test (data.test.ts).*
10. The surviving v1.2 features work: deadlines, notes, stat widgets, intention, the pop-up layering
    test, and the YouTube Auto badge. *Existing unit tests and the moved e2e tests.*
11. 👤 Sam's real data migrates and looks right. *Hand-walk.*

## 10. Hand-walk

1. Quit StudyAt. Install the build (or `scripts/win.sh npm run dev` on the worktree mirror against
   a copy of the data folder, if you want a dry run first).
2. Launch. Open Tasks (T). Your old v1.1 stickies are there, followed by any v1.2 planner tasks.
   Done ones sit under "Done (n)".
3. Add "Test task", tick it, untick it, change its colour, drag it to the top, then Clear done.
4. Hover a sticky and press ▶. Focus starts with that task in the timer picker. Stop the timer.
5. Open Stats → By task. The history is unchanged.
6. Press B: nothing happens. Settings has no Tasks section. The Widgets popover has no Estimates.
7. Check that `backups/` in the data folder has a `pre-migration-v4-…sqlite`.

## 11. Open questions

None.
