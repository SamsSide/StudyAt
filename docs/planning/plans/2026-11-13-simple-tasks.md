# Simple tasks — implementation plan

> Execute with `study-plan-execute` (self-contained; no superpowers skills). Steps use `- [ ]`.

**Goal:** remove the v1.2 Tweek-style planner and bring back the v1.1 sticky-note Tasks widget
(with ▶ to start focus on a task). Migration v5 returns the old stickies and the planner's tasks as
stickies, and keeps the planner tables as archives.
**Spec:** `docs/planning/specs/2026-11-13-simple-tasks-design.md` (the spec wins where they disagree).
**Roadmap:** V1.2 (replaces its planner before merge).
**Worktree:** `/home/samuel/dev/StudyAt/.claude/worktrees/feat-v1-2`, branch `worktree-feat-v1-2`.
Windows mirror for this worktree: `STUDYAT_WIN_DIR=/mnt/c/Users/samue/dev/StudyAt-v1-2`.

## Global Constraints

- Only focus-timer time is study time; nothing here changes appplan §5. **No session row is
  written, updated or deleted by migration v5.**
- Shipped migrations v1–v4 are never edited. v5 is appended. `LATEST_VERSION` becomes **5**.
- Pre-migration backup: unchanged code path (`migrate()` copies to `backups/pre-migration-v<from>-<stamp>.sqlite`).
- v5 archive names, verbatim: `planner_tasks_v4_archive`, `task_lists_v4_archive`,
  `task_tags_v4_archive`, `subtasks_v4_archive`. `tasks_v1_archive` is kept as it is.
- v5 `tasks` table, verbatim: `id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, colour TEXT
  NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT
  NULL, done_at INTEGER NULL`.
- Planner task → sticky:
  - `text = substr(title, 1, 500)`
  - `colour = coalesce(colour, 'yellow')`
  - `done_at = CASE WHEN done = 1 THEN coalesce(done_at, updated_at) ELSE NULL END`
  - `sort = base + ROW_NUMBER() OVER (ORDER BY day IS NULL, day, sort, id) - 1`, where `base =
    coalesce(max(sort) + 1, 0)` over the copied v1 rows
- The ids of v1 archive rows and planner rows are kept. The `tasks` sequence is set to the largest of:
  - `max(tasks.id)`
  - the `planner_tasks_v4_archive` and `tasks_v1_archive` `sqlite_sequence` values
  - `max(sessions.task_id)`
- v5 deletes `stat_widgets` rows with `card = 'estimates'`.
- Task API (main's v1.1 shape):
  - `tasks.list(): Task[]`
  - `create({text, colour}): Task[]`
  - `update(id, TaskPatch): Task[]`
  - `reorder(ids): Task[]`
  - `clearDone(): Task[]`
  - channels `tasks:list|create|update|reorder|clearDone`
- Timer: `timer.setTask(taskId | null)` and `timer.startTask(taskId)` keep their channel names. No
  subject travels with a task, and a task never changes the timer's subject. Unknown task id →
  `IpcValidationError(TASK_GONE)`.
- Copy, verbatim:
  - ▶ `aria-label`: **`Start focus on "<text>"`**
  - break notice: **"Task set for your next focus."** (`NEXT_FOCUS_NOTE`)
  - gone notice: **"That task no longer exists."** (`TASK_GONE`)
  - v1.1 copy as on `main`: "Add a task…", "Done (n)", "Clear done", "No tasks yet."
- `src/shared/limits.ts` holds, with the same names and values:
  - `MAX_POPPED_NOTES = 12`
  - `MAX_STAT_WIDGETS = 6`
  - `DEADLINE_TITLE_MAX = 120`
  - `DEADLINE_NOTE_MAX = 5000`
  - `INTENTION_MAX = 140`
  - `TASK_GONE = 'That task no longer exists.'`
  - `NEXT_FOCUS_NOTE = 'Task set for your next focus.'`
  - `LIMIT_COPY = { notes: 'Up to 12 notes on the screen', statWidgets: 'Up to 6 stats widgets' } as const`

  `src/shared/planner.ts` is deleted.
- Removed outright:
  - the board overlay, the **B** key, `Overlay`'s `full` prop and `.scrimFull`/`.dialogFull`;
  - `src/renderer/planner/**`, `src/core/planner/**`;
  - planner services, repos and reminders;
  - Settings → Tasks;
  - settings `rollTasksForward`, `revisionTags`, `revisionDays`;
  - the `'estimates'` stat card;
  - `date-watch`'s `newStudyDay`;
  - planner list seeding;
  - `@dnd-kit/core`, `@dnd-kit/sortable`.
- Untouched: deadlines, notes and pop-outs, other stat cards, session intention and outcome,
  countdown pips, YouTube quality, background play/pause, Spotify.
- Electron security rules unchanged. No native modules. British English. Commits authored by Sam
  only: **no `Co-Authored-By`, no `Claude-Session`, no "Generated with"**. Never push.

## Review Focus

- **Migration v5 on real-shaped data:**
  - a v4 database whose `tasks` has null colours, done rows without `done_at`, day and list tasks,
    titles over 500 characters;
  - `sqlite_sequence` rows after `ALTER TABLE … RENAME`, so the new `tasks` row must be inserted,
    not assumed;
  - a v3 database going through v4 and v5 in one launch.
- **Sequence collisions:** a sticky created after v5 must not reuse any id in either archive or in
  `sessions.task_id`, or By-task stats would merge unrelated history.
- **The timer release path:** `onTasksChanged` must fire on tick, untick and `clearDone` so a held
  task leaves when no focus segment is open. A held task ticked mid-focus stays until the segment ends.
- **Removal leftovers:** these all fail at runtime, not at typecheck:
  - a dangling preload event method;
  - a renderer store still calling `planner.*`;
  - `src/renderer/test/setup.ts` importing `resetDragGuard`;
  - `index.ts` still starting reminders or roll-forward;
  - an e2e still pressing `b`.

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `src/main/db/migrations.ts`, `migrations.test.ts`, `src/main/db/db.test.ts` | 1 | v5 and its tests; v4 tests pinned to v4 |
| `src/main/db/repos/tasks.ts`, `tasks.test.ts` (restored from `main`) | 1 | sticky repo and `onTasksChanged` |
| `src/main/db/repos/plannerTasks.ts`(+test), `taskLists.ts`(+test) | 1 | deleted |
| `src/main/db/seed.ts`, `seed.test.ts` | 1 | no list seeding |
| `src/main/services/data.ts`, `data.test.ts` | 1 | JSON export `tasks` in v1 shape |
| `src/shared/limits.ts` (new); `src/shared/planner.ts`(+test) deleted | 2 | surviving constants |
| `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/settings.ts`(+test) | 2 | contract |
| `src/preload/api.ts`, `api.test.ts` | 2 | no planner events |
| `src/main/ipc.ts`, `ipc.test.ts` | 2 | tasks handlers, timer task handlers |
| `src/main/timer/controller.ts`, `controller.test.ts` | 2 | no subject on task change |
| `src/main/index.ts`, `notify.ts`(+test), `date-watch.ts`(+test) | 2 | no reminders, no roll forward |
| `src/main/reminders.ts`(+test), `src/main/services/planner.ts`(+test), `taskWrites.ts`(+test), `src/core/planner/**` | 2 | deleted |
| `src/main/services/stats.ts`(+test), `statWidgets.ts`(+test), `deadlines.ts`, `src/core/stats/cards.ts`(+test) | 2 | no estimates card; imports from limits |
| `src/renderer/**` (listed in Task 3), `package.json`, `package-lock.json` | 3 | sticky widget, ▶, removals |
| `e2e/**` | 4 | e2e sources |
| Windows run, screenshots | 5 | proof |
| `docs/planning/appplan.md`, `roadmap.md`, v1.2 spec §12, `docs/planning/plans/2026-11-13-simple-tasks-verification.md` | 6 | docs |

## Batches

- **Batch A (parallel, one whole-tree gate):** Tasks 1, 2, 3 and 4. They share no file. None
  compiles alone, because each depends on the contract pinned under "Interfaces". So each agent
  runs only its scoped tests (listed per task), and the dispatcher runs `./check.sh` once all four
  return. Commit one commit per task if the files separate cleanly, else one commit naming Tasks 1–4.
  - **Task 4 is a disk-only `study-testing` task:** it edits `e2e/` sources and runs
    `npm run typecheck` only. It never runs `scripts/win.sh`, so it may sit in a disk batch. Task 3
    runs `npm uninstall`. Task 4 must not install anything.
- **Then Task 5** (`study-testing`, alone, run lane).
- **Then Task 6** (`main`).

---

## Task 1: Storage — migration v5, the sticky repo, seed and export

**Agent:** `study-core` (Opus: migration).
**Files:**
- `src/main/db/migrations.ts`, `migrations.test.ts`, `src/main/db/db.test.ts`;
- restore `src/main/db/repos/tasks.ts` and `tasks.test.ts` from `main`;
- delete `src/main/db/repos/plannerTasks.ts`, `plannerTasks.test.ts`, `taskLists.ts`, `taskLists.test.ts`;
- `src/main/db/seed.ts`, `seed.test.ts`, `src/main/services/data.ts`, `data.test.ts`.

**Interfaces consumed (Task 2 adds them, verbatim):**
- `src/shared/types.ts`: `export interface Task { id: number; text: string; colour: TaskColour;
  done: boolean; sort: number; createdAt: number; doneAt: number | null; }`
- `src/shared/ipc.ts`: `export interface TaskPatch { text?: string; colour?: TaskColour; done?: boolean; }`

**Interfaces produced (Task 2's `ipc.ts` and `controller.ts` use them):**
- `src/main/db/repos/tasks.ts`: `export interface TasksRepo { list(): Task[]; create(input: { text:
  string; colour: TaskColour }, now: number): Task; update(id: number, patch: TaskPatch, now: number):
  Task | null; reorder(ids: number[]): void; clearDone(): void; }`
- `export function tasksRepo(db: Db): TasksRepo`
- `export function onTasksChanged(db: Db, fn: () => void): () => void`

All three are exactly as on `main`. Add one method, `get(id: number): Task | null` (a
`SELECT * FROM tasks WHERE id = ?`), used by the controller and by IPC.

Steps:
- [ ] `git checkout main -- src/main/db/repos/tasks.ts src/main/db/repos/tasks.test.ts`. Add
  `get(id)` to the interface and the object (reuse the existing private `byId`). Add a test:
  `it('get returns one task by id, or null', …)`.
- [ ] Write the failing migration tests in `migrations.test.ts`. Build old databases the way the v4
  test at line 191 does: `migrate(raw, null, NOW, MIGRATIONS.filter((m) => m.version <= 4))`.
  ```ts
  it('v5 brings the v1 stickies and the planner tasks back as stickies, archives the planner, drops estimates widgets', async () => {
    // v4 db: tasks_v1_archive rows (1,'A','yellow',0,0) (2,'B','pink',1,1, done_at 50);
    // planner tasks: id 10 day '2026-11-12' title 'Day task' colour NULL done 0 sort 0;
    //                id 11 day '2026-11-10' title 'Earlier' colour 'blue' done 1 done_at NULL updated_at 77 sort 0;
    //                id 12 list Inbox title 'x'.repeat(600) colour 'green' done 0 sort 0;
    // a subtask and a tag on id 10; a stat_widgets row card 'estimates' and one card 'streak';
    // a session with task_id 40, task_text 'Lab 7'.
    // migrate to latest via openTestDb.
    expect(schemaVersion(db.raw)).toBe(5);
    expect(columns('tasks')).toEqual(['id', 'text', 'colour', 'done', 'sort', 'created_at', 'done_at']);
    expect(rows('SELECT id, text, colour, done, sort, done_at FROM tasks ORDER BY sort')).toEqual([
      { id: 1, text: 'A', colour: 'yellow', done: 0, sort: 0, done_at: null },
      { id: 2, text: 'B', colour: 'pink', done: 1, sort: 1, done_at: 50 },
      { id: 11, text: 'Earlier', colour: 'blue', done: 1, sort: 2, done_at: 77 },
      { id: 10, text: 'Day task', colour: 'yellow', done: 0, sort: 3, done_at: null },
      { id: 12, text: 'x'.repeat(500), colour: 'green', done: 0, sort: 4, done_at: null },
    ]);
    for (const t of ['planner_tasks_v4_archive', 'task_lists_v4_archive', 'task_tags_v4_archive', 'subtasks_v4_archive', 'tasks_v1_archive'])
      expect(count(t)).toBe(countsBefore[t]);
    expect(rows("SELECT card FROM stat_widgets")).toEqual([{ card: 'streak' }]);
    expect(sessionsBytes()).toEqual(sessionsBytesBefore); // SELECT * FROM sessions ORDER BY id, JSON-stringified
    expect(existsSync(join(dir, 'backups', 'pre-migration-v4-2026-11-08-120000.sqlite'))).toBe(true);
  });
  it('v5 sets the task sequence above every archived id and every sessions.task_id', …);
  // planner sequence 30, a session task_id 40 → tasksRepo(db).create(...).id === 41.
  it('a v3 database migrates through v4 and v5 with its stickies back once', …);
  // v3 tasks A, B → after latest: tasks has exactly A, B (same ids), planner archive empty.
  it('a v5 that fails after its last step leaves the v4 database as it was', …);
  // mirror the existing v4 rollback test at line 375 with version 5.
  ```
  Use small local helpers (`columns`, `rows`, `count`) in the test file.
- [ ] Pin the existing v4 tests to v4. Where they call `openTestDb` and then assert the v4 `tasks`
  shape, migrate with `MIGRATIONS.filter((m) => m.version <= 4)` on a raw database instead (the
  pattern at line 198). Change `expect(LATEST_VERSION).toBe(4)` to the filtered form. Update
  `'a fresh install goes straight to v4 …'` to v5: `tasks` has the v1 columns, the four
  `*_v4_archive` tables exist and are empty. Fix `db.test.ts:59-60` the same way.
- [ ] Run `npx vitest run src/main/db` and see the v5 tests fail (`expected 4 to be 5`).
- [ ] Append `{ version: 5, up(db) { … } }` to `MIGRATIONS`. Follow the spec §3.4 steps 1–6 in
  order, and use the Global Constraints SQL verbatim. For the sequence use the v4 block at lines
  190–205 as the pattern, reading `sqlite_sequence` rows named `planner_tasks_v4_archive` and
  `tasks_v1_archive`. Write a header comment citing the spec §3.4.
- [ ] `seed.ts`: remove the Inbox and per-subject `task_lists` seeding (lines 48–70, imports 4–5)
  and its tests (`seed.test.ts` 63–91).
- [ ] `data.ts`: the JSON export's `tasks` is `tasksRepo(db).list()`. Remove `archivedStickyTasks`,
  `taskLists`, `tasksV1` and the planner imports. `data.test.ts`:
  `expect(exported.tasks[0]).toEqual({ id, text, colour, done, sort, createdAt, doneAt })` and
  `expect('tasksV1' in exported).toBe(false)`, `expect('taskLists' in exported).toBe(false)`.
- [ ] Delete `plannerTasks.ts`, `taskLists.ts` and their tests.
- [ ] Scoped gate: `npx vitest run src/main/db src/main/services/data.test.ts`, green (the whole
  tree compiles only after Batch A).
- [ ] Commit (with the batch): `feat(db): migration v5 brings back sticky tasks and archives the planner`.

## Task 2: Contract and main process — types, IPC, timer, no planner services

**Agent:** `study-core` (Opus: timer).
**Files:**
- `src/shared/limits.ts` (new); delete `src/shared/planner.ts` and `planner.test.ts`;
- `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/settings.ts`, `settings.test.ts`;
- `src/preload/api.ts`, `api.test.ts`;
- `src/main/ipc.ts`, `ipc.test.ts`;
- `src/main/timer/controller.ts`, `controller.test.ts`;
- `src/main/index.ts`, `notify.ts`, `notify.test.ts`, `date-watch.ts`, `date-watch.test.ts`;
- delete `src/main/reminders.ts`, `reminders.test.ts`, `src/main/services/planner.ts`,
  `planner.test.ts`, `taskWrites.ts`, `taskWrites.test.ts` and all of `src/core/planner/`;
- `src/main/services/stats.ts`, `stats.test.ts`, `statWidgets.ts`, `deadlines.ts`;
- `src/core/stats/cards.ts`, `cards.test.ts`.

**Interfaces produced (verbatim; Tasks 1, 3 and 4 rely on them):**
- `src/shared/limits.ts`: the constants in Global Constraints, exactly.
- `src/shared/types.ts`:
  - add `Task` (as in Task 1);
  - remove `RepeatRule`, `TaskKind`, `Subtask`, `PlannerTask`, `TaskList`, `PlannerRange`,
    `ListsView`, `TaskChange`, `ListsChange`, `TaskInput`, `TaskUpdate`, `TaskMove`, `ListInput`,
    `ListPatch`, `EstimatesCardData`;
  - drop `'estimates'` from `StatCard` and `CardData`;
  - drop `rollTasksForward`, `revisionTags`, `revisionDays` from `Settings`.
- `src/shared/ipc.ts`:
  - add `TaskPatch`;
  - replace the v1.2 `tasks` group in `StudyAtApi` with `tasks: { list(): Promise<Task[]>;
    create(input: { text: string; colour: TaskColour }): Promise<Task[]>; update(id: number, patch:
    TaskPatch): Promise<Task[]>; reorder(ids: number[]): Promise<Task[]>; clearDone(): Promise<Task[]>; }`;
  - `CHANNELS.tasks = { list: 'tasks:list', create: 'tasks:create', update: 'tasks:update',
    reorder: 'tasks:reorder', clearDone: 'tasks:clearDone' }`;
  - remove the `planner`, `subtasks` and `lists` groups and channels, and `events.plannerOpenTask`
    and `events.plannerChanged`;
  - keep `timer.setTask(taskId: number | null)` and `timer.startTask(taskId: number)`, with doc
    comments updated (no subject).
- `src/preload/api.ts`: no `planner.onOpenTask` / `planner.onChanged`.

**Interfaces consumed:** Task 1's `tasksRepo`, `onTasksChanged`, `TasksRepo` (with `get`).

Steps:
- [ ] Write failing tests first:
  - `controller.test.ts`:
    - `it('startTask from idle Focus sets the task and starts focus; the subject is unchanged', …)`:
      setSubject(3), startTask(9, 'Lab 7'), then `state.status === 'running'`, `state.taskId === 9`,
      `state.subjectId === 3`, and the open row has `task_id 9`, `task_text 'Lab 7'`, `subject_id 3`.
    - `it('startTask in an idle break switches to Focus and starts', …)`.
    - `it('startTask during a running break only sets the task', …)`.
    - `it('a held task ticked off leaves the timer once no focus segment is open', …)`: use
      `tasksRepo(db).update(id, { done: true }, now)`, which fires `onTasksChanged`.
  - `ipc.test.ts`:
    - `it('timer.setTask snapshots the sticky text and rejects an unknown id with TASK_GONE', …)`;
    - `it('tasks.create/update/reorder/clearDone return the full list', …)`, adapted from main's
      tests (`git show main:src/main/ipc.test.ts`);
    - delete the `describe('planner tasks (v1.2 spec §5)')` block.
  - `api.test.ts`: `expect(Object.keys(api)).not.toContain('planner')`,
    `expect(api).not.toHaveProperty('subtasks')`, `expect(api).not.toHaveProperty('lists')`, and
    `expect(Object.keys(api.tasks).sort()).toEqual(['clearDone', 'create', 'list', 'reorder', 'update'])`.
  - `settings.test.ts`: remove the `revisionTags` / `revisionDays` / `rollTasksForward` tests (340–351);
    add `expect('rollTasksForward' in DEFAULT_SETTINGS).toBe(false)`.
  - `stats.test.ts`, `cards.test.ts`: delete the estimates tests, and add
    `expect(STAT_CARDS).not.toContain('estimates')` in the `statWidgets` tests.
- [ ] Run `npx vitest run src/main/timer src/main/ipc.test.ts src/preload src/shared` and see them fail.
- [ ] Implement:
  - `limits.ts`. Repoint every main- and shared-side import of `shared/planner` to `shared/limits`
    (ipc.ts, controller.ts, deadlines.ts, statWidgets.ts).
  - Delete `planner.ts`.
  - The contract above.
  - `controller.ts`:
    - import `onTasksChanged, tasksRepo, type TasksRepo` from `../db/repos/tasks`;
    - `setTask(id: number | null, text: string | null)` and `startTask(id: number, text: string)`;
    - `changeTask(id, text, now)`: a task change splits the row, and fills an empty intention when
      the setting is on, as now;
    - delete the `subjectId` paths;
    - `releaseFinishedTask` uses `this.tasks.get(id)`.
  - `ipc.ts`:
    - restore main's `taskPatch` validator and the `C.tasks.*` handlers (main lines 433–456, text
      `assertStr(…, { nonEmpty: true })` and max 500 via the existing trim/clamp, colour
      `assertEnum(…, TASK_COLOURS)`);
    - `setTask` / `startTask` look up `tasks.get(id)`, throw `IpcValidationError(TASK_GONE)` when
      it is null, and pass `(row.id, row.text)`;
    - remove every planner, subtask and list validator and handler (inventory: lines 8–97, 305–452,
      519, 533–534, 591–610, 671–701, 909–910), keeping any helper that a surviving handler still uses.
  - `index.ts`: remove the reminder start/stop, the roll-forward and `startStudyDay` block
    (398–419), `notify`'s `onOpenTask`, and `newStudyDay` passed to `watchDateChange`.
  - `notify.ts`: remove `notifyReminder`, `onOpenTask` and the `taskId` parameter.
  - `date-watch.ts`: remove `newStudyDay` and its tests (114, 134).
  - Stats: remove `estimatesCard`, `EstimateTask`, `TOP_OVERRUNS`, `case 'estimates'`, and
    `'estimates'` from `STAT_CARDS`.
  - Delete `reminders.ts`, `services/planner.ts`, `taskWrites.ts`, `src/core/planner/` and their tests.
- [ ] Scoped gate: `npx vitest run src/main src/shared src/preload src/core`, green except
  failures caused only by renderer files (none expected in these dirs).
- [ ] Commit (with the batch): `refactor(main): remove the planner services and restore the sticky task contract`.

## Task 3: Renderer — the sticky widget with ▶, and the planner UI gone

**Agent:** `study-ui`.
**Files:**
- restore from `main`: `src/renderer/tasks/TasksWidget.tsx`, `TaskNote.tsx`,
  `TasksWidget.module.css`, `TasksWidget.test.tsx`, `src/renderer/timer/TaskSelect.tsx`;
- `src/renderer/tasks/taskColours.ts` (comment only);
- delete all of `src/renderer/planner/` and `src/renderer/settings/sections/TasksSection.tsx`
  (+ `.module.css`);
- shell and registry: `registry.tsx`, `App.tsx`, `shell/store.ts`, `shell/Shell.tsx`,
  `shell/Shell.test.tsx`, `shell/Overlay.tsx`, `shell/shell.module.css`, `shell/useShortcuts.ts`,
  `shell/WidgetsPopover.tsx` and its test, `shell/testRegistry.tsx`;
- settings: `settings/SettingsOverlay.tsx`, `SettingsOverlay.test.tsx`;
- stats and stat widgets: `stats/SessionsTable.tsx`, `stats/stats.test.tsx`,
  `statWidgets/StatWidget.tsx`, `statWidgets/cards.tsx`, `statWidgets/statWidgets.test.tsx`,
  `statWidgets/statWidgetsStore.ts`;
- other widgets: `deadlines/DeadlinesWidget.tsx`, `deadlines/DeadlineForm.tsx`,
  `notes/NotesWidget.tsx`, `notes/notesStore.ts`;
- timer: `timer/IntentionField.tsx`, `timer/Timer.test.tsx`;
- test support: `test/mockApi.ts`, `test/mockApi.test.ts`, `test/setup.ts`;
- `package.json`, `package-lock.json`.

**Interfaces consumed:** Task 2's contract and `src/shared/limits.ts` (verbatim in Global Constraints).

Steps:
- [ ] `git checkout main -- src/renderer/tasks/TasksWidget.tsx src/renderer/tasks/TaskNote.tsx
  src/renderer/tasks/TasksWidget.module.css src/renderer/tasks/TasksWidget.test.tsx
  src/renderer/timer/TaskSelect.tsx`. In `TaskSelect`, catch a rejected `timer.setTask` and show
  `TASK_GONE` the way the v1.2 version did (read it in `git show HEAD:src/renderer/timer/TaskSelect.tsx`
  before overwriting), then refetch the list.
- [ ] Write failing tests in `TasksWidget.test.tsx`:
  ```ts
  it('an open sticky shows ▶ labelled Start focus on "<text>" and it calls timer.startTask', async () => {
    // mock tasks.list → [{ id: 5, text: 'Lab 7', colour: 'yellow', done: false, ... }]
    await user.click(screen.getByRole('button', { name: 'Start focus on "Lab 7"' }));
    expect(api.timer.startTask).toHaveBeenCalledWith(5);
  });
  it('a done sticky has no ▶', …); // queryByRole('button', { name: /^Start focus on/ }) inside "Done tasks" is null
  it('▶ during a running break shows "Task set for your next focus."', …); // startTask resolves { mode: 'shortBreak', status: 'running', … }
  it('▶ on a task that is gone shows "That task no longer exists." and reloads', …); // startTask rejects → tasks.list called again
  ```
  In `Shell.test.tsx`: replace the B tests (361–380, 409) with
  `it('B opens nothing', …)` → after `user.keyboard('b')`, `screen.queryByRole('dialog')` is null.
  In `SettingsOverlay.test.tsx`: replace 903–1001 with
  `it('has no Tasks section', …)` → `queryByRole('tab', { name: 'Tasks' })` is null (match
  however sections are exposed today).
  In `WidgetsPopover` / `statWidgets.test.tsx`: no option named "Estimates".
- [ ] Run `npx vitest run src/renderer/tasks src/renderer/shell src/renderer/settings` and see them fail.
- [ ] Implement:
  - `TaskNote`:
    - add an optional `onStart?: (task: Task) => void` prop. When it is set and `!task.done`,
      render after the text, before the colour button: `<button type="button"
      className={styles.start} data-control="start" aria-label={`Start focus on "${task.text}"`}
      onClick={() => onStart(task)}>▶</button>`;
    - `.start` is shown when `.note:hover` or `.note:focus-within`, and hidden otherwise with the
      clip pattern (never `display:none`) so Tab reaches it;
    - add `start` to the Alt + Up / Down `data-control` focus restore.
  - `TasksWidget`:
    - pass `onStart`, calling `window.studyat.timer.startTask(id)`;
    - on resolve, set the notice to `NEXT_FOCUS_NOTE` when `state.status !== 'idle' && state.mode
      !== 'focus' && state.mode !== 'countdown'`, else clear it;
    - on reject, log through the existing error helper, set the notice to `TASK_GONE` and reload
      the list;
    - render the notice as `<p role="status">` under the add box, cleared on the next ▶ or add.
  - `registry.tsx`: `tasks: TasksWidget`, and no `tasks` overlay. `App.tsx`: drop `usePlannerEvents`.
  - `store.ts`: `'tasks'` leaves `OverlayId`.
  - `Shell.tsx`: drop `OVERLAY_TITLES.tasks` and `full`.
  - `Overlay.tsx`: drop the `full` prop. `shell.module.css`: drop `.scrimFull` and `.dialogFull`.
  - `useShortcuts.ts`: drop the `B` entry and the `'b'` exceptions.
  - `testRegistry.tsx`: drop the `tasks` overlay stub.
  - `SettingsOverlay.tsx`: drop the Tasks section. Delete `TasksSection.tsx` and its CSS.
  - `SessionsTable.tsx` and `DeadlinesWidget.tsx`: drop the `usePlannerStore` reloads.
  - Stat widgets: drop `EstimatesCard` and the `.estimates` CSS.
  - Repoint every renderer import of `shared/planner` to `shared/limits` (WidgetsPopover,
    statWidgetsStore, NotesWidget, notesStore, IntentionField, DeadlineForm, TaskSelect, Timer.test).
  - `mockApi.ts`: main's `tasks: { list, create, update, reorder, clearDone }` (`git show
    main:src/renderer/test/mockApi.ts`), `timer.startTask`, and no planner, subtasks, lists or emitters.
  - `setup.ts`: remove the `resetDragGuard` import and call.
  - `taskColours.ts`: comment "They serve tasks and notes."
  - Delete `src/renderer/planner/`.
  - In WSL, run `npm uninstall @dnd-kit/core @dnd-kit/sortable`. It changes `package.json` and
    `package-lock.json`; never run it through `win.sh`.
- [ ] Scoped gate: `npx vitest run src/renderer`, green.
- [ ] Commit (with the batch): `feat(tasks): bring back the sticky-note Tasks widget with ▶ and remove the planner UI`.

## Task 4: e2e sources (disk only)

**Agent:** `study-testing`, **disk-only in Batch A**: edit `e2e/` files, run `npm run typecheck`
for the e2e project only (`npx tsc --noEmit -p tsconfig.e2e.json`). **Never run `scripts/win.sh`
or install anything** in this task.
**Files:**
- restore `e2e/tasks.spec.ts` from `main`;
- delete `e2e/v1-2-planner.spec.ts` and `e2e/v1-2-tweek-feel.spec.ts`;
- new `e2e/v1-2-misc.spec.ts`;
- edit `e2e/v1-2-shell.spec.ts`, `e2e/v1-1.spec.ts`, `e2e/shots.spec.ts`, `e2e/migration.spec.ts`.

**Interfaces consumed:** Task 2's `tasks` API (`window.studyat.tasks.create({ text, colour })`
returns `Task[]`). Task 3's ▶ label `Start focus on "<text>"`. Task 1's v5 archive names.

Steps:
- [ ] `git checkout main -- e2e/tasks.spec.ts`. Check it against the current `fixtures.ts`
  (`launch`, `dataDir`, `prepare`, `shot`) and adapt the imports only.
- [ ] Add to `e2e/tasks.spec.ts`:
  `test('▶ on a sticky starts focus on it; the session row has the task and the subject is unchanged', …)`.
  Seed a subject and pick it in the timer. Create the sticky "Lab 7", hover it and click
  `Start focus on "Lab 7"`. Wait until the timer is running, then pause. `queryDb` for the open
  session: `task_text === 'Lab 7'` and `subject_id` is the picked subject. Done stickies show no ▶.
- [ ] New `e2e/v1-2-misc.spec.ts`. Move these two tests from `v1-2-planner.spec.ts` with the
  helpers they need, seeding tasks with `tasks.create({ text, colour: 'yellow' })`:
  - `'pop-ups over another widget: the timer task picker and the stats menu are opaque and on top'` (line 843);
  - `'a playing 4K YouTube space switched to Auto: the badge changes promptly'` (line 1006, unchanged).
- [ ] Add to `e2e/v1-2-misc.spec.ts`:
  - `test('migration: a v4 database opens at schema 5 with a backup, stickies back and the planner archived', …)`.
    Build a v4 file with `migrate(raw, null, now, MIGRATIONS.filter((m) => m.version <= 4))` (the
    pattern of the old line-138 test), with one v1 archive row "Old sticky" and one planner task
    "Planner task". Launch, then open Tasks (T). Both stickies show, "Old sticky" first. `queryDb`
    gives `schema_version '5'`, a `pre-migration-v4-*.sqlite` exists, and `planner_tasks_v4_archive`
    has 1 row.
  - `test('B opens nothing, Settings has no Tasks section, the Widgets popover has no Estimates', …)`.
- [ ] Delete `v1-2-planner.spec.ts` and `v1-2-tweek-feel.spec.ts`.
- [ ] Edit the remaining specs:
  - `v1-2-shell.spec.ts`: delete the tests at 697 (reminder) and 741 (board shots). In the 437
    deadlines test, delete the board-chip part (506–528).
  - `v1-1.spec.ts:134-135, 655` and `shots.spec.ts:61-62`: back to `tasks.create({ text, colour })`.
    Check that the 655 tick label matches TaskNote's `Mark "<text>" as done`.
  - `migration.spec.ts:16`: expects `'5'`.
- [ ] `grep -rn "planner\.\|press('b')\|keyboard.press('b')\|Tasks board" e2e/` returns nothing.
- [ ] Scoped gate: `npx tsc --noEmit -p tsconfig.e2e.json` (clean once Batch A's contract is in).
- [ ] Commit (with the batch): `test(e2e): sticky tasks and ▶, v5 migration, planner specs removed`.

## Task 5: Prove it on Windows

**Agent:** `study-testing` (alone, run lane). `STUDYAT_WIN_DIR=/mnt/c/Users/samue/dev/StudyAt-v1-2`.
Screenshots go to `C:\Users\samue\studyat-shots\simple-tasks\`. **Never launch against Sam's real
data folder.** Every run uses the fixtures' throwaway `STUDYAT_USER_DATA`.

Steps:
- [ ] `scripts/win.sh npm ci` (the lockfile changed: dnd-kit removed).
- [ ] `scripts/win.sh npm run build`, then the full suite `scripts/win.sh npx playwright test` with
  `STUDYAT_SHOTS_DIR` set. Every test passes. Quote the summary line.
- [ ] Screenshots:
  - `tasks-widget.png`: the widget with three stickies in different colours and one done;
  - `tasks-play-hover.png`: ▶ on hover;
  - `tasks-next-focus.png`: the notice during a break;
  - `migrated.png`: after the v4→v5 e2e;
  - `timer-picker.png`: the timer picker listing stickies.
- [ ] Report the paths. Fix only e2e flakiness. An app defect goes back to the dispatcher as a
  finding, with the failing output.
- [ ] `./check.sh` (WSL) green after any e2e fix; quote it.
- [ ] Commit any e2e fixes: `test(e2e): <what>`.

## Task 6: Docs, the final sweep and the gate

**Agent:** `main`.
**Files:**
- `docs/planning/appplan.md`;
- `docs/planning/roadmap.md`;
- `docs/planning/specs/2026-11-11-v1-2-design.md` (§12 amendment only);
- new `docs/planning/plans/2026-11-13-simple-tasks-verification.md`.

Steps:
- [ ] Criterion 8: `grep -rnE "renderer/planner|core/planner|shared/planner|@dnd-kit" src e2e package.json`
  returns nothing.
- [ ] appplan:
  - **§4.5:** replace the planner text with main's "§4.5 Tasks widget (sticky notes)", plus one
    paragraph: ▶ on an open sticky starts focus on it, with the two notices verbatim. Note that
    migration v5 restored the v1 stickies and the planner tasks and archived the planner tables.
  - The feature-status row (31), §2 (57–59, 66–67), §4.1 (99–101, board), §4.4 (181–187: no
    subject from a task), §4.7 (324, Estimates), §4.9 (342–343, Settings → Tasks), §4.10 (361 `B`,
    369–373 deadline chips and "Exam in N days"), §6.4 (500–501: add v5 and the archive tables).
- [ ] v1.2 spec §12: add "2026-11-13: the planner (§3.6–§3.9, §3.10 chips, §3.12 Estimates) is
  replaced by `docs/planning/specs/2026-11-13-simple-tasks-design.md`."
- [ ] Roadmap:
  - in the V1.2 row, add "planner replaced by simple tasks (spec and plan 2026-11-13, commits a..b)";
  - remove the Tweek board feel hand-walk from *Up next* and add this spec's hand-walk;
  - check V1.3 ("iCal events on the board") and reword it to "iCal events" without the board, or
    ask Sam (clickable) if the row depends on the board.
- [ ] Verification record: commits, the quoted `./check.sh`, the e2e summary, screenshot paths,
  and the hand-walk (spec §10) as unticked boxes.
- [ ] `./check.sh` whole tree, green; quote it.
- [ ] Commit: `docs: record the move from the planner back to sticky tasks`.
- [ ] Offer the push (never push without Sam's yes).

## After the tasks: the hand-walk

Copied from spec §10.

1. Quit StudyAt. Install the build (or `scripts/win.sh npm run dev` on the worktree mirror against
   a copy of the data folder, if you want a dry run first).
2. Launch. Open Tasks (T). Your old v1.1 stickies are there, followed by any v1.2 planner tasks.
   Done ones sit under "Done (n)".
3. Add "Test task", tick it, untick it, change its colour, drag it to the top, then Clear done.
4. Hover a sticky and press ▶. Focus starts with that task in the timer picker. Stop the timer.
5. Open Stats → By task. The history is unchanged.
6. Press B: nothing happens. Settings has no Tasks section. The Widgets popover has no Estimates.
7. Check that `backups/` in the data folder has a `pre-migration-v4-…sqlite`.
