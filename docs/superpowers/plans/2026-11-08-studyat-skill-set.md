# StudyAt repo skill set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the StudyAt repo its own Claude tooling (router skill, plan and execute skills,
agents, gates, Windows run scripts, planning docs), mirroring Sam's Stitched Off repos, so
the app can then be planned with `study-plan` and built with `study-plan-execute`.

**Architecture:** Everything lives in the repo: `.claude/skills/study-*`, `.claude/agents/study-*`,
`CLAUDE.md`, `check.sh`, `scripts/`, `docs/planning/`. A `verify-agents.sh` script is the test
for the skill/agent roster; `check.sh` is the single gate and grows app checks once a
`package.json` exists.

**Tech Stack:** Markdown skills/agents (Claude Code format), bash, `cmd.exe` interop from WSL,
rsync.

**Spec:** `docs/superpowers/specs/2026-11-08-studyat-design.md` (§8 is this plan's scope; §2–§7
are the rules the skills must encode).

**Reference (read-only):** `~/dev/StitchTrackerWebsite/.claude/` (`skills/stitch-dev/SKILL.md`,
`agent-contract.md`, `stitch-plan/SKILL.md`, `stitch-plan-execute/SKILL.md`, `agents/*.md`) and
`~/.claude/skills/mc-dev/verify-agents.sh`. Adapt their structure and wording; don't copy
StitchTracker- or Minecraft-specific content.

## Global Constraints

- All skill/agent files are repo-local under `.claude/`; nothing is written to `~/.claude/`.
- Agent roster is exactly five: `study-core`, `study-ui`, `study-media` (disk lane, parallel-safe,
  never launch the app), `study-testing` (run lane, serial: the only agent that launches the
  Windows app), `study-review` (read-only).
- Disk-lane `tools:` line exactly: `tools: Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite`.
  Review: `tools: Read, Grep, Glob, Bash`. Run lane: no `tools:` line.
- Repo rules encoded in `study-dev` verbatim in substance: focus-timer-only accounting (spec §5);
  never lose study data (checkpoint ≤15 s, daily backups, migration backups); no native Node
  modules; no LifeAt name, logos or media; Electron security (context isolation, no node
  integration, scoped media protocol, http(s) origin for YouTube); app runs on Windows via
  `scripts/win.sh`; British English copy; questions to Sam via `AskUserQuestion`, recommended
  option first.
- Git: feature branches only; commit messages carry **no** AI attribution (no `Co-Authored-By`,
  no session links, no "Generated with"). Never push or open PRs unless Sam asks.
- Windows mirror dir: `/mnt/c/Users/samue/dev/StudyAt` (Windows `C:\Users\samue\dev\StudyAt`),
  overridable with `STUDYAT_WIN_DIR`.
- `study-dev` tells sessions in this repo **not** to load superpowers process skills; the
  `study-*` skills replace them (as `stitch-dev` does).

## Review Focus

1. `check.sh` run before any `package.json` exists must pass (skip app checks with a clear
   `skip:` line), not fail — Task 1 test.
2. `scripts/win.sh` run when the mirror dir doesn't exist yet must create it, not error — Task 5 test.
3. `win-sync.sh` must never copy `node_modules`, `.git`, `out/`, `dist/` or `.claude/worktrees`
   to Windows (huge, and Linux binaries break Windows) — Task 5 test.
4. Agent `name:` mismatching its filename silently breaks dispatch — Task 1 verify check.
5. A ledger or worktree dir accidentally committed — Task 4 `.gitignore` check.

---

### Task 1: Gates — `verify-agents.sh` and `check.sh`

**Files:**
- Create: `.claude/skills/study-dev/verify-agents.sh`, `check.sh`

**Interfaces:**
- Produces: `./check.sh` (exit 0 = green) which runs `verify-agents.sh`, then, only if
  `package.json` exists, `npm run typecheck`, `npm run lint`, `npm test` (else prints
  `skip: no package.json yet`). Later plans rely on these three npm script names.

- [ ] **Step 1: Write `verify-agents.sh`** modelled on `mc-dev/verify-agents.sh`, checking, for
  `.claude/agents/` relative to repo root:
  1. exactly 5 `study-*.md` files, the names in Global Constraints;
  2. lane frontmatter (exact tools lines; run lane has none; disk lane mentions no `mcp__`);
  3. `name:` equals filename stem, description ≥ 40 chars, opening `---`;
  4. each implementer body ≤ 30 non-blank lines and contains `agent-contract.md` and
     `study-dev`;
  5. every agent name appears in `.claude/skills/study-dev/SKILL.md` and
     `.claude/skills/study-plan-execute/SKILL.md`;
  6. each of `study-dev`, `study-plan`, `study-plan-execute` has a `SKILL.md` whose frontmatter
     `name:` matches its dir and has a `description:`.
  Prints `ok`/`FAIL:` lines, exits non-zero on any FAIL.
- [ ] **Step 2: Write `check.sh`** per Interfaces (`set -euo pipefail`, run from repo root).
- [ ] **Step 3: Run `./check.sh`** — Expected: FAIL (no agents/skills yet). Confirms the test bites.
- [ ] **Step 4: Commit** `git add check.sh .claude/skills/study-dev/verify-agents.sh && git commit -m "chore: add check.sh and agent roster verifier"`

### Task 2: `study-dev` root skill, agent contract, `CLAUDE.md`

**Files:**
- Create: `.claude/skills/study-dev/SKILL.md`, `.claude/skills/study-dev/agent-contract.md`, `CLAUDE.md`

**Interfaces:**
- Produces: skill name `study-dev`; routing table (plan → `study-plan`, build a plan →
  `study-plan-execute`, small change → this skill alone); the agent roster and lanes; the
  "Where things are" table (`docs/planning/appplan.md`, `roadmap.md`, `specs/`, `plans/`,
  `reference/`, `scripts/win.sh`, `check.sh`, `assets/CREDITS.md`); the rules list.

- [ ] **Step 1: Write `SKILL.md`** (~100–130 lines) with: description covering timer, stats,
  spaces, sounds, Spotify, Electron, Windows run scripts, planning docs; the routing table; the
  "don't load superpowers process skills here" note; where-things-are table; numbered rules
  from Global Constraints with one line of *why* each, citing spec sections; the gate
  (`./check.sh`, plus "behaviour is verified in the running Windows app via `study-testing`");
  agents section listing the five with lanes; "never push / never open PRs / no AI attribution".
- [ ] **Step 2: Write `agent-contract.md`** adapted from stitch's: read brief + named appplan
  sections; stay inside the files the brief names; run `./check.sh` before reporting and quote
  its tail; disk-lane agents never launch the app or run `scripts/win.sh`; fixed report shape
  `STATUS: done|blocked|partial`, `FILES:`, `GATES:`, `CONCERNS:`, `QUESTIONS:`; budget note;
  commit only if the brief says so, with no AI attribution.
- [ ] **Step 3: Write `CLAUDE.md`** (≤ 40 lines): one paragraph on what StudyAt is, "load
  `study-dev` first for any work here", the gate, the Windows run command, the git rules.
- [ ] **Step 4: Commit** `feat(tooling): add study-dev skill, agent contract and CLAUDE.md`

### Task 3: The five agents

**Files:**
- Create: `.claude/agents/study-core.md`, `study-ui.md`, `study-media.md`, `study-testing.md`, `study-review.md`

**Interfaces:**
- Consumes: `agent-contract.md`, `study-dev` (Task 2).
- Produces: dispatchable agent names used by `study-plan-execute` (Task 4).

Each body: "Read `.claude/skills/study-dev/agent-contract.md` first … then `study-dev`", then
domain rules, then "Then do the task in your brief." Domain rules:
- [ ] **Step 1: `study-core`** — main-process timer state machine, power/lock/idle handling, session
  accounting and checkpointing, storage + migrations + backups, stats/streak/recap maths, IPC
  bridge types. Rules: unit tests with injected clocks for every accounting change (rollover
  04:00, DST, midnight-crossing, idle discard, crash recovery); no native modules; every schema
  change has a migration and a pre-migration backup.
- [ ] **Step 2: `study-ui`** — React renderer: dock, floating draggable widgets, panels, stats
  overlay and charts, recap card, settings, tasks widget. Rules: dark frosted look, keyboard
  reachable, no Node access from renderer (only the preload bridge), copy in British English,
  respects auto-hide; never invent stats maths (consume `study-core` selectors).
- [ ] **Step 3: `study-media`** — spaces (local files via scoped protocol, YouTube iframe API,
  thumbnails), soundboard (Web Audio, generated noise, seamless loops), chimes, Spotify (PKCE,
  loopback redirect, Connect control). Rules: no LifeAt assets; every bundled asset recorded in
  `assets/CREDITS.md` with source + licence; tokens never logged or committed.
- [ ] **Step 4: `study-testing`** (no `tools:` line) — the only agent that runs `scripts/win.sh`:
  syncs, installs and launches the Windows app, runs Playwright-for-Electron smoke/e2e, captures
  screenshots into its scratch dir, reports paths. Serial: one at a time.
- [ ] **Step 5: `study-review`** (`tools: Read, Grep, Glob, Bash`) — given brief, report and diff,
  checks spec compliance requirement-by-requirement and the `study-dev` rules (accounting
  honesty, data safety, Electron security, no native modules, no LifeAt assets); returns
  `VERDICT: approve|changes` with numbered findings. Never edits.
- [ ] **Step 6: Run** `bash .claude/skills/study-dev/verify-agents.sh` — Expected: sections 1–4 ok;
  section 5/6 FAIL only for the not-yet-written `study-plan*` skills.
- [ ] **Step 7: Commit** `feat(tooling): add study-* agents`

### Task 4: `study-plan` and `study-plan-execute`, planning docs, git hygiene

**Files:**
- Create: `.claude/skills/study-plan/SKILL.md`, `.claude/skills/study-plan-execute/SKILL.md`,
  `docs/planning/appplan.md`, `docs/planning/roadmap.md`, `docs/planning/specs/.gitkeep`,
  `docs/planning/plans/.gitkeep`, `docs/planning/reference/lifeat-research.md`, `.gitignore`,
  `.claude/settings.json`

**Interfaces:**
- Produces: spec/plan locations `docs/planning/specs/YYYY-MM-DD-<topic>-design.md` and
  `docs/planning/plans/YYYY-MM-DD-<topic>.md`; ledger at `.claude/ledger/<plan-stem>/progress.md`;
  worktrees under `.claude/worktrees/`.

- [ ] **Step 1: `study-plan/SKILL.md`** adapted from `stitch-plan`: pipeline (classify →
  worktree → clickable interview → approaches → spec → 👤 approve → plan → 👤 approve → fresh
  session → execute); interview checklist specific to StudyAt (accounting impact, data/migration
  impact, which widget/panel, offline behaviour, Windows-only behaviour, assets & licences,
  what the user sees on screen); plan rules (tasks name their agent and lane, test-first steps,
  exact signatures, no placeholders, Review Focus section); plans updated `roadmap.md`.
- [ ] **Step 2: `study-plan-execute/SKILL.md`** adapted from `stitch-plan-execute`: fresh session +
  worktree; ledger; spec binding over plan; conflict scan; baseline `./check.sh`; one clickable
  "dispatch vs inline" question showing task→agent→batch mapping; disk-lane tasks in parallel
  batches, run-lane tasks serial via `study-testing`; every task reviewed by `study-review`;
  end-of-plan: full `./check.sh`, a `study-testing` launch + screenshots on Windows, roadmap
  update, commit locally, then **offer** push as a next step (never push/PR unasked).
- [ ] **Step 3: Planning docs.** `appplan.md` = the design spec's content restructured as the
  living app description (keep section numbers so code can cite "appplan §5"), with a
  "Status" column per feature (all *planned*). `roadmap.md` = rows: P0 skill set (this plan,
  *done* when merged), P1 app scaffold + Windows run, P2 timer + accounting + storage, P3 stats +
  streak + recap, P4 spaces, P5 sounds + chimes, P6 tasks widget, P7 Spotify, P8 packaging +
  tray + backups polish. `lifeat-research.md` = the observations from the 2026-11-08 tour
  (features, what's paywalled, sound channel names; **no** asset URLs).
- [ ] **Step 4: `.gitignore`** (`node_modules/`, `out/`, `dist/`, `.claude/ledger/`,
  `.claude/worktrees/`, `*.log`, `.env*` except `.env.example`) and `.claude/settings.json`
  `{"worktree":{"baseRef":"head"}}`.
- [ ] **Step 5: Run `./check.sh`** — Expected: verify-agents all ok, `skip: no package.json yet`, exit 0.
- [ ] **Step 6: Commit** `feat(tooling): add study-plan, study-plan-execute and planning docs`

### Task 5: Windows run scripts

**Files:**
- Create: `scripts/win-sync.sh`, `scripts/win.sh`, `scripts/test-win-scripts.sh`

**Interfaces:**
- Produces: `scripts/win-sync.sh` (rsync repo → `${STUDYAT_WIN_DIR:-/mnt/c/Users/samue/dev/StudyAt}`,
  `--delete`, excluding `node_modules/ .git/ out/ dist/ .claude/worktrees/ .claude/ledger/`;
  creates the dir if missing); `scripts/win.sh <cmd...>` (syncs, then runs `<cmd>` via
  `cmd.exe /c` with cwd = the Windows mirror, propagating the exit code). Later plans use
  `scripts/win.sh npm install`, `scripts/win.sh npm run dev`, `scripts/win.sh npm run dist`.

- [ ] **Step 1: Write `test-win-scripts.sh`** asserting, with `STUDYAT_WIN_DIR` pointed at a fresh
  temp dir under `/mnt/c/Users/samue/AppData/Local/Temp/`:
  - `scripts/win.sh node -e "process.stdout.write(process.platform)"` prints `win32`, exit 0;
  - the mirror contains `check.sh` and `CLAUDE.md`;
  - after creating `node_modules/x` and `out/y` in the repo, a sync leaves neither in the mirror;
  - `scripts/win.sh node -e "process.exit(3)"` exits 3.
  Cleans up its temp dir and the dummy repo files.
- [ ] **Step 2: Run it** — Expected: FAIL (scripts missing).
- [ ] **Step 3: Write `win-sync.sh` and `win.sh`** per Interfaces (`wslpath -w` for the cmd cwd;
  use `cmd.exe /c "cd /d <winpath> && <cmd>"`).
- [ ] **Step 4: Run `scripts/test-win-scripts.sh`** — Expected: all pass. Then `./check.sh` green.
- [ ] **Step 5: Commit** `feat(tooling): add Windows sync and run scripts`

### Task 6: Smoke the skill set

- [ ] **Step 1:** Run `./check.sh` and `bash .claude/skills/study-dev/verify-agents.sh`; quote output.
- [ ] **Step 2:** Confirm `study-dev`, `study-plan`, `study-plan-execute` and the five agents show up
  as available in a fresh Claude Code session in this repo (list skills; `claude agents` or the
  Agent tool's type list). Note result.
- [ ] **Step 3:** Mark roadmap P0 *done (pending merge)*; commit
  `docs: mark skill set done on roadmap`. Offer Sam the push as a next step.
