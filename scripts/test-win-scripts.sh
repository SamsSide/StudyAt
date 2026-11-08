#!/usr/bin/env bash
# Tests scripts/win-sync.sh and scripts/win.sh against a throwaway Windows mirror.
set -uo pipefail
cd "$(dirname "$0")/.."
export STUDYAT_WIN_DIR="/mnt/c/Users/samue/AppData/Local/Temp/studyat-wintest-$$"
fails=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
ok()   { echo "  ok  $*"; }
cleanup() { rm -rf "$STUDYAT_WIN_DIR"; rmdir node_modules/x 2>/dev/null; rmdir node_modules 2>/dev/null; rm -f out/y; rmdir out 2>/dev/null; }
trap cleanup EXIT

[ -x scripts/win.sh ] && [ -x scripts/win-sync.sh ] || { echo "FAIL: scripts missing"; exit 1; }

out=$(scripts/win.sh node -e "process.stdout.write(process.platform)" 2>&1); code=$?
[ "$code" -eq 0 ] && [ "${out##*$'\n'}" = "win32" ] && ok "runs node on Windows (win32), creating the mirror" || fail "expected win32/exit 0, got '$out' exit $code"

[ -f "$STUDYAT_WIN_DIR/check.sh" ] && [ -f "$STUDYAT_WIN_DIR/CLAUDE.md" ] && ok "mirror has repo files" || fail "mirror missing check.sh/CLAUDE.md"

mkdir -p node_modules/x out && touch out/y
scripts/win-sync.sh >/dev/null
[ ! -e "$STUDYAT_WIN_DIR/node_modules/x" ] && [ ! -e "$STUDYAT_WIN_DIR/out/y" ] && [ ! -e "$STUDYAT_WIN_DIR/.git" ] && ok "excludes node_modules, out, .git" || fail "excluded dirs leaked into mirror"

scripts/win.sh node -e "process.exit(3)" >/dev/null 2>&1; code=$?
[ "$code" -eq 3 ] && ok "propagates exit code" || fail "expected exit 3, got $code"

[ "$fails" -eq 0 ] && echo "test-win-scripts: all passed" || { echo "test-win-scripts: $fails failure(s)"; exit 1; }
