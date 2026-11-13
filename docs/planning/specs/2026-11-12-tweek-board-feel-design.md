# Tweek board feel — specification

> Status: draft 2026-11-12. Roadmap: V1.2 (a follow-up pass on the built branch). Branch:
> `worktree-feat-v1-2`, worktree `.claude/worktrees/feat-v1-2`. Classified **bounded**: renderer
> only, no change to accounting, schema, IPC or settings shape.

## 1. Premise

Sam, after using the v1.2 board: "I don't really like it. Implement it so it's exactly like
Tweek: I can drag and drop tasks, clicking once opens a little menu where I add the notes and
the other tags, and clicking in any slot (each day or the inbox/list slots) opens so I can type
the task name — currently it doesn't work like that."

Three things are wrong today:

1. **Drag starts only from the ⠿ grip**, which appears on hover. In Tweek the whole task line is
   the drag handle.
2. **A click opens the full detail form** (every field, centred). Tweek opens a small card
   first; the full detail sits behind "Expand".
3. **Only the first empty line takes typing.** The other ruled lines are inert
   `aria-hidden` divs (`board/RuledLines.tsx`), so a click on them does nothing.

## 2. What is already true

- The board: `src/renderer/planner/board/` — `TasksBoard.tsx` (head, views, `PlannerDnd`),
  `BoardWeek.tsx` (day columns), `BoardLists.tsx` (list columns, Inbox first), `BoardDay.tsx`
  (Day view cards), `RuledLines.tsx` (a column's lines: tasks, the add line, blanks),
  `BoardDrag.tsx` (overlay, insertion line).
- Drag: `src/renderer/planner/dnd.tsx` — `@dnd-kit` `PointerSensor` (activation distance 6 px)
  and `KeyboardSensor`; `SortableTask` puts the sortable `listeners` and `attributes` on the grip
  button `Move "<title>"`. `resolveDrop` (pure) and the store's `move` are unchanged by this work.
- Rows: `src/renderer/planner/TaskRow.tsx` — `full` (widget) and `compact` (board) variants; a
  row click calls `openDetail(task.id)`.
- Detail: `src/renderer/planner/TaskDetail.tsx` — portalled `role="dialog"`, `aria-label`
  `Task: <title>`, centred, every field, saves as it edits (drafts, `save`, flush on unmount),
  closes on Esc and on a press outside. Mounted once: in the widget while it is open, else in
  the board. `TaskMenu.tsx` holds Start focus · Schedule revision… · Duplicate · Delete (with
  in-place confirm).
- Store: `src/renderer/planner/plannerStore.ts` — `detailTaskId`, `openDetail(id)`,
  `closeDetail()`.
- Quick add: `src/renderer/planner/QuickAdd.tsx` — a form with one input; Enter creates via the
  shared parser (`#tag`, `~1h`, `@subject`) and clears the text; the input stays mounted.
- Task fields (v1.2 spec §3.6) already include note, tags, subject, estimate, subtasks, colour,
  repeat, reminder. No data change is needed.

## 3. The design

Observed in Tweek on 2026-11-12 (Sam's account, a "zz test task" added and deleted):

| Tweek behaviour | StudyAt after this work |
| --- | --- |
| The whole task line is a dnd-kit drag source (its button carries dnd-kit's keyboard description) | The whole row (board compact row, widget full row, board Day card) starts a pointer drag. The `Move "<title>"` grip button stays for the keyboard (Space to lift) but is visually hidden until it has keyboard focus |
| Clicking a task opens a small card, top centre, board dimmed | Clicking a row opens the **quick card** (§4.2), top centre, everything behind dimmed |
| Card: date chip, time, Expand; big title + done circle; "Add some extra notes here…"; icon bar subtasks · repeat · colour · reminder · ⋮ | The same, plus one chip row for StudyAt's fields: subject, estimate, tags, focused time; ▶ Start focus in the icon bar |
| Expand opens the full task | Expand switches the same dialog to today's full detail (unchanged) |
| Clicking any empty line in a column focuses that column's add input, which sits on its first empty line | Same, for every day column, every list column (Inbox included) and the board Day sheet |
| Enter saves; the input moves down one line and stays focused | Same (the input is not remounted) |
| Empty lines are blank | Same: no "Add…" placeholder (replaces the v1.2 §12 ruling "Column add rows on the board say 'Add…'"); the add input is invisible until focused, then a filled line |

### 3.1 Rulings (Sam, 2026-11-12)

- Quick card: **Tweek's card plus a chip row** (subject, estimate, tags). Expand opens the full detail.
- Position: **top centre, everything behind dimmed**.
- Scope: **board and the Tasks widget** (both rows share `SortableTask` and the one `TaskDetail`).
- Delete: **keep the in-place confirm** (no undo toast).
- Empty lines: **blank until clicked**.

### 3.2 Drag

- Pointer: the sortable `listeners.onPointerDown` goes on the row element (`li`), so a press
  anywhere on the row and a move of ≥ 6 px (the existing activation distance) lifts it. A press
  and release without moving is a click.
- Keyboard: `attributes` and `listeners.onKeyDown` stay on the grip button `Move "<title>"`. The
  grip is visually hidden (clip, not `display:none`) until it has `:focus-visible`, where it
  shows in its current hover spot.
- **The click after a drag never opens the card.** `PlannerDnd` records when a drag ends or is
  cancelled; a row click within **250 ms** of that is ignored (`justDragged(now)`, pure, tested
  with an injected time).
- Rows: `user-select: none`; `cursor: pointer`; while dragging, the body gets `cursor: grabbing`.
- The checkbox and ▶ on a row still work on a plain click (the 6 px rule covers it).
- Unchanged: the overlay, the insertion line, `resolveDrop`, the announcements, the Month cells.

### 3.3 Detail modes

- Store: `detailMode: 'card' | 'full'`, default `'card'`. `openDetail(id, mode = 'card')`
  sets both; `expandDetail()` sets `'full'`; `closeDetail()` clears the id and resets the mode to
  `'card'`.
- Every existing `openDetail(id)` call (row click, reminder click, new task from "+ New task")
  therefore opens the card.
- `TaskDetail` renders `TaskCard` in `'card'` mode and the existing full popover in `'full'`
  mode, inside the same portal, with the same `role="dialog"` and `aria-label` `Task: <title>`.
- The field logic (drafts, `save`, save-failed notice, flush of pending edits on unmount) moves
  out of `Popover` into a hook `useTaskEditor(task)` used by both, so both save the same way.

## 4. On screen

### 4.1 Ruled lines (board Week, lists, board Day)

- Lines: tasks, then the add line, then blanks, as now.
- The add input has no placeholder and no visible box until focused; focused, it is a filled
  line (`background: var(--hover)`, radius 6 px).
- A click on the column's ruled area that is **not** on a task row, button, input or link focuses
  that column's add input. This covers the blank lines and the add line. On the board Day sheet,
  a click on empty sheet space does the same for its add input.
- Enter with text: creates the task (parser unchanged), clears, keeps focus on the line below.
- Esc in the add input: clears its text, blurs, and is stopped from closing the board.
- Blur with text: the text is kept (nothing typed is lost); the field shows again on focus.
- The `aria-label` stays `Add to <day or list name>`.

### 4.2 The quick card

A portalled dialog, `aria-modal="true"`, `aria-label` `Task: <title>`, over a backdrop.

- Backdrop: fixed, inset 0, `rgba(0, 0, 0, 0.45)`, one layer under the card, above the board and
  widgets. A press on it closes the card (pending edits are saved, as now).
- Card: fixed, `top: 72px`, centred horizontally, `width: min(420px, calc(100vw - 32px))`,
  `max-height: calc(100vh - 96px)`, scrolls inside. Same panel tokens as the full popover.
  Opening fades in over `var(--duration-fast)` (zero under reduced motion via the tokens).
- Rows, top to bottom:
  1. **Head:** `PlacementPicker` (day or list chip, unchanged) on the left; on the right an
     `Expand` button (text "Expand", icon ⤢) and `×` (`aria-label="Close"`).
  2. **Title:** the title textarea at `var(--text-xl)`, weight 600 (same rules as now: one line,
     Enter saves, wraps), with the done check on the right as a round checkbox
     (`aria-label` "Mark as done" / "Mark as not done"). A hairline under it.
  3. **Note:** textarea, `aria-label="Note"`, placeholder **"Add some extra notes here…"**, 4
     rows, no border.
  4. **Chips** (`role="group"`, `aria-label="Details"`): Subject chip (a native `select` styled
     as a chip, `aria-label="Subject"`, options "No subject" + non-archived subjects, showing a
     colour dot); Estimate chip (`select`, `aria-label="Estimate"`, "No estimate" + the presets
     15, 30, 45, 60, 90, 120, 180 min, plus the current value when it is a custom one; "Custom…"
     only in Expand); the tags as `TagInput` (`label="Add a tag"`, chips removable); and, when
     `actualMs > 0`, a read-only chip "Focused 32m".
  5. **Subtasks:** shown when the task has any, or after ☰ is pressed (`SubtaskList`, unchanged).
  6. **Icon bar**, evenly spaced icon buttons, each tinted with `--accent` when its value is set:
     - ☰ `aria-label="Add subtask"`: shows the subtasks and focuses "Add a subtask".
     - ↻ `aria-label="Repeat"`, a small menu: None · Daily · Weekdays · Weekly · Every N days…
       (the last opens Expand). Disabled with `title="Repeat is for tasks on a day"` when the task
       is in a list.
     - 💧 `aria-label="Colour"`, a small menu: No colour + `TASK_COLOURS` swatches.
     - 🔔 `aria-label="Reminder"`, a small menu: a `type="time"` input (`aria-label="Reminder time"`)
       and "Clear". Disabled with `title="Reminders are for tasks on a day"` when the task is in a
       list.
     - ▶ `aria-label="Start focus"`: starts the task (`startTask`) and closes the card.
     - ⋮ the existing `TaskMenu` (Start focus · Schedule revision… · Duplicate · Delete, confirm in place).
- Small menus: open below their button inside the card, close on a choice, on Esc (Esc closes
  the menu only, not the card) and on a press elsewhere in the card.
- Keys: Tab is trapped inside the card; Esc closes it (after any open menu); focus returns to the
  row on close (as now).
- Expand: switches to the full detail in place (the backdrop stays). Full mode is today's
  popover, unchanged apart from sharing `useTaskEditor`.

### 4.3 The widget

The widget's Day, Week and Lists rows (`SortableTask`, full variant) get the same whole-row drag
and open the same quick card. Its add rows (`QuickAdd` with the syntax placeholder) are unchanged.

## 5. Data and IPC

None. No schema, channel, preload or settings change.

## 6. Accounting impact

None. ▶ in the card calls the existing `startTask`; focus time is counted as today.

## 7. Failure and edge cases

- A drag released over the row it started on: no card opens (the 250 ms guard).
- A drag cancelled with Esc: no card opens; Esc does not close the board (dnd-kit consumes it).
- A press on the checkbox or ▶ that moves ≥ 6 px starts a drag rather than ticking: accepted (Tweek does the same).
- A task removed elsewhere while its card is open: the dialog unmounts, as now.
- A save refused by main: the card shows the existing `SAVE_FAILED` notice under the chips.
- Clicking a blank line in a column while another column's add input holds text: that text is
  kept in its own input; focus moves to the clicked column.
- A column with more tasks than rows: the add line is after the last task; clicks below still focus it.
- The board Day sheet when the day is empty ("Nothing planned for this day."): a click on it focuses the add input.
- Reduced motion: no fade; drags already drop without animation under reduced motion.

## 8. Out of scope

- Tweek's undo toast on delete (Sam: keep the confirm). Tweek's Share, Attach file, Copy and
  the task time chip: not in StudyAt. Natural-language dates in quick add. Multi-select drag.
  No roadmap row; raise one if Sam asks.

## 9. Acceptance criteria

1. Pressing anywhere on a board row's title and dragging it to another day moves it there. *e2e (Windows), real mouse via Playwright, no grip.*
2. The same in the widget's Week view. *e2e.*
3. Dragging a row between a day and a list (both ways) moves it. *e2e.*
4. A drag released on its own row does not open the card. *unit (`justDragged`) + e2e.*
5. A keyboard drag via the `Move "<title>"` grip still works, and the grip shows on keyboard focus only. *unit (existing keyboard tests kept green) + screenshot.*
6. A single click on a row opens the quick card, top centre, with the backdrop; it shows placement, title, done, note placeholder "Add some extra notes here…", the chips and the icon bar. *unit + screenshot.*
7. Typing a note and tags in the card saves them (visible after closing and reopening). *unit + e2e.*
8. Subject and estimate chips save. *unit.*
9. Repeat, Colour and Reminder menus save; Repeat and Reminder are disabled for a list task. *unit.*
10. Expand shows the full detail of the same task; Esc and a backdrop press close either mode and save pending edits. *unit.*
11. Clicking any blank line of a day column, a list column (Inbox included) or the board Day sheet focuses that column's add input. *unit + e2e.*
12. Enter adds the task and keeps focus on the next line, so a second task can be typed at once. *unit + e2e.*
13. Esc in an add input clears it and does not close the board. *unit.*
14. Empty board lines show no text; the focused add line is visibly filled. *screenshot.*
15. `./check.sh` green on the whole tree, quoted. *gate.*

## 10. Hand-walk (Sam, in the running app)

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

## 11. Open questions

None.
