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
else
  echo "skip: no package.json yet"
fi
echo "check.sh: green"
