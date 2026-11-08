#!/usr/bin/env bash
# The single gate for StudyAt. Green (exit 0) before any commit that claims a task done.
set -euo pipefail
cd "$(dirname "$0")"

echo "### skills and agents"
bash .claude/skills/study-dev/verify-agents.sh

echo "### app"
if [ -f package.json ]; then
  npm run --silent typecheck
  npm run --silent lint
  npm test --silent

  # Nothing from LifeAt (study-dev rule 7): no mention anywhere in source or assets.
  if grep -rIil lifeat src assets 2>/dev/null; then
    echo "check.sh: the files above mention LifeAt" >&2
    exit 1
  fi

  # Every bundled sound and image is credited in assets/CREDITS.md (study-dev rule 7).
  if [ -d assets ]; then
    uncredited=0
    while IFS= read -r -d '' f; do
      if ! grep -qF -- "$(basename "$f")" assets/CREDITS.md 2>/dev/null; then
        echo "not credited in assets/CREDITS.md: $f" >&2
        uncredited=1
      fi
    done < <(find assets/sounds assets/images -type f -print0 2>/dev/null)
    [ "$uncredited" -eq 0 ] || exit 1
  fi
else
  echo "skip: no package.json yet"
fi
echo "check.sh: green"
