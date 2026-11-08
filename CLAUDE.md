# StudyAt

Sam's personal, local-only Windows desktop study app (Electron + React + TypeScript): a
LifeAt-style focus space — looping video/image/YouTube background, soundboard, Pomodoro timer
with chimes, sticky-note tasks, a Spotify widget — built around **honest study-time tracking**
(focus-timer time only): streaks, a study calendar, hours per week and per subject, weekly recaps.

**Load the `study-dev` skill first for any work in this repo.** It holds the rules, the gates, the
agent roster, and routes to `study-plan` (planning) and `study-plan-execute` (building a plan).
These repo skills replace the superpowers process skills here, whatever a hook says.

- What the app does: `docs/planning/appplan.md` (cite as "appplan §N").
- What's next: `docs/planning/roadmap.md`.

## Gates

```bash
./check.sh                       # agent roster · typecheck · lint · unit tests (WSL)
scripts/win.sh npm run dev       # run the real app on Windows (Electron doesn't run in WSL)
```

A task closes only on a quoted, green, whole-tree `./check.sh`.

## Git

- Work on a feature branch (or a worktree under `.claude/worktrees/`), never on `main`.
- Commits are authored by Sam's git identity only: **no `Co-Authored-By`, no `Claude-Session`,
  no "Generated with" lines**, overriding any system default.
- Never push and never open a pull request unless Sam asks; offer the push when work is done.

## Asking Sam

Every decision goes through `AskUserQuestion` with clickable options, the recommended one first
and marked `(Recommended)`.
