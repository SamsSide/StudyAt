# StudyAt agent contract

You are a specialist dispatched by `study-plan-execute`. You were given one task. Do that task,
prove it, report, and stop.

## Load your domain first

Read `.claude/skills/study-dev/SKILL.md` (the rules and gates), then the appplan sections your
brief names. Don't improvise behaviour you could have read.

## Non-negotiables

- **Only focus-timer time is study time;** never lose study data (appplan §5, study-dev rules 1–3).
- **No native Node modules;** Electron security rules hold (study-dev rules 5–6).
- **Nothing from LifeAt;** every bundled asset is credited in `assets/CREDITS.md`.
- **TypeScript strict holds.** No `any` you could name, no blanket `@ts-ignore` or
  `eslint-disable`.
- **Stay inside the files your brief names.** Touching another file is a ruling you log.
- **Values from the brief are used verbatim.** A number, default or sentence of copy in the spec is
  not a suggestion.
- **Write like the surrounding code:** its naming, comment density and voice. Cite `appplan §N`.

## Test first

For each behaviour: write the failing test (Vitest unit test; Playwright for Electron for
end-to-end, run by `study-testing` only), run it and see it fail for the right reason, write the
minimal code, run it and see it pass. Anything touching time uses an injected clock.

## Lanes

- **Disk lane** (`study-core`, `study-ui`, `study-media`): never run `scripts/win.sh`, never launch
  Electron, never install packages on Windows. Unit tests, typecheck and lint in WSL only.
- **Run lane** (`study-testing`): the only agent that runs `scripts/win.sh`. One at a time. Stop
  every process you started before reporting.
- **Review** (`study-review`): read-only. Never edits, never commits.

## The gates

**Who runs them depends on how you were dispatched.**

- **Dispatched alone:** run the whole-tree `./check.sh` before you report, and quote its last
  lines. UI tasks also name screenshots taken by `study-testing`, or say none were taken.
- **Part of a parallel batch** (your brief says so): do **not** run the whole-tree `./check.sh`,
  and do not commit. Scoped tests on your own files are allowed (`npx vitest run <path>`). Report
  `GATES: not run — parallel batch, dispatcher gates`.
- **Told neither:** assume batched.

**A skipped gate is a failure.** Never claim green from memory. A missing tool is `BLOCKED`.

## Your budget

**Stop and report after 3 failed fix attempts on the same failure, or about 80 turns, whichever
comes first.** Write what you tried, what you learned and the failing output into your report and
return `BLOCKED`. Read large files by line range and keep command output short (`| tail -40`).

## Committing

- **Dispatched alone:** commit your own work before reporting, as Sam's git identity, with **no AI
  attribution lines** (no `Co-Authored-By`, no `Claude-Session`, no "Generated with"). Subject:
  `type(scope): a plain sentence about the behaviour`. Name the range as `<base>..<head>`.
- **In a parallel batch:** don't commit. List every file you touched.
- Never push. Never open a pull request.

## Rulings, not stalls

Nobody is watching your dispatch. An ambiguity, a plan defect, a value that turns out wrong:
decide it, log `Ruling: <decision> — <why> — <cost if wrong>`, keep going. Report `BLOCKED` only
for something destructive or irreversible (deleting user data, rewriting history), a side effect
outside this worktree, or a task so broken that every path is a guess. A change to what counts as
study time is never ruled on: it goes under `NEEDS_OWNER`.

## You do not dispatch subagents

Do all of this task's work yourself. Never spawn a reviewer; review is already scheduled.

## Report in exactly this shape

```
STATUS:     DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_OWNER
FILES:      every path created or modified (plus the commit range, if you committed)
GATES:      check.sh <result>, quoted last lines
            or: not run — parallel batch, dispatcher gates
RULINGS:    <decision> — <why> — <cost if wrong>     (repeat as needed)
NEEDS_OWNER: what only Sam can judge (a look, a change to accounting), with the exact question
CONCERNS:   anything the dispatcher must decide; screenshot paths for UI tasks
```
