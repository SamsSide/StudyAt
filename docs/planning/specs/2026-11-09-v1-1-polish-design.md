# v1.1 polish — specification

> Status: agreed 2026-11-09. Roadmap: V1.1. Branch: `feat/v1-1-polish`
> (worktree `.claude/worktrees/feat-v1-1-polish`).
> Sam's requests of 2026-11-09, interviewed the same day. Every ruling below is Sam's answer to a
> clickable question unless marked "call".

## 1. Premise

After using v1.0.0 Sam asked for eight changes:

1. **Away prompt off switch.** The idle "You were away… keep that time?" prompt can't be turned off.
2. **Simpler Spotify.** The widget should look like the Windows media pop-out: what's playing,
   with controls, and nothing else.
3. **Resizable widgets.**
4. **Proportional layout.** On a smaller window, widgets should keep their relative positions and
   scale down, not pile up against the edges.
5. **Image / GIF widgets** that can float with no background.
6. **Focus view.** One key or button hides the dock and top bar, and mouse movement doesn't bring
   them back.
7. **YouTube embeds.** One space showed "This video can't be embedded"; check and fix.
8. **Countdown timer** (e.g. a plain 60 min), and **a task as well as a subject** on any focus
   timer, Pomodoro included.

## 2. What is already true

- Timer: pure machine `src/core/timer/machine.ts` (modes `focus | short | long`), driven by
  `src/main/timer/controller.ts`. Only `mode === 'focus'` accrues (appplan §5). The subject is
  held by the controller; `setSubject` mid-segment closes the row and opens a new one on the same
  pomodoro and day (rule 5, ruling A3).
- Idle: `src/main/timer/idle.ts` (`IdleWatch`, `FocusLedger`); threshold `idleMinutes` (2–60,
  default 10); auto-discard after 2 min; crash marker R39 (`away-marker.ts`).
- Sessions table (migration v1, `src/main/db/migrations.ts`): `subject_id`, no task. Schema is at
  v2 (notes). Tasks table: `tasks` (id, text, colour, done, sort, …); "Clear done" deletes rows.
- Widgets: fixed ids `WidgetId` (`src/shared/types.ts`), positions `WidgetPos {open, x, y,
  autoHide}` in `settings.widgets`, as fractions (`x` centre, `y` top). `WidgetFrame.tsx` clamps
  them into the free area at a fixed pixel size, so a smaller window piles widgets against the
  edges. Stored widgets are merged over defaults per **id**, not per field
  (`src/main/db/repos/settings.ts`).
- Auto-hide: `useAutoHide(seconds)` wakes on any mouse or key input; `autoHideSeconds = 0` means
  never hide.
- Spotify: `SpotifyWidget.tsx` shows art, title, artist, progress, transport, a playlist picker and
  a device picker; polls every 3 s.
- Media protocol `studyat-media://<space|sound|chime>/<id>` (`src/main/protocol.ts`), scoped to
  database-registered paths. CSP in `src/main/security.ts`.
- Shortcuts (`useShortcuts.ts`): Space R N 1 2 3 S T K G W M F ? Esc. `H` and `4` are free.
- Electron 45.

## 3. The design

### 3.1 Away prompt switch (appplan §5 idle, §4.9)

- New setting **`awayPrompt: boolean`, default `true`**. Settings → Timer: a toggle
  "Ask if I've been away", with the hint "Off: time while you're away from the keyboard still
  counts. Locking or sleeping the PC still pauses the timer." The idle-minutes control is disabled
  while it's off.
- Off: the controller doesn't poll for idle, never opens an away period and never prompts or
  discards. Suspend, lock and the 30 s unreported-sleep rule are **unchanged** (Sam chose the
  prompt only).
- Switched off while an away period is open but **not yet prompted**: the period is dropped (its
  time is kept) and the R39 crash marker is cleared. Switched off while a prompt is **showing**:
  that prompt stays and resolves as normal (keep, discard or the 2 min auto-discard). *Call:* a
  question already asked is answered; nothing is silently kept that Sam was being asked about.
- Switched back on: applies from the next poll.

### 3.2 Countdown mode (appplan §4.4, §5)

- A fourth mode **`countdown`**: one focus block of **1–240 min** (setting `countdownMinutes`,
  default **60**). Segmented control: **Pomodoro · Short · Long · Countdown**; shortcut **`4`**.
- While idle in Countdown, a preset row shows **30 · 45 · 60 · 90 · 120** plus a number field
  (1–240); picking one sets `countdownMinutes` and resizes the idle segment (like other lengths).
- Countdown **is study time**, accrued exactly like a Pomodoro focus segment: same session rows,
  15 s checkpoints, pause, idle prompt, suspend/lock, 1-minute noise floor, subject/task splits,
  day crediting by start.
- At the end: the **focus-done chime** and a notification **"Countdown done"** with body
  "**{n} min** of focus." Then it is **idle in Countdown at full length**. No break, no auto-start
  (the auto-start toggles don't apply). `completedFocusCount` is **not** incremented, so the
  Pomodoro long-break cycle is unaffected.
- Skip in Countdown = Reset (ends the row, back to full length idle). The "1 minute left" tick and
  "chime on start" apply to Countdown as they do to focus.
- A shared helper `isFocusMode(mode): boolean` (`focus` or `countdown`) replaces every
  `mode === 'focus'` check that means "this is study time" (machine, controller, chimes, notify,
  mini timer, tray, title). The executor greps for `'focus'` and decides each one.
- Labels: mode `countdown` shows as "Countdown" everywhere a mode name appears (widget, mini timer,
  tray tooltip, window title).

### 3.3 Task on the timer (appplan §4.4, §4.7, §5)

- Below the subject picker, a **task picker**: "No task" plus every **not-done** task in list
  order, showing its text (truncated with an ellipsis at the picker width). Available in Pomodoro
  and Countdown.
- The task is held by the controller like the subject (`taskId` + the task's text at the moment
  it was chosen). **Changing the task mid-segment splits the row** exactly like a subject change
  (rule 5, A3): close the row, open a new one on the same pomodoro and day key.
- Rows record **`task_id`** and **`task_text`** (the text snapshot), so a task later edited,
  ticked off or deleted by "Clear done" still shows by its old name in Stats.
- If the chosen task is ticked off or deleted while the timer holds it, the timer **keeps** it
  until the segment ends or Sam picks another. *Call:* no mid-segment split Sam didn't ask for.
  After the segment ends, a done or missing task is cleared from the picker (back to "No task").
- Stats: the **sessions list** shows a Task column (blank when none). A new **"By task"** card
  next to "By subject" lists minutes per task for the chosen range, largest first, top 10, grouped
  by `task_id` and labelled with the newest `task_text`. Sessions without a task are not listed.
  Session edit stays subject-only (§8).

### 3.4 Focus view (appplan §4.1)

- **`H`** toggles focus view; a top-bar button (eye-off icon, label "Hide interface") turns it on.
- In focus view the dock, top bar, side panel and widgets marked auto-hide are hidden and **stay
  hidden on mouse movement or typing**. Widgets not marked auto-hide stay (Sam's choice).
- Ways out: **`H`** again, **`Esc`** (when no overlay is open), or a small **"Show interface"**
  capsule that fades in only while the pointer is in the top-left 64 × 64 px corner.
- Shortcuts still work in focus view; an overlay opened by a shortcut (S, ?) shows over it and
  closing it returns to focus view. Not persisted: every launch starts with the interface shown.
- Help overlay lists `H` and `4`.

### 3.5 Widget scaling and resizing (appplan §4.1)

- **Layout scale** (proportional, Sam's choice):
  `layoutScale = clamp(min(innerWidth / 1920, innerHeight / 1080), 0.5, 2)`. Reference 1920 × 1080
  is one constant (`LAYOUT_REF`) so it can be tuned. Positions stay fractions, as now.
- **Widget scale**: `WidgetPos.scale`, **0.5–2, default 1**, set by a resize handle.
- Rendered scale = `layoutScale × scale`, applied as `transform: scale(s)` with
  `transform-origin: top left` on the frame; the scaled box (measured size × s) is what the
  clamp uses. If the scaled box is bigger than the free area, the rendered scale is reduced until
  it fits (display only; the stored `scale` is untouched).
- **Resize handle**: bottom-right corner of every widget (and image widget), 16 × 16 px, cursor
  `nwse-resize`, visible on hover and keyboard focus, fading with auto-hide. Dragging sets
  `scale = clamp(startScale × (startDiag + Δ) / startDiag, 0.5, 2)`, rounded to 0.01, saved on
  pointer up (a click without a move saves nothing). Keyboard on the focused handle: `+`/`=` and
  `-` step 0.1; double-click or `0` resets to 1. Label "Resize {title}".
- **Migration of stored settings**: stored widget entries lack `scale`; reading settings merges
  each stored entry over its default **per field** (`{...DEFAULT.widgets[id], ...stored[id]}`),
  and the sanitiser treats a missing `scale` as 1.

### 3.6 Image / GIF widgets (appplan §4.10)

- **Several**, one image each, **up to 12**. The Widgets popover gets **"Add image…"** below its
  toggles, which opens a small dialog: **"Choose file…"** (gif, png, jpg/jpeg, webp) or a link
  field + **"Add"**.
- **Stored as copies** in `%APPDATA%/StudyAt/images/<id>.<ext>`. Max **20 MB**. The type is checked
  by the file's magic bytes (GIF8, PNG, JPEG FFD8FF, RIFF…WEBP), not its extension.
- **Links** (Sam: download once, keep a copy): main fetches `https` URLs only, with the existing
  timeout helper, ≤ 20 MB, and accepts an image only by content type **and** magic bytes. A Giphy
  page link (`giphy.com/gifs/<slug>-<id>` or `giphy.com/gifs/<id>`) is mapped to
  `https://i.giphy.com/<id>.gif`; `media.giphy.com/media/<id>/…` links are fetched as given. The
  CSP is **unchanged** (images load through the media protocol).
- New media kind **`image`** on the protocol, resolving only to files in the images folder for
  ids in the `images` table.
- Each image widget has: position (x, y fractions), `scale` (0.5–2, default 1), **`bare`**
  (background off, default **false**). Base size: the image fitted inside **240 × 240 px**,
  keeping its aspect ratio, then × rendered scale (§3.5).
- **Framed** (`bare = false`): the usual glass frame; header title "Image", the close button
  **removes** it (after "Remove this image?" · Remove / Cancel). A header button toggles the
  background.
- **Bare** (`bare = true`): just the image, rounded corners 12 px, no glass, no header. Drag the
  image to move it. Hovering shows a small floating toolbar above its top-right corner: **"Show
  background"** and **"Remove"**, plus the resize corner. Toolbar and corner fade with auto-hide
  and in focus view; the image itself stays (it is not auto-hide).
- Keyboard: the image is focusable (label "Image {n}"); arrow keys move it, the toolbar is
  reachable by Tab.
- Removing deletes the row and its file. Messages (verbatim):
  - "That isn't a GIF, PNG, JPEG or WebP image."
  - "That image is over 20 MB."
  - "Couldn't download that link. Check it and your connection."
  - "You can have up to 12 images. Remove one first."

### 3.7 Spotify, pop-out style (appplan §4.6)

- The widget shows **album art (64 px), title, artist, a thin progress line, and previous /
  play-pause / next**. Nothing else in the playing state.
- The **playlist and device pickers are removed** from the widget (the main-process API stays;
  §8). The no-device state keeps its "Open Spotify on any device, then press play" message and its
  device buttons, which are the only way to wake a sleeping device.
- Progress moves smoothly: between polls it advances locally once a second while playing, and the
  next poll corrects it.
- Title and artist truncate with an ellipsis; the full text is in a tooltip.
- Unconfigured, disconnected and offline states are unchanged.

### 3.8 YouTube embeds (appplan §4.2, §6.2)

**Spike result (2026-11-09, built app on Windows; probes and screenshots in the session
scratchpad `yt-spike/`):**

- **Cause:** the built renderer is served as `http://127.0.0.1:<port>`, so YouTube's embed
  request carries `Referer: http://127.0.0.1:<port>/`. YouTube answers **error 150** to a bare-IP
  referrer for rights-managed videos (e.g. `dQw4w9WgXcQ`), which the app shows as "This video
  can't be embedded". Any hostname referrer is accepted. The five spaces in Sam's database
  played in both cases; `dQw4w9WgXcQ` went from 150 to playing once the referrer was
  `localhost`.
- **Genuinely owner-blocked:** `jfKfPfyJRdk` (Lofi Girl live) and `5qap5aO4i9A` return 150 with
  every referrer and host; the current message is correct for them.
- **No effect:** `widget_referrer`, dropping `origin`, `youtube-nocookie.com`. Spoofing the
  referrer as youtube.com gives 152; stripping it gives 153 ("Video player configuration error").

**Fix:**

1. `src/main/server.ts` `startRendererServer` returns `url: http://localhost:${port}` instead of
   `http://127.0.0.1:${port}`. It still **binds to `127.0.0.1` only** (`server.listen(0,
   '127.0.0.1')`). The CSP origin check follows the returned URL. No renderer state is lost (the
   port is random every launch). Update comments naming 127.0.0.1 (`server.ts` header,
   `protocol.ts` ~154) and any test asserting the old URL.
2. `src/renderer/spaces/youtube.ts`: add **152 and 153 to `PERSISTENT_ERRORS`** (not to
   `EMBED_BLOCKED`): they are our set-up's fault, not the owner's, so they get the "couldn't play"
   message instead of a silent black frame, and are logged as
   `[spaces] YouTube player configuration error N` so a broken referrer is easy to spot.
3. Dev mode (Vite on `localhost:5173`) already sends a hostname referrer: no change.

## 4. On screen

| Where | Change |
| --- | --- |
| Timer widget | 4-way segmented control; Countdown preset row when idle; task picker under the subject picker |
| Mini timer, tray, title | "Countdown" mode label |
| Top bar | "Hide interface" button |
| Shell | Focus view; top-left "Show interface" corner capsule |
| Every widget | Resize corner; proportional layout scale |
| Widgets popover | "Add image…" and its dialog |
| Image widget | Framed or bare; hover toolbar |
| Spotify widget | Pop-out layout |
| Settings → Timer | "Ask if I've been away" toggle; Countdown length |
| Stats | Task column in sessions; "By task" card |
| Help overlay | `H` focus view, `4` Countdown |

## 5. Data and IPC

**Migration v3** (backup first, as every migration):

```sql
ALTER TABLE sessions ADD COLUMN task_id INTEGER NULL;
ALTER TABLE sessions ADD COLUMN task_text TEXT NULL;
CREATE TABLE images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext TEXT NOT NULL CHECK (ext IN ('gif', 'png', 'jpg', 'webp')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  source_url TEXT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL DEFAULT 1,
  bare INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

Existing sessions get `NULL` task: history is unchanged.

**Settings** (`src/shared/types.ts`, `settings.ts`): `awayPrompt: boolean` (true),
`countdownMinutes: number` (1–240, 60), `WidgetPos.scale: number` (0.5–2, 1).

**Types**: `Mode = 'focus' | 'short' | 'long' | 'countdown'`; `TimerState` gains
`taskId: number | null` and `taskText: string | null`; `Session` gains `taskId`, `taskText`;
`ImageWidget { id, url, width, height, x, y, scale, bare }` (`url` is the media-protocol URL);
`TaskTotal { taskId: number; text: string; ms: number }`, returned by a new `stats:byTask(range)`
(same `SubjectRange` as `stats:bySubject`).

**IPC** (typed in `src/shared/ipc.ts`, preload `api.ts`, handlers `ipc.ts`, all validated):

| Channel | Args → result |
| --- | --- |
| `timer:setTask` | `(id: number \| null)` → `TimerState` |
| `timer:setMode` | accepts `'countdown'` |
| `stats:byTask` | `(range: SubjectRange)` → `TaskTotal[]` (top 10, largest first) |
| `images:list` | `()` → `ImageWidget[]` |
| `images:addFile` | `()` → `ImageWidget \| { error: string }` (main shows the file dialog) |
| `images:addUrl` | `(url: string)` → `ImageWidget \| { error: string }` |
| `images:update` | `(id, { x?, y?, scale?, bare? })` → `ImageWidget \| null` |
| `images:remove` | `(id)` → `void` (deletes row and file) |

The image dimensions are read in main from the file header (GIF, PNG, JPEG SOF, WebP VP8/VP8L/
VP8X), so no decoder is needed.

## 6. Accounting impact

- **Rule 4 (idle)** changes: Sam ruled (2026-11-09) that the away prompt may be **turned off**,
  in which case away time counts. Default stays on. Suspend/lock (rule 3) and A4 are untouched.
- **Countdown** is study time under the same rules as a Pomodoro focus segment (Sam's ruling).
  appplan §5's "A focus session is one Pomodoro segment" becomes "one focus segment (a Pomodoro
  or a Countdown)".
- **Task**: a split rule identical to subject changes (rule 5, A3). No new way to create or add
  time.

## 7. Failure and edge cases

- Countdown length changed while running: applies at the next start (as other lengths).
- Countdown crossing midnight / rollover: credited to the start day, not split (as now).
- Crash mid-Countdown: orphan closed at its last checkpoint (as now).
- Task picker with no tasks: just "No task". Task deleted while chosen: §3.3.
- Away prompt toggled mid-away: §3.1.
- Image: file deleted from the images folder by hand → the widget shows a "Image missing" state
  with Remove; corrupt/odd header → rejected at add time with the type message; link redirects
  are followed (max 5) but the final URL must still be `https`; a link returning HTML → type
  message; offline → download message.
- 12-image cap checked in main.
- Widget scale makes a widget larger than the window: display shrinks to fit (§3.5).
- Tiny windows: layout scale floors at 0.5; the clamp still keeps widgets on screen.
- Focus view with an auto-hide widget and the Show capsule: capsule only in the corner.
- Spotify: art missing → note glyph (as now).

## 8. Out of scope

- Editing a session's task in Stats (only subject is editable; later row if wanted).
- Count-up stopwatch (Sam chose countdown only).
- Images in backups/export: the images folder isn't backed up (the DB rows are). Noted in
  appplan §6.4.
- Reduced-motion pausing of GIFs.
- Playlist/device pickers (removed from the widget, API kept for a possible later row).
- Reading Windows' media session instead of the Spotify API (Sam kept the Spotify sign-in).

## 9. Acceptance criteria

| # | Criterion | Verified by |
| --- | --- | --- |
| 1 | With `awayPrompt` off, a 15-minute idle stretch during focus produces no prompt and the session keeps all 15 min | unit (controller, injected clock) |
| 2 | With `awayPrompt` on, behaviour is unchanged (existing idle tests pass) | unit |
| 3 | Turning the switch off with an unprompted away period keeps the time and clears the marker; with a prompt showing, the prompt still resolves | unit |
| 4 | Countdown of 60 min accrues 60 min into one session row, plays the focus-done chime, fires "Countdown done", ends idle in Countdown, `completedFocusCount` unchanged | unit (machine + controller), e2e |
| 5 | Countdown length 1–240 is enforced; presets set it | unit (sanitiser), component test |
| 6 | Changing task mid-segment splits the row; both rows keep the pomodoro's day key and the right `task_id`/`task_text` | unit |
| 7 | Migration v3 adds the columns and table, takes a backup first, and keeps existing sessions | unit (fixture migration) |
| 8 | Stats shows the task column and a By task card with correct totals | unit (stats maths), component test |
| 9 | `H` hides the chrome and it stays hidden through mouse moves; `H`, `Esc` and the corner capsule bring it back | component test, e2e screenshot |
| 10 | Widgets scale proportionally: at 960 × 540 every default-open widget renders at 0.5 of its 1920 × 1080 size and at the same fractional position | component test, e2e screenshots at two sizes |
| 11 | Resize handle changes and persists `scale` (0.5–2); keyboard +/−/0 work | component test |
| 12 | Old stored settings without `scale` load with scale 1 | unit |
| 13 | Add a GIF from file and from a direct link and a Giphy page link; it animates; toggling background off shows it bare; drag, resize, remove work; non-image and >20 MB are refused with the exact messages | unit (sniffing, Giphy mapping, size), e2e |
| 14 | The media protocol serves `image/<id>` only for registered ids | unit |
| 15 | Spotify widget in the playing state shows only art, title, artist, progress and transport | component test, 👤 |
| 16 | In the built app, `dQw4w9WgXcQ` plays and the four starter spaces still play; `jfKfPfyJRdk` still shows "This video can't be embedded"; the renderer server binds to 127.0.0.1 only; errors 152/153 show the play-error message | unit (server URL/bind, error sets), e2e on the built app |
| 17 | `./check.sh` green on the whole tree | gate |

## 10. Hand-walk (Sam)

1. Settings → Timer: turn off "Ask if I've been away". Start a Pomodoro, leave the PC for 11 min
   without locking, come back: no prompt, the time counted. Turn it back on.
2. Press `4`, pick 60 (or set 2 min to test), pick a subject and a task, start. Let it end: chime,
   "Countdown done", no break.
3. Start a Pomodoro with a task, switch task halfway. Open Stats: both pieces in the sessions
   list, By task shows both.
4. Press `H`: dock and top bar go and don't come back when you move the mouse. Hover the top-left
   corner → "Show interface". Press `H` again.
5. Drag a widget's corner to make it bigger; relaunch, still bigger. Un-maximise and shrink the
   window: the layout shrinks in place.
6. Widgets → Add image…: add a GIF from disk and a Giphy link. Turn one's background off, drag it,
   resize it, remove the other.
7. Spotify: play something; the widget looks like the Windows media pop-out.
8. Add the YouTube video that failed before; it plays (or says honestly that its owner blocks
   embedding).

## 11. Open questions

None.
