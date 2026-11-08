#!/usr/bin/env bash
# Mirrors this repo to a Windows folder so Electron, npm install and packaging run natively there.
# Excluded paths are never copied, and never deleted on the Windows side, so the mirror keeps its
# own Windows node_modules and build output between runs.
#   STUDYAT_WIN_DIR  mirror location (default /mnt/c/Users/samue/dev/StudyAt)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${STUDYAT_WIN_DIR:-/mnt/c/Users/samue/dev/StudyAt}"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules/ --exclude .git/ --exclude out/ --exclude dist/ --exclude release/ \
  --exclude .claude/worktrees/ --exclude .claude/ledger/ --exclude .superpowers/ \
  "$ROOT/" "$DEST/"
echo "synced $ROOT -> $DEST"
