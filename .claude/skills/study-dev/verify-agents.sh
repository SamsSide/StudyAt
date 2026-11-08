#!/usr/bin/env bash
# Verifies the study-* agent roster and skills in this repo. Run after any edit to
# .claude/agents/, agent-contract.md, study-dev or study-plan-execute. check.sh runs it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENTS="$ROOT/.claude/agents"; SKILLS="$ROOT/.claude/skills"

DISK="study-core study-ui study-media"
RUN="study-testing"
REVIEW="study-review"
ALL="$DISK $RUN $REVIEW"
TOOLS_LINE="tools: Read, Write, Edit, Bash, Grep, Glob, Skill, TodoWrite"
REVIEW_TOOLS="tools: Read, Grep, Glob, Bash"

fails=0; mark=0
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
sect() { mark=$fails; }
pass() { [ "$fails" -eq "$mark" ] && echo "  ok  $*"; }
fm()   { awk 'NR>1 && /^---$/{exit} NR>1{print}' "$1"; }
body() { awk 'c==2{print} /^---$/{c++}' "$1"; }

echo "== 1. roster is exactly five agents =="; sect
count=$(find "$AGENTS" -maxdepth 1 -name 'study-*.md' 2>/dev/null | wc -l)
[ "$count" -eq 5 ] || fail "expected 5 study-*.md agents in $AGENTS, found $count"
for a in $ALL; do [ -f "$AGENTS/$a.md" ] || fail "missing agent $a.md"; done
pass "five agents present"

echo "== 2. lanes are enforced by frontmatter =="; sect
for a in $DISK; do f="$AGENTS/$a.md"; [ -f "$f" ] || continue
  fm "$f" | grep -qxF "$TOOLS_LINE" || fail "$a: disk-lane tools: line missing or not exact"
  grep -q 'mcp__' "$f" && fail "$a: disk-lane agent references mcp__"; done
for a in $RUN; do f="$AGENTS/$a.md"; [ -f "$f" ] || continue
  fm "$f" | grep -q '^tools:' && fail "$a: run-lane agent must have no tools: line"; done
f="$AGENTS/$REVIEW.md"; [ -f "$f" ] && { fm "$f" | grep -qxF "$REVIEW_TOOLS" || fail "$REVIEW: must be read-only ($REVIEW_TOOLS)"; }
pass "lane frontmatter"

echo "== 3. identity: name matches filename, description present =="; sect
for a in $ALL; do f="$AGENTS/$a.md"; [ -f "$f" ] || continue
  [ "$(head -1 "$f")" = "---" ] || fail "$a: no opening --- fence"
  n=$(fm "$f" | sed -n 's/^name:[[:space:]]*//p' | head -1)
  [ "$n" = "$a" ] || fail "$a: frontmatter name is '$n'"
  d=$(fm "$f" | sed -n 's/^description:[[:space:]]*//p' | head -1)
  [ "${#d}" -ge 40 ] || fail "$a: description shorter than 40 chars"; done
pass "identity"

echo "== 4. agents are thin and point at the contract and study-dev =="; sect
for a in $ALL; do f="$AGENTS/$a.md"; [ -f "$f" ] || continue
  b=$(body "$f"); lines=$(printf '%s\n' "$b" | grep -cve '^[[:space:]]*$')
  [ "$lines" -le 30 ] || fail "$a: body is $lines lines, limit 30"
  printf '%s\n' "$b" | grep -qF 'agent-contract.md' || fail "$a: body doesn't point at agent-contract.md"
  printf '%s\n' "$b" | grep -qF 'study-dev' || fail "$a: body doesn't load study-dev"; done
pass "thin agents"

echo "== 5. every agent is named by study-dev and study-plan-execute =="; sect
for s in study-dev study-plan-execute; do f="$SKILLS/$s/SKILL.md"
  [ -f "$f" ] || { fail "$s/SKILL.md missing"; continue; }
  for a in $ALL; do grep -qF "$a" "$f" || fail "$s doesn't name agent $a"; done; done
pass "roster named in host skills"

echo "== 6. skills exist with matching frontmatter =="; sect
for s in study-dev study-plan study-plan-execute; do f="$SKILLS/$s/SKILL.md"
  [ -f "$f" ] || { fail "skill $s has no SKILL.md"; continue; }
  [ "$(head -1 "$f")" = "---" ] || fail "$s: no opening --- fence"
  n=$(fm "$f" | sed -n 's/^name:[[:space:]]*//p' | head -1)
  [ "$n" = "$s" ] || fail "$s: frontmatter name is '$n'"
  fm "$f" | grep -q '^description:' || fail "$s: no description"; done
[ -f "$SKILLS/study-dev/agent-contract.md" ] || fail "study-dev/agent-contract.md missing"
pass "skills"

echo
if [ "$fails" -eq 0 ]; then echo "verify-agents: all checks passed"; else echo "verify-agents: $fails failure(s)"; exit 1; fi
