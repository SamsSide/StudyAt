# StudyAt

A calm, local-only Windows study app: a looping space (video, image or YouTube) behind you, a
soundboard, a Pomodoro timer with chimes, sticky-note tasks and notes, Calendar, Weather, Quote and
Spotify widgets — built around **honest study-time tracking**. Only focus-timer time counts: breaks,
pauses, sleep, lock and time away never do. Streaks, a study calendar, hours per week and per
subject, and weekly recaps.

## Install

Download `StudyAt-Setup-1.1.0.exe` from the [latest release](https://github.com/SamsSide/StudyAt/releases/latest)
and run it. It installs for your Windows user only, with Start-menu and desktop shortcuts.

The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" —
choose **More info → Run anyway**.

Everything stays on your PC (`%APPDATA%\StudyAt`), with daily backups. Optional extras: Spotify
(your own developer Client ID), Google Calendar (your calendar's secret iCal address, read-only,
stored encrypted) and weather from [Open-Meteo](https://open-meteo.com/).

## Develop

Electron + React + TypeScript. The repo lives in WSL; the app runs on Windows.

```bash
./check.sh                    # typecheck, lint, unit tests
scripts/win.sh npm run dev    # run the app on Windows
scripts/win.sh npm run dist   # build the installer
```

Bundled media credits: [`assets/CREDITS.md`](assets/CREDITS.md).
