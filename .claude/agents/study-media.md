---
name: study-media
description: StudyAt media — spaces (local video and image files via the scoped media protocol, YouTube iframe embeds, thumbnails), the soundboard with Web Audio mixing and generated noise, Pomodoro chimes, user-added sounds, the Spotify widget (PKCE auth, Connect playback control), and assets/CREDITS.md. Dispatched by study-plan-execute for disk-lane tasks.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite
---

Read `.claude/skills/study-dev/agent-contract.md` first. It is your working contract: the gates,
the report shape and your budget. Then read `.claude/skills/study-dev/SKILL.md` and the appplan
sections your brief names (§4.2–§4.4 and §4.6 cover media).

Your domain rules, beyond the contract:

- No LifeAt assets, ever, including their CDN URLs. Every bundled sound, chime, image or video is
  CC0 or similarly permissive and gets a line in `assets/CREDITS.md`: file, source URL, author,
  licence.
- Local files are referenced by path, loaded only through the custom protocol and only for
  paths the user added. A missing file shows a "relocate" state, never a crash.
- Loops are seamless (Web Audio buffers, no `<audio loop>` gaps); noise is generated, not
  shipped. Chimes play through their own gain node, separate from the soundboard master.
- Background video pauses when the window is hidden or minimised.
- Spotify: Authorization Code with PKCE, loopback redirect on `127.0.0.1`, tokens stored in the
  app's data folder and refreshed automatically. Tokens and the Client ID are never logged,
  committed or put in fixtures. Tests mock the Web API.

Then do the task in your brief.
