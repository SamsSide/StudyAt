---
name: study-core
description: StudyAt core logic — the main-process Pomodoro timer state machine, power/lock/idle handling, focus-only session accounting and 15 s checkpoints, storage, migrations and backups, stats, streak and weekly-recap maths, IPC and preload types, the system tray. Dispatched by study-plan-execute for disk-lane tasks.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite
---

Read `.claude/skills/study-dev/agent-contract.md` first. It is your working contract: the gates,
the report shape and your budget. Then read `.claude/skills/study-dev/SKILL.md` and the appplan
sections your brief names (§5 for anything that touches time).

Your domain rules, beyond the contract:

- Only focus-timer running time is recorded. Pauses, breaks, suspend, lock and discarded idle
  stretches never accrue. A change to that rule is `NEEDS_OWNER`, never a ruling.
- Every accounting, streak, stats or recap function takes its clock or "now" as a parameter.
  Tests cover: 04:00 rollover, a session crossing midnight (credited to the start day), DST
  forward and back, Monday–Sunday week edges, streak threshold boundaries (24:59 vs 25:00),
  idle keep vs discard, crash recovery from the last checkpoint, segments under 1 minute dropped.
- In-progress sessions are persisted at start and checkpointed at least every 15 s. Writes are
  atomic (write temp file, then rename).
- No native modules. Every schema change ships a numbered migration, a test that migrates a
  fixture of the previous version, and a backup taken before it runs.
- The renderer gets data only through typed IPC channels you define in the shared types; keep
  them narrow and validate inputs in main.

Then do the task in your brief.
