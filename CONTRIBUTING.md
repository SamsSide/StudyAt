# Contributing to StudyAt

Thanks for wanting to help. StudyAt is a small personal project, so a short note before a big
change saves us both time.

## Ways to help

- **Report a bug:** [open an issue](https://github.com/SamsSide/StudyAt/issues/new). Include:
  - what you did, what you expected, and what happened instead;
  - your StudyAt version (the installer's name, or Windows Settings → Apps) and your Windows version;
  - a screenshot if it's visual.

  Please **don't attach your database or backups**. They hold your study history.
- **Suggest a feature:** open an issue first, so we can agree it fits before you write code. Some
  things are out of scope on purpose:
  - accounts, cloud sync, rooms and chat;
  - any way to add study time by hand;
  - anything copied from LifeAt.
- **Send a pull request:** small, focused PRs are easiest to review. For anything bigger than a
  fix, open an issue first.

## Getting set up

See [Developing](README.md#developing) in the README. In short, on Windows:

```bash
npm ci
npm run dev
```

Before you open a pull request, run the gate:

```bash
npm run typecheck && npm run lint && npm test
```

If you work from WSL like the main repo does, `./check.sh` runs all three, and
`scripts/win.sh npm run dev` launches the app on Windows. For UI or timer changes, run
`npm run build && npm run e2e` on Windows too.

## The rules the code follows

These come from [`docs/planning/appplan.md`](docs/planning/appplan.md). A pull request that
breaks one won't be merged, however nice the feature.

1. **Only focus-timer time is study time** (appplan §5).
   - Breaks, pauses, idle time, sleep, a locked PC and "the app is open" never count.
   - There is no manual "add time".
2. **Never lose study data.**
   - Every schema change ships as a new migration. Migrations that have shipped are never edited.
   - In-progress sessions are checkpointed, and backups are taken before migrations.
3. **Time maths takes an injected clock.**
   - Stats, streaks and accounting code never calls `Date.now()`.
   - Tests cover day rollover (04:00 by default), Monday–Sunday weeks, daylight-saving changes and
     sessions that cross midnight.
4. **The timer lives in the main process.** The renderer only displays it and sends commands
   through the typed preload API.
5. **Electron security stays on:**
   - context isolation on and node integration off;
   - a sandboxed renderer and a typed preload API only;
   - local media through the scoped protocol, never `file://`.
6. **No native Node modules.** It must install with plain `npm` on Windows, so no
   `better-sqlite3` and no `node-gyp`.
7. **Bundled media must be CC0 or similarly permissive,** and recorded in
   [`assets/CREDITS.md`](assets/CREDITS.md). Nothing from LifeAt: no name, look, audio, video or
   images.
8. **Copy is British English,** calm and short.

## Pull requests

- Branch from `main`, and keep each PR to one change.
- Add or update tests:
  - unit tests (Vitest) next to the code;
  - Playwright e2e tests in `e2e/` for behaviour you can only see in the running app.
- Commit subjects look like `type(scope): a plain sentence`, for example
  `fix(timer): keep the subject when a break is skipped`. Types are `feat`, `fix`, `refactor`,
  `test`, `docs` and `chore`.
- Comments say what is true and why. Cite the design as `appplan §N` where it applies.
- For UI changes, put before and after screenshots in the PR description.
- If the change alters behaviour, update `docs/planning/appplan.md` in the same PR.

## Licence of contributions

StudyAt is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). By opening a
pull request you agree that your contribution is released under the same licence. You also agree
that the maintainer may include it in StudyAt under these terms.
