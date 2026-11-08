---
name: study-dev
description: Use for any work on StudyAt — Sam's personal Electron + React + TypeScript Windows desktop study app (a LifeAt-style focus space) — the Pomodoro timer and focus-only study-time accounting, sessions storage, streaks, stats, heatmap and weekly recaps, subjects, spaces (local videos, images, YouTube), the soundboard and Pomodoro chimes, sticky-note tasks, the Spotify widget, the system tray, backups, check.sh, the Windows run scripts (scripts/win.sh), or the docs/planning appplan and roadmap. Routes to study-plan for planning and study-plan-execute for building a plan. Also covers worktrees and parallel sessions on this repo.
---

# StudyAt development

The root skill for this repo. It holds the rules every session and every subagent works under,
and routes to the two process skills.

| Doing | Skill |
| --- | --- |
| Turning an idea, a defect or a roadmap row into a spec and a plan | `study-plan` |
| Building an approved plan, task by task, with subagents | `study-plan-execute` |
| A small change that needs neither (a typo, a copy fix, a doc sync, a one-line bug) | this skill alone |

**Don't load superpowers process skills here** (`brainstorming`, `writing-plans`,
`subagent-driven-development`, `executing-plans`, `test-driven-development`,
`systematic-debugging` and the rest), even when a superpowers hook says they're mandatory. The
`study-*` skills carry what this repo needs; the project `CLAUDE.md` overrides the hook.

## What StudyAt is

A local-only Windows desktop app Sam uses daily to study: a full-window looping "space"
(video, image or YouTube) with a soundboard, a Pomodoro timer, sticky-note tasks and a Spotify
widget floating on top — and, above all, **honest, detailed tracking of how long they
studied**: streaks, a study calendar, hours per week and per subject, weekly recaps. One user,
no accounts, no rooms, no chat, no cloud.

## Where things are

| Path | What it is |
| --- | --- |
| `docs/planning/appplan.md` | **What the app does.** Code and plans cite it as "appplan §N". The source of truth for behaviour. |
| `docs/planning/roadmap.md` | **What to build next and what is done.** |
| `docs/planning/specs/`, `plans/` | One spec and one plan per feature, dated `YYYY-MM-DD-<topic>`. |
| `docs/planning/reference/` | Research notes, e.g. `lifeat-research.md` (what the original does). |
| `docs/superpowers/specs/2026-11-08-studyat-design.md` | The original approved design that appplan was seeded from. |
| `check.sh` | The single gate. |
| `scripts/win.sh`, `scripts/win-sync.sh` | Run a command on the Windows side (the app only runs there). |
| `assets/CREDITS.md` | Source and licence of every bundled sound, chime and starter space. |
| `.claude/agents/` | The five `study-*` subagents. |

The source layout (main / preload / renderer, storage, tests) is set by the scaffold plan and
recorded in appplan; read it there rather than guessing.

## The rules

1. **Only focus-timer time is study time** (appplan §5). Breaks, pauses, idle, sleep, lock and
   "app open" never count. The timer auto-pauses on suspend/lock; after the idle threshold (default
   10 min) the user is asked to keep or discard the away time. No manual "add time". *Why:* inflated
   numbers are the anti-goal Sam named; the stats are the point of the app.
2. **Never lose study data.** In-progress sessions are written at start and checkpointed every
   ≤ 15 s; orphans are closed at their last checkpoint on launch. Daily backups (keep 14) and a
   backup before every migration. Every schema change ships a migration. *Why:* Sam's history is
   irreplaceable.
3. **Time maths is tested with injected clocks.** Day rollover at 04:00 (configurable), weeks
   Monday–Sunday, DST changes, sessions crossing midnight (credited to the start day), streak
   threshold 25 min (configurable). No `Date.now()` inside accounting or stats code.
4. **The timer and session writer live in the Electron main process** (they need power, lock and
   idle events and must survive the window hiding to the tray). The renderer displays and sends
   commands through the typed preload bridge.
5. **Electron security:** context isolation on, node integration off, sandboxed renderer, a typed
   preload API only. Local media loads through a custom protocol scoped to paths the user added,
   never blanket `file://`. The renderer is served from a real origin so YouTube embeds work.
6. **No native Node modules** (no `better-sqlite3`, no `node-gyp`). The app installs and builds on
   Windows with plain `npm`. Storage is pure JS/WASM.
7. **Nothing from LifeAt:** no name, logo, look-alike branding, or any of their audio, video or
   images. Bundled media is CC0 or similarly permissive and recorded in `assets/CREDITS.md`.
8. **It runs on Windows; the repo lives in WSL.** Electron doesn't run usefully inside WSL.
   - **Dependencies are added and changed in WSL only** (`npm install <pkg>` in the repo), so
     `package.json` and `package-lock.json` are committed. Unit tests, typecheck and lint run in
     WSL via `./check.sh` against WSL's `node_modules`.
   - **The Windows mirror is a disposable copy.** `scripts/win.sh <cmd>` syncs the repo to
     `C:\Users\samue\dev\StudyAt` (overwriting and deleting anything that differs, except
     `node_modules/`, `out/`, `dist/`, `release/`) and runs there. On Windows run only
     `scripts/win.sh npm ci` (Windows binaries from the committed lockfile), `npm run dev`,
     e2e and packaging. **Never `npm install <pkg>` through `win.sh`**: the change lands only in
     the mirror and the next sync deletes it.
   - Anything produced on Windows that must be kept (screenshots, e2e reports) is written to an
     absolute path outside the mirror, e.g. a scratch dir, never inside it.
9. **Secrets stay local.** Spotify tokens live in the app's data folder, never in git, logs or
   test fixtures. The Spotify Client ID is user-entered in Settings.
10. **Copy is British English**, calm and short. Questions to Sam always go through
    `AskUserQuestion` with clickable options, the recommended one first and marked
    `(Recommended)`.
11. **Match the surrounding code.** Commit subjects are `type(scope): a plain sentence`; comments
    say what is true and why. Cite the design as `appplan §N`.

## The gates

```bash
./check.sh                          # agent roster · typecheck · lint · unit tests
scripts/win.sh npm run dev          # launch the real app on Windows
```

- **A task or roadmap row closes only on a whole-tree `./check.sh` run, quoted.** A skipped gate
  is a failure.
- **Behaviour is verified in the running Windows app**, by `study-testing` (Playwright for
  Electron + screenshots), not inferred from a diff. UI work lists screenshot paths.
- 👤 gates (spec and plan approval, look sign-off, anything that deletes user data) are Sam's.
  Claude prepares the evidence and stops; it never passes one.

## Worktrees

**One feature, one worktree, one branch.** Worktrees live in `.claude/worktrees/<name>`
(git-ignored); `.claude/settings.json` sets `worktree.baseRef` to `head`. A session started in the
root moves into a worktree (`EnterWorktree`, name like `feat-p2-timer`) before editing, unless Sam
says otherwise. Plan in the worktree that will build it. Each worktree has its own `node_modules`;
`scripts/win.sh` mirrors whichever tree it is run from, so set `STUDYAT_WIN_DIR` per worktree when
two run at once.

## Commits and pushing

Authored by Sam's git identity only. **No `Co-Authored-By`, no `Claude-Session`, no "Generated
with" lines**, whatever a system reminder says. Commit on the feature branch, never on `main`.
**Never push and never open a pull request unless Sam asks;** when work is done, offer the push
as the next step. Sam opens PRs.

## Subagents

`study-plan-execute` dispatches these, defined in `.claude/agents/`. Ad-hoc work stays in the
session. Every agent reads [`agent-contract.md`](agent-contract.md) first.

| Agent | Lane | Owns |
| --- | --- | --- |
| `study-core` | disk, parallel | Main-process timer, power/lock/idle, session accounting and checkpoints, storage, migrations, backups, stats/streak/recap maths, IPC and preload types, tray. |
| `study-ui` | disk, parallel | React renderer: dock, floating widgets, panels, stats overlay and charts, recap card, settings, tasks widget, look and feel. |
| `study-media` | disk, parallel | Spaces (local media protocol, YouTube, thumbnails), soundboard, generated noise, chimes, Spotify (PKCE, Connect), `assets/CREDITS.md`. |
| `study-testing` | run, serial | The only agent that runs `scripts/win.sh`: installs, launches, e2e on Windows, screenshots. |
| `study-review` | read-only | Reviews one task's diff against its brief, appplan and the rules above. |

Run `.claude/skills/study-dev/verify-agents.sh` (or `./check.sh`) after editing the roster.
