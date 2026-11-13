# Tweek board feel — implementation plan

> Execute with `study-plan-execute` (self-contained; no superpowers skills). Steps use `- [ ]`.

**Goal:** make the Tasks board and widget feel like Tweek: drag any task by its line, one click
opens a small task card (Expand for the full detail), and a click on any blank line types a new
task there.
**Spec:** `docs/planning/specs/2026-11-12-tweek-board-feel-design.md` (the spec wins where they disagree).
**Roadmap:** V1.2 (follow-up pass on the built branch).
**Worktree:** `/home/samuel/dev/StudyAt/.claude/worktrees/feat-v1-2`, branch `worktree-feat-v1-2`.
Windows mirror for this worktree: `STUDYAT_WIN_DIR=/mnt/c/Users/samue/dev/StudyAt-v1-2`.

## Global Constraints

- Renderer only. No change to `src/main`, `src/preload`, `src/shared`, the schema, IPC or settings.
- `resolveDrop`, `openOrder`, the announcements, the drag overlay and the insertion line are unchanged.
- Pointer drag activation stays `PointerSensor` `{ distance: 6 }`.
- A row click within **250 ms** after a drag ends or is cancelled is ignored.
- The keyboard grip keeps its accessible name `Move "<title>"` and its Space/arrows/Space behaviour;
  it is visually hidden (clip pattern, never `display:none` or `visibility:hidden`) until `:focus-visible`.
- Detail store: `detailMode: 'card' | 'full'`, default `'card'`; `openDetail(id, mode = 'card')`;
  `expandDetail()`; `closeDetail()` resets mode to `'card'`.
- Both modes are one dialog: `role="dialog"`, `aria-modal="true"`, `aria-label` `Task: <title>`.
- Card: `top: 72px`, centred, `width: min(420px, calc(100vw - 32px))`, `max-height: calc(100vh - 96px)`;
  backdrop `rgba(0, 0, 0, 0.45)`, inset 0; fade `var(--duration-fast)`.
- Copy, verbatim: note placeholder **"Add some extra notes here…"**; button **"Expand"**; chip
  options **"No subject"**, **"No estimate"**; read-only chip **"Focused 32m"** (format via
  `formatGoal`); disabled titles **"Repeat is for tasks on a day"**, **"Reminders are for tasks on a day"**;
  repeat menu **None · Daily · Weekdays · Weekly · Every N days…**; reminder menu input
  `aria-label="Reminder time"` and button **"Clear"**.
- Icon bar `aria-label`s: **"Add subtask"**, **"Repeat"**, **"Colour"**, **"Reminder"**, **"Start focus"**, then `TaskMenu` (its own "Task menu").
- Estimate presets are `ESTIMATE_PRESETS` (15, 30, 45, 60, 90, 120, 180).
- Board add inputs: no placeholder; `aria-label` stays `Add to <day or list name>`; focused fill `var(--hover)`, radius 6 px.
- Esc in an add input clears it, blurs it and stops propagation (the board stays open).
- Delete keeps `TaskMenu`'s in-place confirm. No undo toast.
- British English copy. Commits authored by Sam only: no `Co-Authored-By`, no `Claude-Session`, no "Generated with".

## Review Focus

- **Click after drag:** dnd-kit does not swallow the click that follows a pointer drag released
  over the same row. Check that the 250 ms guard covers drag end **and** cancel, and that the time comes from an injected `now`.
- **Row as pointer handle:** only `listeners.onPointerDown` goes on the `li`. Putting `attributes`
  on the `li` would give it `role="button"` with buttons inside it (bad a11y, broken tests).
- **Focus kept after Enter:** the add input must not remount when the first task appears above
  it (`RuledLines` renders the `ul` conditionally before it; keep the add line's element position stable, or key it).
- **Blank-line click target:** the handler must ignore clicks on rows, buttons, inputs, labels
  and links, or ticking a checkbox would steal focus to the add line.
- **Pending edits:** moving the field logic into `useTaskEditor` must keep "save pending edits on
  Esc / Close / backdrop / unmount" for both modes, and the Expand switch must not lose a half-typed note.
- **Esc layering:** Esc closes an open card menu first, then the card, then (only when no
  dialog is open) the board. An add input's Esc never closes the board.

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `src/renderer/planner/dnd.tsx` | `justDragged(now)` guard, drag end/cancel stamping, `SortableTask` pointer listeners on the row | 1 |
| `src/renderer/planner/TaskRow.tsx` | `rowPointer` prop spread on the `li`; click ignored when `justDragged` | 1 |
| `src/renderer/planner/board/BoardDay.tsx` | `DayCard` drag from the whole card + guard (Task 1); empty-sheet click focuses add input (Task 3) | 1, 3 |
| `src/renderer/planner/planner.module.css` | Row `user-select`/cursor; grip hidden until focus-visible (Task 1); add-input blank/focused look (Task 3) | 1, 3 |
| `src/renderer/planner/board/board.module.css` | Day card cursor/user-select (Task 1); ruled-area cursor (Task 3) | 1, 3 |
| `src/renderer/planner/dnd.test.ts` | `justDragged` unit tests | 1 |
| `src/renderer/planner/board/drag.test.ts` | Row pointer-drag wiring tests | 1 |
| `src/renderer/planner/plannerStore.ts` | `detailMode`, `openDetail(id, mode)`, `expandDetail` | 2 |
| `src/renderer/planner/plannerStore.test.ts` | Detail mode tests | 2 |
| `src/renderer/planner/useTaskEditor.ts` | New: drafts, `save`, save-failed, commits, flush on unmount (moved from `TaskDetail.tsx`) | 2 |
| `src/renderer/planner/TaskDetail.tsx` | Switches card/full; backdrop; full popover uses `useTaskEditor` | 2 |
| `src/renderer/planner/TaskCard.tsx` | New: the quick card | 2 |
| `src/renderer/planner/card.module.css` | New: card, backdrop, chips, icon bar, small menus | 2 |
| `src/renderer/planner/detail.module.css` | Full popover moves to `top: 72px` under the shared backdrop | 2 |
| `src/renderer/planner/TaskCard.test.tsx` | New: card tests | 2 |
| `src/renderer/planner/TaskDetail.test.tsx` | `setup` opens in `'full'`; Expand and backdrop tests | 2 |
| `src/renderer/planner/board/RuledLines.tsx` | Blank-line click focuses add input; stable add-line position | 3 |
| `src/renderer/planner/QuickAdd.tsx` | `inputRef`, `onEscape` clear+blur+stop, optional placeholder `''` | 3 |
| `src/renderer/planner/board/board.test.tsx` | Click-to-type tests; the "Add…" test becomes "no placeholder" | 3 |
| `e2e/v1-2-tweek-feel.spec.ts` | New: Windows e2e for drag, card, click-to-type, screenshots | 4 |
| `e2e/v1-2-planner.spec.ts`, `e2e/v1-2-shell.spec.ts` | Kept green: detail steps that need full-only fields press Expand | 4 |
| `docs/planning/appplan.md`, `docs/planning/specs/2026-11-11-v1-2-design.md`, `docs/planning/roadmap.md`, `docs/planning/plans/2026-11-11-v1-2-verification.md` | Record the change | 5 |

## Batches

| Batch | Tasks | Why |
| --- | --- | --- |
| A | Task 1 ∥ Task 2 | Disjoint files. Task 2 must not edit `board.test.tsx` or `PlannerWidget.test.tsx` (they find the dialog by name, which both modes keep). |
| B | Task 3 | Shares `BoardDay.tsx`, `planner.module.css`, `board.module.css` with Task 1. |
| C | Task 4 (`study-testing`, alone) | Needs all renderer work. |
| D | Task 5 (`main`) | Docs, after the e2e evidence. |

---

## Task 1: Whole-row drag and the click-after-drag guard

**Agent:** `study-ui`
**Files:** `src/renderer/planner/dnd.tsx`, `src/renderer/planner/TaskRow.tsx`,
`src/renderer/planner/board/BoardDay.tsx`, `src/renderer/planner/planner.module.css`,
`src/renderer/planner/board/board.module.css`, `src/renderer/planner/dnd.test.ts`,
`src/renderer/planner/board/drag.test.ts`
**Interfaces produced:**
- `export const DRAG_CLICK_GUARD_MS = 250;` in `dnd.tsx`
- `export function markDragEnded(now: number): void` and `export function justDragged(now: number): boolean` in `dnd.tsx` (module-level last-end stamp; `justDragged` is true when `now - last < DRAG_CLICK_GUARD_MS`; `export function resetDragGuard(): void` for tests)
- `TaskRow` prop `rowPointer?: { onPointerDown?: (e: PointerEvent<HTMLElement>) => void }` spread on the `li` (both variants)

- [ ] **Write the failing tests.** In `src/renderer/planner/dnd.test.ts` add:

```ts
import { DRAG_CLICK_GUARD_MS, justDragged, markDragEnded, resetDragGuard } from './dnd';

describe('the click-after-drag guard', () => {
  beforeEach(() => resetDragGuard());
  it('is off before any drag', () => {
    expect(justDragged(1_000)).toBe(false);
  });
  it('swallows a click up to 250 ms after a drag ends, and not after', () => {
    markDragEnded(10_000);
    expect(DRAG_CLICK_GUARD_MS).toBe(250);
    expect(justDragged(10_000)).toBe(true);
    expect(justDragged(10_249)).toBe(true);
    expect(justDragged(10_250)).toBe(false);
  });
});
```

  In `src/renderer/planner/board/drag.test.ts` (render a `PlannerDnd` with one `SortableTask` of
  `minimalPlannerTask({ id: 1, title: 'Read', day: '2026-11-11' })`, compact and full variants):

```ts
it('puts the pointer handle on the row and keeps the keyboard grip as a separate button', () => {
  const row = container.querySelector('li[data-task-id="1"]')!;
  expect(row).not.toHaveAttribute('role');            // attributes stay on the grip
  expect(row).not.toHaveAttribute('aria-roledescription');
  const grip = screen.getByRole('button', { name: 'Move "Read"' });
  expect(grip).toHaveAttribute('aria-roledescription', 'sortable');
});

it('a row click right after a drag does not open the detail; a later one does', () => {
  markDragEnded(Date.now());
  fireEvent.click(screen.getByText('Read'));
  expect(usePlannerStore.getState().detailTaskId).toBeNull();
  resetDragGuard();
  fireEvent.click(screen.getByText('Read'));
  expect(usePlannerStore.getState().detailTaskId).toBe(1);
});
```

  (Seed with `usePlannerStore.setState({ tasks: { 1: task } })` before rendering. Run both tests
  for the `'compact'` and the `'full'` variant with `it.each`.)

- [ ] **Run and see them fail:** `npx vitest run src/renderer/planner/dnd.test.ts src/renderer/planner/board/drag.test.ts`
  — expected: `justDragged` / `markDragEnded` not exported; the row-click test opens the detail.

- [ ] **Implement.**
  - `dnd.tsx`: the guard functions above. In `PlannerDnd`, call `markDragEnded(Date.now())` at the
    top of `onDragEnd` and in a new `onDragCancel`. (`Date.now()` is fine here: this is UI timing,
    not accounting.) In `SortableTask`, pass `rowPointer={{ onPointerDown: listeners?.onPointerDown }}`
    to `TaskRow`, and give the grip `{...attributes}` plus only `onKeyDown={listeners?.onKeyDown}`.
  - `TaskRow.tsx`: accept `rowPointer`, spread it on the `li` in both variants. In `onRowClick`
    return early when `justDragged(Date.now())`. The compact title's Enter/Space still opens.
  - `BoardDay.tsx` `DayCard`: the same split. `onPointerDown` on the card `li`, `attributes` +
    `onKeyDown` on the grip; `onCardClick` and the title button return when `justDragged(Date.now())`.
  - `planner.module.css`: `.row { user-select: none; cursor: pointer; }`; the grip
    (`.grip`) is visually hidden with the clip pattern (`position:absolute; width:1px; height:1px;
    overflow:hidden; clip-path: inset(50%); white-space:nowrap;`) and restored to its current
    look in its current spot on `.grip:focus-visible`. `[data-dragging='true']` rows keep their
    current dimmed look. Add `body:has([data-drag-overlay]) { cursor: grabbing; }`.
  - `board.module.css`: `.card { user-select: none; cursor: pointer; }`.

- [ ] **Run and see them pass:** the same command, then the planner suites
  `npx vitest run src/renderer/planner` — every existing keyboard-drag test stays green.
- [ ] **Gate:** `./check.sh`, whole tree, quote the summary.
- [ ] **Commit:** `feat(planner): drag a task by its whole line, like Tweek`

---

## Task 2: The quick card and detail modes

**Agent:** `study-ui`
**Files:** `src/renderer/planner/plannerStore.ts`, `src/renderer/planner/plannerStore.test.ts`,
`src/renderer/planner/useTaskEditor.ts` (new), `src/renderer/planner/TaskDetail.tsx`,
`src/renderer/planner/TaskCard.tsx` (new), `src/renderer/planner/card.module.css` (new),
`src/renderer/planner/detail.module.css`, `src/renderer/planner/TaskCard.test.tsx` (new),
`src/renderer/planner/TaskDetail.test.tsx`. Also `src/renderer/planner/revision.test.tsx` only if it
needs `openDetail(id, 'full')`. **Do not edit** `board.test.tsx` or `PlannerWidget.test.tsx`.
**Interfaces consumed:** existing `PlacementPicker`, `TagInput`, `SubtaskList`, `SAVE_FAILED`,
`TaskMenu`, `TASK_COLOURS`, `ESTIMATE_PRESETS`, `REMINDER_RE`, `formatGoal`, `startTask`.
**Interfaces produced:**
- `PlannerState.detailMode: 'card' | 'full'`; `openDetail(id: number, mode?: 'card' | 'full'): void`; `expandDetail(): void`.
- `useTaskEditor(task: PlannerTask)` in `useTaskEditor.ts` returning
  `{ title, setTitle, commitTitle, note, setNote, commitNote, reminder, setReminder, commitReminder, save, saveFailed, touch, register }`
  where `register(key, commit)` adds a field commit to the flush-on-unmount set (used by the full
  popover's custom estimate and every-N fields). The existing `useDraft`, `cap`, the save-refused
  check and the flush of dirty fields on unmount move here unchanged.

- [ ] **Write the failing tests.**
  `plannerStore.test.ts`:

```ts
it('opens a task as the card by default, expands to full, and closing resets to card', () => {
  const s = usePlannerStore.getState();
  s.openDetail(5);
  expect(usePlannerStore.getState()).toMatchObject({ detailTaskId: 5, detailMode: 'card' });
  usePlannerStore.getState().expandDetail();
  expect(usePlannerStore.getState().detailMode).toBe('full');
  usePlannerStore.getState().closeDetail();
  expect(usePlannerStore.getState()).toMatchObject({ detailTaskId: null, detailMode: 'card' });
  usePlannerStore.getState().openDetail(6, 'full');
  expect(usePlannerStore.getState().detailMode).toBe('full');
});
```

  `TaskCard.test.tsx` (copy `TaskDetail.test.tsx`'s `setup`, opening with `openDetail(task.id)`, rendering `<TaskDetail />`):

```ts
it('opens as the small card: placement, Expand, title, done, note, chips and the icon bar', () => {
  setup({ estimateMin: 60, tags: ['lecture'], actualMs: 32 * 60_000 });
  const card = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
  expect(within(card).getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  expect(within(card).getByRole('textbox', { name: 'Title' })).toHaveValue('Read chapter 4');
  expect(within(card).getByRole('checkbox', { name: 'Mark as done' })).toBeInTheDocument();
  expect(within(card).getByRole('textbox', { name: 'Note' })).toHaveAttribute('placeholder', 'Add some extra notes here…');
  const chips = within(card).getByRole('group', { name: 'Details' });
  expect(within(chips).getByRole('combobox', { name: 'Subject' })).toBeInTheDocument();
  expect(within(chips).getByRole('combobox', { name: 'Estimate' })).toHaveValue('60');
  expect(within(chips).getByText('#lecture')).toBeInTheDocument();
  expect(within(chips).getByText('Focused 32m')).toBeInTheDocument();
  for (const name of ['Add subtask', 'Repeat', 'Colour', 'Reminder', 'Start focus', 'Task menu']) {
    expect(within(card).getByRole('button', { name })).toBeInTheDocument();
  }
  // Full-only fields are not on the card.
  expect(within(card).queryByRole('group', { name: 'Colour' })).toBeNull();
});

it('saves a note and a tag from the card', async () => {
  const { api } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'pages 40-60');
  await user.tab();
  expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'pages 40-60' });
  await user.type(screen.getByRole('textbox', { name: 'Add a tag' }), 'Lecture{Enter}');
  expect(api.tasks.update).toHaveBeenCalledWith(1, { tags: ['lecture'] });
});

it('saves subject and estimate from the chips', async () => {
  const { api } = setup();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Estimate' }), '45');
  expect(api.tasks.update).toHaveBeenCalledWith(1, { estimateMin: 45 });
  const subject = seedSubjects()[0]!;
  await user.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), String(subject.id));
  expect(api.tasks.update).toHaveBeenCalledWith(1, { subjectId: subject.id });
});

it('repeat, colour and reminder menus save; Esc closes a menu, not the card', async () => {
  const { api } = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Repeat' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Weekdays' }));
  expect(api.tasks.update).toHaveBeenCalledWith(1, { repeat: { kind: 'weekdays' } });
  await user.click(screen.getByRole('button', { name: 'Colour' }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Task: Read chapter 4' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reminder' }));
  const time = screen.getByLabelText('Reminder time');
  await user.type(time, '18:30');
  await user.tab();
  expect(api.tasks.update).toHaveBeenCalledWith(1, { reminder: '18:30' });
});

it('disables Repeat and Reminder for a list task, with the reason', () => {
  setup({ day: null, listId: 10 });
  expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Repeat' })).toHaveAttribute('title', 'Repeat is for tasks on a day');
  expect(screen.getByRole('button', { name: 'Reminder' })).toHaveAttribute('title', 'Reminders are for tasks on a day');
});

it('Add subtask shows the subtask list and focuses its input', async () => {
  setup();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Add subtask' }));
  expect(screen.getByRole('textbox', { name: 'Add a subtask' })).toHaveFocus();
});

it('Start focus starts the task and closes the card', async () => {
  const { api } = setup();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Start focus' }));
  expect(api.timer.startTask).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Expand keeps a half-typed note and shows the full detail of the same task', async () => {
  const { api } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'draft');
  await user.click(screen.getByRole('button', { name: 'Expand' }));
  expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'draft' });
  const full = screen.getByRole('dialog', { name: 'Task: Read chapter 4' });
  expect(within(full).getByRole('group', { name: 'Colour' })).toBeInTheDocument();
});

it('a press on the backdrop closes the card and saves what was typed', async () => {
  const { api } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'x');
  fireEvent.pointerDown(document.querySelector('[data-detail-backdrop]')!);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.tasks.update).toHaveBeenCalledWith(1, { note: 'x' });
});
```

  (The mock API is `src/renderer/test/mockApi.ts`: `api.tasks.update`, `api.timer.startTask`.)

  `TaskDetail.test.tsx`: change `setup` to `openDetail(task.id, 'full')` so every existing full-detail
  test keeps testing the full popover; add `it('the full detail sits over the same backdrop', …)`
  asserting `document.querySelector('[data-detail-backdrop]')` exists.

- [ ] **Run and see them fail:** `npx vitest run src/renderer/planner/plannerStore.test.ts src/renderer/planner/TaskCard.test.tsx src/renderer/planner/TaskDetail.test.tsx`
  — expected: `expandDetail` not a function; no "Expand" button.

- [ ] **Implement.**
  - `plannerStore.ts`: add `detailMode` (initial `'card'`, also in `resetPlannerStore`),
    `openDetail: (id, mode = 'card') => set({ detailTaskId: id, detailMode: mode })`,
    `expandDetail: () => set({ detailMode: 'full' })`,
    `closeDetail: () => set({ detailTaskId: null, detailMode: 'card' })`.
  - `useTaskEditor.ts`: move the field logic out of `Popover` as described in Interfaces.
  - `TaskDetail.tsx`: keep the fetch-missing-task and document Esc effects. Render, in one portal,
    `<div className={card.backdrop} data-detail-backdrop="" />` then `TaskCard` (mode `'card'`) or
    the existing `Popover` (mode `'full'`), keyed on `task.id` + mode so Expand remounts the dialog (the
    card's unmount flushes pending edits). The outside-press handler stays, now on the backdrop too.
  - `TaskCard.tsx`: the layout of spec §4.2, rows 1–6, with exactly the labels and copy in Global
    Constraints. Small menus are `role="menu"` panels inside the card with `menuitemradio` items
    (Repeat, Colour) or the time input + "Clear" (Reminder); each closes on a choice, on Esc
    (`preventDefault` + `stopPropagation`) and on a press elsewhere in the card. "Every N days…"
    calls `expandDetail()`. Subject chip: a native `select` with "No subject" + non-archived subjects
    (plus the task's archived one if set), with a colour dot before it. Estimate chip: "No estimate" +
    `ESTIMATE_PRESETS` labelled with `formatGoal(min * 60_000)`, plus the current custom value as
    its own option when it is not a preset. Tags: `TagInput` with `label="Add a tag"`. The icon of
    Repeat, Colour or Reminder is tinted `--accent` when set. Tab trap and dialog key handling as in `Popover`.
  - `card.module.css`: the card and backdrop per Global Constraints, using `--panel-strong`,
    `--glass-filter-strong`, `--border`, `--radius-panel`, `--shadow-lg`; fade-in animation of
    opacity over `var(--duration-fast)`. Backdrop `z-index: var(--z-overlay)`, card
    `calc(var(--z-overlay) + 1)`. Chips reuse the look of `planner.module.css` `.chip`.
  - `detail.module.css`: the full `.popover` moves from centred to `top: 72px; transform: translateX(-50%)`
    so Expand does not jump the panel.

- [ ] **Run and see them pass:** the same command, then `npx vitest run src/renderer/planner`
  (`board.test.tsx` and `PlannerWidget.test.tsx` must be green without edits; if one fails because
  it needs a full-only field, stop and report it as BLOCKED with the test name).
- [ ] **Gate:** `./check.sh`, whole tree, quote the summary.
- [ ] **Commit:** `feat(planner): open a task as a small Tweek card, with Expand for the full detail`

---

## Task 3: Click any blank line to type a task

**Agent:** `study-ui`
**Files:** `src/renderer/planner/board/RuledLines.tsx`, `src/renderer/planner/QuickAdd.tsx`,
`src/renderer/planner/board/BoardDay.tsx`, `src/renderer/planner/planner.module.css`,
`src/renderer/planner/board/board.module.css`, `src/renderer/planner/board/board.test.tsx`
**Interfaces consumed:** Task 1's `BoardDay.tsx` and CSS (built on top, not reverted).
**Interfaces produced:** `QuickAdd` props `inputRef?: Ref<HTMLInputElement>` and
`variant?: 'widget' | 'line'` (`'line'`: no placeholder, Esc clears + blurs + `stopPropagation`,
the blank/focused look); the widget's call sites keep the default `'widget'` and are unchanged.

- [ ] **Write the failing tests** in `board.test.tsx` (replace the test
  `a column quick-add says just "Add…" and keeps its "Add to <day or list>" name` with the first one):

```ts
it('a column add line shows no text and keeps its "Add to <day or list>" name', async () => {
  await renderBoard({ lists: [list()] });
  const mon = screen.getByRole('region', { name: 'Mon 9 Nov' });
  const add = within(mon).getByRole('textbox', { name: 'Add to Mon 9 Nov' });
  expect(add.getAttribute('placeholder') ?? '').toBe('');
});

it('a click on any blank line of a day focuses that day\'s add line', async () => {
  await renderBoard();
  const fri = screen.getByRole('region', { name: 'Fri 13 Nov' });
  const blanks = fri.querySelectorAll('[data-rule="blank"]');
  fireEvent.click(blanks[blanks.length - 1]!);
  expect(within(fri).getByRole('textbox', { name: 'Add to Fri 13 Nov' })).toHaveFocus();
});

it('the same for a list column, the Inbox included', async () => {
  await renderBoard({ lists: [list({ id: 1, name: 'Inbox', subjectId: null, sort: -1 }), list()] });
  const inbox = await screen.findByRole('region', { name: 'Inbox' });
  fireEvent.click(inbox.querySelectorAll('[data-rule="blank"]')[2]!);
  expect(within(inbox).getByRole('textbox', { name: 'Add to Inbox' })).toHaveFocus();
});

it('a click on a task row, its checkbox or ▶ does not move focus to the add line', async () => {
  await renderBoard({ tasks: [minimalPlannerTask({ id: 3, title: 'Read', day: '2026-11-13' })] });
  const fri = screen.getByRole('region', { name: 'Fri 13 Nov' });
  fireEvent.click(within(fri).getByRole('checkbox', { name: 'Mark "Read" as done' }));
  expect(within(fri).getByRole('textbox', { name: 'Add to Fri 13 Nov' })).not.toHaveFocus();
});

it('Enter adds the task and keeps typing on the next line', async () => {
  const api = await renderBoard();
  api.tasks.create.mockImplementation((input) =>
    Promise.resolve({ tasks: [minimalPlannerTask({ id: 50, title: input.title, day: input.day ?? null })], removed: [] }),
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const fri = screen.getByRole('region', { name: 'Fri 13 Nov' });
  fireEvent.click(fri.querySelectorAll('[data-rule="blank"]')[0]!);
  await user.keyboard('Anki{Enter}');
  await within(fri).findByText('Anki');
  const add = within(fri).getByRole('textbox', { name: 'Add to Fri 13 Nov' });
  expect(add).toHaveFocus();
  expect(add).toHaveValue('');
});

it('Esc in an add line clears it and does not close the board', async () => {
  await renderBoard();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const add = screen.getByRole('textbox', { name: 'Add to Fri 13 Nov' });
  const shellEsc = vi.fn();
  document.addEventListener('keydown', shellEsc);
  await user.click(add);
  await user.keyboard('half{Escape}');
  expect(add).toHaveValue('');
  expect(add).not.toHaveFocus();
  expect(shellEsc).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  document.removeEventListener('keydown', shellEsc);
});

it('on the board Day, a click on the empty sheet focuses its add line', async () => {
  await renderBoard();
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Day' }));
  fireEvent.click(screen.getByText('Nothing planned for this day.'));
  expect(screen.getByRole('textbox', { name: 'Add to Wed 11 Nov' })).toHaveFocus();
});
```

  (`api.tasks.create` is the mock's create; region names are `formatDayLabel(day)`, e.g. "Fri 13 Nov".)

- [ ] **Run and see them fail:** `npx vitest run src/renderer/planner/board/board.test.tsx`
  — expected: placeholder is "Add…"; blank-line clicks leave focus on the body; no `data-rule="blank"`.

- [ ] **Implement.**
  - `QuickAdd.tsx`: `inputRef` (merged with an internal ref) and `variant`. For `'line'`: no
    `placeholder` attribute; `onKeyDown` Escape → `preventDefault()`, `stopPropagation()`,
    `setText('')`, `blur()`. Enter behaviour unchanged (the input stays mounted and focused).
  - `RuledLines.tsx`: always render the `ul` (empty when there are no tasks and no hint) so the add
    line's element position never changes; blank lines get `data-rule="blank"`. An `onClick` on the
    `.ruled` container: return if `(e.target as HTMLElement).closest('li, button, input, label, a, [role="button"]')`;
    otherwise `addRef.current?.focus()`. Pass `variant="line"` and `inputRef={addRef}` to `QuickAdd`.
  - `BoardDay.tsx`: the same click rule on the `.dayBody` (focus its `QuickAdd`, `variant="line"`).
  - `planner.module.css`: for the line variant (`.addInput[data-variant='line']`): transparent
    background and no border until `:focus`, then `background: var(--hover); border-radius: 6px;`.
  - `board.module.css`: `.ruled { cursor: text; }` and rows keep `cursor: pointer`.

- [ ] **Run and see them pass:** the same command, then `npx vitest run src/renderer/planner`.
- [ ] **Gate:** `./check.sh`, whole tree, quote the summary.
- [ ] **Commit:** `feat(planner): click any blank line on the board to type a task`

---

## Task 4: Prove it on Windows

**Agent:** `study-testing` (alone in the run lane). **No synthetic OS input** (no nudgers, no
OS-level mouse tools); Playwright's own `page.mouse` against the Electron window is the input.
**Files:** `e2e/v1-2-tweek-feel.spec.ts` (new); `e2e/v1-2-planner.spec.ts` and
`e2e/v1-2-shell.spec.ts` only to keep them green.
**Interfaces consumed:** everything above. Reuse the helpers in `e2e/v1-2-planner.spec.ts`
(`seed`, `listId`, `taskOf`, `dayTitles`, the `drag` mouse helper, `boardOf`) by copying them into the new spec.

- [ ] **Write** `e2e/v1-2-tweek-feel.spec.ts` with these tests (each seeds through
  `window.studyat.tasks.create`, opens the board with **B**):
  1. *Drag by the line:* seed "Drag me" on this week's Monday; drag from the centre of its **title
     text** (not the grip) to Thursday's column; `dayTitles(Thursday)` contains it; Monday's does not. (AC 1)
  2. *Day ↔ list:* drag it from Thursday onto the Inbox column, then back to Friday; check with `taskOf`. (AC 3)
  3. *Widget:* close the board, open the widget (T) Week tab, drag a seeded task from Tuesday's
     section to Wednesday's by its title; check in main. (AC 2)
  4. *No card after a drag:* drag a row 40 px down within its own column and release; the
     `Task: <title>` dialog is not visible 500 ms later. (AC 4)
  5. *Card:* click a row once; the dialog is visible, its bounding box top is 72 ± 4 px and it is
     horizontally centred ± 4 px; type a note and add the tag `lecture`; press Esc; reopen;
     note and `#lecture` are there; `taskOf` agrees. Press Expand; the dialog shows the "Colour" group. (AC 6, 7, 10)
  6. *Click-to-type:* click the last blank line of Friday; type `Lecture 5 notes #lecture ~1h`,
     Enter, `Anki`, Enter; both are on Friday in main in that order; the add line still has focus.
     Click a blank line of the Inbox column, type `Inbox item`, Enter; it is in the Inbox. (AC 11, 12)
- [ ] **Screenshots** to `C:\Users\samue\studyat-shots\v1-2-tweek\` (absolute, outside the mirror):
  `01-board-blank-lines.png` (empty week, no text on the lines), `02-add-line-focused.png`,
  `03-two-typed.png`, `04-drag-mid.png` (overlay mid-drag), `05-quick-card.png`,
  `06-card-repeat-menu.png`, `07-expanded.png`, `08-grip-keyboard-focus.png` (Tab to a grip), `09-widget-card.png`. (AC 5, 6, 14)
- [ ] **Keep the old suites green:** run `e2e/v1-2-planner.spec.ts` and `e2e/v1-2-shell.spec.ts`.
  Where a test opens the detail and then uses a field that is only in the full detail (the
  `Colour` group, the custom estimate, every-N days, the `Repeat` select or the `Reminder` time
  field), insert a click on `Expand` after it opens. Where a test drags by `grip(...)`, leave
  it (keyboard grip still exists); a pointer drag from a visually hidden grip may fail, in which
  case change that helper to drag from the row's title text. Change nothing else.
- [ ] **Run** on Windows: `STUDYAT_WIN_DIR=/mnt/c/Users/samue/dev/StudyAt-v1-2 scripts/win.sh npm ci`
  (only if `node_modules` is stale), then
  `STUDYAT_WIN_DIR=/mnt/c/Users/samue/dev/StudyAt-v1-2 scripts/win.sh npx playwright test e2e/v1-2-tweek-feel.spec.ts e2e/v1-2-planner.spec.ts e2e/v1-2-shell.spec.ts`,
  then the whole suite `… scripts/win.sh npx playwright test`. Quote the pass/fail counts.
- [ ] **Gate:** `./check.sh`, whole tree (the e2e typecheck is in it), quote the summary.
- [ ] **Commit:** `test(e2e): drag by the line, the quick card and click-to-type on the board`

---

## Task 5: Record it

**Agent:** `main`
**Files:** `docs/planning/appplan.md` (§4.5), `docs/planning/specs/2026-11-11-v1-2-design.md` (§12),
`docs/planning/roadmap.md` (V1.2 row), `docs/planning/plans/2026-11-11-v1-2-verification.md`

- [ ] `appplan.md` §4.5: say a task is dragged by its whole line (keyboard: the `Move` grip on
  focus); one click opens the quick card (fields as spec §4.2) with Expand for the full detail;
  a click on any blank board line types a new task there; board lines show no placeholder.
- [ ] v1.2 spec §12: add the lines "Tweek board feel (Sam, 2026-11-12): whole-line drag; quick card
  with Expand; click any blank line to type; board add lines show no text (replaces 'Column add rows
  on the board say "Add…"'). See `docs/planning/specs/2026-11-12-tweek-board-feel-design.md`."
- [ ] `roadmap.md` V1.2 row: append the spec and plan paths and the new commit range; add
  `v1-2-tweek` to its screenshot folders.
- [ ] Verification record: a "Tweek board feel" section with the quoted `./check.sh` summary, the
  Windows e2e counts from Task 4, the screenshot paths, and the hand-walk below as unticked boxes for Sam.
- [ ] **Gate:** `./check.sh`, whole tree, quote the summary.
- [ ] **Commit:** `docs: record the Tweek board feel pass`

---

## After the tasks: the hand-walk (Sam, in the running app)

1. Open the board (B). Click a blank line halfway down Friday: a field appears on Friday's first
   empty line. Type "Lecture 5 notes #lecture ~1h", Enter, then "Anki", Enter. Both appear; the
   field is still active below them.
2. Click a blank line in the Inbox column: same. Press Esc: the field clears and the board stays open.
3. Grab "Anki" by its text and drag it to Monday, then into a list, then back to Friday.
4. Click "Lecture 5 notes" once: the small card opens at the top, board dimmed. Add a note, add a
   tag, pick a subject, set a colour, set a reminder. Close with Esc; reopen: all kept.
5. Press Expand: the full detail of the same task. Close.
6. In the widget (T), drag a task between two days in Week, and click one to see the card.
7. Tab to a row's title and press Tab once more to its grip: it shows, Space lifts, arrows move,
   Space drops.
