#!/usr/bin/env bash
# Runs a command on Windows inside the synced mirror of this repo and returns its exit code.
#   scripts/win.sh npm ci
#   scripts/win.sh npm run dev
#   STUDYAT_WIN_DIR  mirror location (default /mnt/c/Users/samue/dev/StudyAt)
# Arguments reach the program unchanged. When the program is itself a .cmd shim (npm, npx),
# cmd re-parses them inside the shim, so keep cmd metacharacters (& | < > ^ %) out of those.
set -uo pipefail
[ "$#" -gt 0 ] || { echo "usage: scripts/win.sh <command...>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${STUDYAT_WIN_DIR:-/mnt/c/Users/samue/dev/StudyAt}"
"$HERE/win-sync.sh" >&2 || exit $?

# Quote one argument the way Windows programs split argv (CommandLineToArgvW rules).
winquote() {
  local a="$1" out="" bs=0 c i
  if [[ -n "$a" && ! "$a" =~ [[:space:]\"] ]]; then printf '%s' "$a"; return; fi
  for ((i = 0; i < ${#a}; i++)); do
    c="${a:i:1}"
    if [ "$c" = '\' ]; then bs=$((bs + 1)); continue; fi
    if [ "$c" = '"' ]; then out+="$(printf '\\%.0s' $(seq 1 $((bs * 2 + 1))))\""
    else ((bs)) && out+="$(printf '\\%.0s' $(seq 1 $bs))"; out+="$c"; fi
    bs=0
  done
  ((bs)) && out+="$(printf '\\%.0s' $(seq 1 $((bs * 2))))"
  printf '"%s"' "$out"
}

# Then make cmd pass the line through literally: %% for the batch-file % pass, and a caret before
# every other metacharacter (quotes included, so cmd's quote state never toggles). No `call`,
# which would run a second expansion pass.
line=""
for a in "$@"; do line+="${line:+ }$(winquote "$a")"; done
line="${line//%/%%}"
esc=""
for ((i = 0; i < ${#line}; i++)); do
  c="${line:i:1}"
  case "$c" in '^'|'&'|'|'|'<'|'>'|'('|')'|'!'|'"') esc+="^$c" ;; *) esc+="$c" ;; esac
done

# The batch file lives next to the mirror, not in it, so a concurrent sync can't delete it.
bat="${DEST%/}.run-$$-$RANDOM.cmd"
trap 'rm -f "$bat"' EXIT
printf '@echo off\r\ncd /d "%s"\r\n%s\r\n' "$(wslpath -w "$DEST")" "$esc" > "$bat"
cd /mnt/c || exit 1   # cmd.exe can't start in a WSL path
cmd.exe /d /c "$(wslpath -w "$bat")"
