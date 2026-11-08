---
name: study-plan
description: Use when planning anything for StudyAt before building it — a roadmap row, a new widget or panel, a stats view, a timer or accounting change, a storage or migration change, a media or Spotify feature, packaging, or a defect found while using the app — turning it into a spec and an implementation plan that an agent with no memory of the conversation can execute. Also for adding or changing roadmap rows. Sibling to study-plan-execute, which builds what this plans.
---

# Planning StudyAt work

`study-plan-execute` builds. **This plans.** The output is a spec and a plan precise enough that
an agent who never saw this conversation builds exactly what was meant, not something adjacent.

Load `study-dev` first if it isn't loaded: it holds the rules every plan must respect.

## The pipeline

```
roadmap row / defect / idea / screenshot
   │
   ├─ 1. classify ............... spike · bounded · architectural (say it out loud)
   ├─ 2. worktree ............... EnterWorktree name: feat-<row>-<topic>, before any file is written
   ├─ 3. interview .............. the checklist below, one question at a time, clickable
   ├─ 4. approaches ............. 2–3 options with trade-offs, a recommendation
   │        ↓
   │  docs/planning/specs/YYYY-MM-DD-<topic>-design.md     ← 👤 Sam approves
   │        ↓
   ├─ 5. plan ................... tasks, test-first steps, no placeholders
   │        ↓
   │  docs/planning/plans/YYYY-MM-DD-<topic>.md            ← 👤 Sam approves
   │        ↓
   │  ═══ /clear, fresh session, same worktree ═══
   │        ↓
   └─ study-plan-execute ........ dispatch, review, ledger, gates — unattended
```

**Planning is gated; execution is not.** Ask as many questions as it takes: a question skipped
becomes an assumption the executor makes, and nobody sees it until the app is built wrong. Every
question goes through `AskUserQuestion` with concrete options, the recommended one first and
marked `(Recommended)`, one line of trade-off each, jargon glossed inside the option. Offer "cut
it" when a question shows a feature is confusing. Sam wants it quick **and** properly
functional: prefer fewer, complete features over many half-done ones.

## 1. Classify

- **Spike:** "can Electron / YouTube embeds / Spotify / Web Audio even do X on Windows?" Answer
  with a throwaway probe in the scratchpad (run via `scripts/win.sh` if it needs Electron). No
  spec. Report the finding, and a roadmap note if it changes a row.
- **Bounded:** a change inside one widget or panel with no change to accounting, storage schema,
  IPC surface or settings shape. Run the checklist anyway (short when most answers are
  "unchanged"), present the design in chat, get a yes, then write a short plan file.
- **Architectural:** anything touching time accounting, the storage schema, IPC/preload, the
  timer process, settings shape, packaging, or more than one of core / ui / media. Full chain.

When in doubt, take the heavier path.

## 2. Worktree first

Planning happens in the worktree that will build it, so plan and code ship on one branch. Create
it before writing anything (`EnterWorktree` with a `name`), and name its path in the handoff.

## 3. The checklist

Work through every item. "Unchanged" is a fine answer; silence is not.

1. **The moment of use.** Sam sits down to study: what do they see and do, step by step? What
   does success look like, on screen?
2. **Where it lives.** Dock item, floating widget, side panel, stats overlay, settings, tray? How
   is it opened and closed, and does its position or state persist?
3. **Study-time accounting.** Does this create, change, pause, split or delete focus time? If
   yes, appplan §5 is in play: name every rule touched, and get Sam's explicit answer.
4. **Data.** New tables or fields? Migration from the current schema? Backup before it? What
   happens to existing history?
5. **Time edges.** Rollover hour, midnight, DST, week boundaries, the app closed or asleep across
   a boundary, the clock changing.
6. **Process boundary.** Main or renderer? Which IPC channels, with which types?
7. **Media and assets.** Which files, from where, under which licence? Credits lines? Large-file
   behaviour, missing-file behaviour?
8. **Offline and failure.** No internet (YouTube, Spotify), a revoked Spotify token, a moved
   video file, a corrupt database, a crash mid-write.
9. **Windows specifics.** Tray, notifications, start-up, file dialogs, paths with spaces, high-DPI.
10. **Look.** Which existing components? Mockup needed? Reduced motion? Keyboard access?
11. **Gates.** What do unit tests prove, what does `study-testing` prove in the running app, and
    what is left for Sam's hand-walk? Write the hand-walk steps now.
12. **Scope boundary.** What is explicitly out, and which roadmap row picks it up?
13. **Acceptance criteria.** Numbered, each with how it is verified: unit test, e2e on Windows,
    screenshot, or 👤 hand-walk.

Read the code while asking, so the spec is feasible before it is approved.

## 4. The spec

`docs/planning/specs/YYYY-MM-DD-<topic>-design.md`:

```
# <Topic> — specification
> Status: draft | agreed YYYY-MM-DD. Roadmap: P<n>. Branch: <branch>.
## 1. Premise              what is wrong or missing
## 2. What is already true  the code and appplan today, with paths (cite appplan §)
## 3. The design           rules, states, data; tables for values; copy verbatim where it matters
## 4. On screen            what each widget/panel shows and does
## 5. Data and IPC         schema, migration, channels and types
## 6. Accounting impact    "none", or every appplan §5 rule touched and Sam's ruling
## 7. Failure and edge cases
## 8. Out of scope         and the row that owns each
## 9. Acceptance criteria  numbered, each with its verification method
## 10. Hand-walk           Sam's steps in the running app
## 11. Open questions
```

Then stop: Sam reads and approves it (`AskUserQuestion`: approve · changes · rethink).

## 5. The plan

`docs/planning/plans/YYYY-MM-DD-<topic>.md`, starting:

```
# <Topic> — implementation plan
> Execute with `study-plan-execute` (self-contained; no superpowers skills). Steps use `- [ ]`.
**Goal:** one sentence.   **Spec:** <path> (the spec wins where they disagree).
**Roadmap:** P<n>.        **Worktree:** <path>, branch <branch>.

## Global Constraints   the spec's app-wide rules, one line each, values verbatim
## Review Focus         the inputs or failure modes most likely to break it that no test covers
## File map             every file created or modified, one responsibility each
## Batches              which tasks can run in parallel (share no file)
## Task N: <component>  (repeat)
## After the tasks: the hand-walk   copied from spec §10
```

Each task has: **Agent** (`study-core` / `study-ui` / `study-media` / `study-testing` / `main`),
**Files**, **Interfaces** (exact names and types it consumes from earlier tasks and produces for
later ones), then steps: write the failing test (test names and assertions as code, with the
spec's values), run it and see it fail (exact command, expected failure), implement (exact
signature and file; a body only for an algorithm the tests don't pin), run and see it pass,
`./check.sh`, commit (subject in the repo's style).

**Order:** shared types and storage → main-process logic → IPC/preload → renderer components →
media → a `study-testing` task that launches the app on Windows and proves the feature end to
end with screenshots. Each task testable alone.

**No placeholders:** no "TBD", "add handling", "write tests for this", "similar to Task N"
(repeat it, since tasks are read alone), no type or function no task defines.

**Self-review before handing over:** every acceptance criterion maps to a task; every value in the
spec appears verbatim in a task; names match across tasks; no task needs an interface no earlier
task produced; `./check.sh` is in every task; there is a `study-testing` task. Then Sam approves.

## Roadmap mode

- **`docs/planning/roadmap.md` is the source of truth.** New work goes on it first. Never
  restructure phases or drop rows without asking. Sam's edits win.
- **The row links its spec and plan,** and its status becomes *planned* when the plan is approved.
- **If a design changes how the app works,** the spec says which appplan section changes, and the
  plan's last task updates appplan.

## Handoff

When the plan is approved, commit spec, plan and roadmap rows on the worktree's branch (Sam's
identity, no AI attribution), then end with the exact lines to paste:

```
Plan approved: docs/planning/plans/<file>.md (worktree <path>, branch <branch>).

Run /clear, then paste:

    Enter the worktree at <path>, then execute docs/planning/plans/<file>.md using study-plan-execute.
```

If Sam prefers to continue in this session, do so without arguing.
