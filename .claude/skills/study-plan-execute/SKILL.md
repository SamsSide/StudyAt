---
name: study-plan-execute
description: Use when executing an approved StudyAt implementation plan from docs/planning/plans/ — building it task by task with the study-core, study-ui and study-media subagents in parallel batches, study-testing serially on Windows, reviewing each task with study-review, keeping a ledger, running check.sh and launching the real app, and verifying against the spec's acceptance criteria.
---

# Executing a StudyAt plan

Load `study-dev` first if it isn't loaded. You are the **dispatcher**: you brief agents, gate
their work, review it and keep the ledger. You don't write the feature yourself unless a task is
marked `main`.

## Start fresh, in the right worktree

Execution wants a session that has done nothing else. If this session also wrote the plan, say
once (clickable): "Running `/clear` and pasting the handoff line gives the build a full window. Do
that, or continue here?" Then do as told.

The plan header names its worktree. If this session isn't in it, `EnterWorktree` with that `path`.
Never build in the root or on `main`.

## Setup

1. **The ledger.** `.claude/ledger/<plan-stem>/progress.md` (git-ignored). If it exists and its
   first line names this plan, every `Task <N>: complete` is done: never re-dispatch it, resume at
   the first task without one. Otherwise create it with `# Ledger — plan: <plan path>`. After
   compaction, trust the ledger and `git log` over memory.
2. **Read the plan and its spec once.** Where they disagree, the **spec is binding**: rule, ledger
   the ruling, continue.
3. **Conflict scan.** For every pair of tasks sharing a file or interface, one ledger row: what one
   produces, what the other consumes, what you found. Rule on each before Task 1.
4. **Baseline.** Run `./check.sh` and ledger it. A red baseline is ledgered as pre-existing, so it
   isn't blamed on a task.

## Dispatch all, or inline? Ask once.

Show the real mapping with `AskUserQuestion`, once, before Task 1:

```
Task 1  Session store + migrations   → study-core     ┐ batch A (parallel)
Task 2  Chime set + credits          → study-media    ┘
Task 3  Timer widget                 → study-ui         alone
Task 4  Launch + e2e on Windows      → study-testing    alone (run lane)
Task 5  appplan + roadmap sync       → main session
```

Options: **Dispatch all** *(Recommended)* · **Run inline** · **Let me pick**. Never ask again.

## Models and caps

- **Implementers:** `model: "sonnet"`, including fix rounds. **Opus** (omit `model`) for:
  reviewers; any task touching time accounting, the timer state machine, migrations or backups;
  any visual layout task; a task the plan marks "decide"; and a fix round after a Sonnet
  implementer has failed twice.
- **Caps, in every brief, in these words:** "Stop and report after 3 failed fix attempts on the
  same failure, or about 80 turns, whichever comes first. Write what you tried, what you learned
  and the failing output to your report file, and return `BLOCKED`."
- **At most 5 agents at once.** Batched agents run scoped unit tests only; you run the whole-tree
  gate once per batch.
- **The run lane is serial:** only one `study-testing` at a time, never alongside another agent
  that is installing packages. Disk-lane agents never run `scripts/win.sh`.
- **A capped agent is never resumed.** A fresh agent gets the brief, the report file and a short
  handoff note.

## The task loop

1. **BASE:** `git rev-parse HEAD`.
2. **Brief to a file:** `sed -n '/^## Task N:/,/^## Task N+1:/p' <plan> > <ledger>/task-N-brief.md`.
   The dispatch says: where the task fits (one line); "read `<brief path>` first, it is your
   requirements, values verbatim"; interfaces from earlier tasks it can't know; your rulings; the
   report path `<ledger>/task-N-report.md`; **batched or alone**; the caps. Never make an agent read
   the whole plan.
3. **Batch** consecutive disk-lane tasks that share no file and don't depend on each other: one
   message, several `Agent` calls, each with `subagent_type` set to the task's agent
   (`study-core`, `study-ui`, `study-media`). No `isolation: "worktree"` (they share this
   worktree; the file map keeps them apart). `study-testing` tasks always run alone.
4. **Gate a batch yourself, once,** after every agent returns: `./check.sh`, then commit the batch
   as one commit per task where the files separate cleanly, else one commit naming all tasks
   (Sam's identity, no AI attribution).
5. **Review every task** (below). 6. **Ledger** every dispatch, report, review and ruling.

**Read the report, not the files.** Opening an agent's files re-imports the context you dispatched
it to avoid.

### What comes back

The `agent-contract.md` report: `STATUS · FILES · GATES · RULINGS · NEEDS_OWNER · CONCERNS`.

- `BLOCKED`: change something before re-dispatching (more context, a smaller task, a ruling,
  Opus). Never retry unchanged.
- `NEEDS_OWNER`: ledger it and add its question to the hand-walk; it does not block the next task,
  unless it is an accounting change, which waits for Sam's answer before that code merges.
- A batched agent's "not run" is not green; your batch gate is.

### Review

- **Package the diff as a file:** `git log --oneline BASE..HEAD; git diff --stat BASE..HEAD;
  git diff -U10 BASE..HEAD` into `<ledger>/task-N-review.diff`. It never enters your context.
- **Dispatch `study-review`** with the brief path, report path, diff path and the plan's Global
  Constraints verbatim. It returns `VERDICT` plus numbered Critical / Important / Minor findings.
  Never pre-judge a finding for it.
- **Fix loop:** any Critical/Important or a missed requirement → a fix round (the original
  implementer type for round 1, then a fresh agent with the report), then a scoped re-review of
  the fix diff. Ledger `Task N: fix round R/3`. Minor findings are ledgered as deferred for the
  final review.
- **Breaker at 3 rounds:** park it with a ruling, or rule on the smallest change that unblocks
  later tasks and carry it into the next brief. Never fix findings yourself.
- **Complete:** `Task N: complete (commits a..b, review clean)` or `(…, K parked)`.

## Do not stop

Sam answered everything during planning. **Rulings, not stalls:** an ambiguity, a plan defect or
a wrong value is decided and ledgered as `Ruling: <decision> — <why> — <cost if wrong>`. Stop
only for something destructive or irreversible (deleting Sam's study data, rewriting history), a
side effect outside this worktree (push, merge, PR, touching Sam's real app data folder), or a
plan so broken every path is a guess. What counts as study time is never ruled on: it goes to Sam.

## Accuracy to the spec is the deliverable

Spec values and copy verbatim. Build what is specified, not what is adjacent; a better idea is a
note for Sam. Out of scope means out of scope. Never silently drop a requirement.

## Finishing

1. Every task complete; a whole-tree `./check.sh` green, quoted.
2. **Run it for real:** dispatch one `study-testing` to sync, install and launch the app on Windows
   (throwaway data dir), exercise every acceptance criterion it can, and capture screenshots.
3. **Final review:** package `git diff $(git merge-base main HEAD)..HEAD` as a file and dispatch
   one `study-review` (Opus) over the whole branch, with the deferred minors.
4. **Verification record** next to the plan, `<plan-stem>-verification.md`: how the gates were
   run; each acceptance criterion and the evidence that settled it; the 👤 hand-walk steps for
   Sam; every ruling.
5. **Roadmap:** the row's status, its notes (commits, the verification record), *Where we are*
   and *Up next*; the appplan section the spec named, if any.
6. Commit (Sam's identity, no AI attribution). **Offer the push as the next step; never push or
   open a pull request unasked.**
7. Report: what was built, every ruling, the hand-walk Sam should do (including
   `scripts/win.sh npm run dev` to try it), anything not done and why.
