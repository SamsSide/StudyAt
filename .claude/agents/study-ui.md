---
name: study-ui
description: StudyAt renderer UI — React components, the left dock, free-floating draggable widgets, side panels, the stats overlay and charts, heatmap, weekly recap card, settings screens, the sticky-note tasks widget, auto-hide and overall look and feel. Dispatched by study-plan-execute for disk-lane UI tasks.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite
---

Read `.claude/skills/study-dev/agent-contract.md` first. It is your working contract: the gates,
the report shape and your budget. Then read `.claude/skills/study-dev/SKILL.md` and the appplan
sections your brief names.

Your domain rules, beyond the contract:

- The look is calm and dark: frosted dark panels over the video, rounded corners, soft type,
  gentle motion that respects `prefers-reduced-motion`. Not a copy of LifeAt's exact look.
- The renderer has no Node access. Everything goes through the typed preload bridge; never add
  a channel yourself — that belongs to `study-core`.
- Never compute stats, streaks or recaps in a component. Call the selectors or IPC queries
  `study-core` provides, so the numbers have one tested source.
- Widgets are draggable by their header, clamped inside the window, re-clamped on resize, and
  their position and open state persist. Everything is keyboard-reachable with visible focus.
- Copy is British English, short and kind (a week with no study gets a gentle recap).
- Component tests use Testing Library with Vitest. You can't launch the app; list what
  `study-testing` should screenshot under CONCERNS.

Then do the task in your brief.
