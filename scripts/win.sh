#!/usr/bin/env bash
# Runs a command on Windows inside the synced mirror of this repo and returns its exit code.
#   scripts/win.sh npm install
#   scripts/win.sh npm run dev
#   STUDYAT_WIN_DIR  mirror location (default /mnt/c/Users/samue/dev/StudyAt)
set -uo pipefail
[ "$#" -gt 0 ] || { echo "usage: scripts/win.sh <command...>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${STUDYAT_WIN_DIR:-/mnt/c/Users/samue/dev/StudyAt}"
"$HERE/win-sync.sh" >&2 || exit $?

# Quote each argument the way Windows programs parse argv, and double % for the batch file.
line=""
for a in "$@"; do
  if [[ "$a" =~ [[:space:]\"\&\|\<\>\^] || -z "$a" ]]; then
    a="\"${a//\"/\\\"}\""
  fi
  line+="${line:+ }${a//%/%%}"
done

# WSL can't pass a nested-quoted command line to cmd.exe reliably, so run a throwaway batch file.
bat="$DEST/.win-run-$$.cmd"
trap 'rm -f "$bat"' EXIT
printf '@echo off\r\ncd /d "%s"\r\ncall %s\r\nexit /b %%errorlevel%%\r\n' "$(wslpath -w "$DEST")" "$line" > "$bat"
cd /mnt/c || exit 1   # cmd.exe can't start in a WSL path
cmd.exe /d /c "$(wslpath -w "$bat")"
