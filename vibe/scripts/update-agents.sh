#!/usr/bin/env bash
# Update local .claude/agents files from their upstream GitHub sources.
# Safe to run from any directory: always resolves paths relative to the project root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BASE="https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main/categories/04-quality-security"

LOCAL_PATHS=(
  ".claude/agents/architect-reviewer.md"
  ".claude/agents/code-reviewer.md"
  ".claude/agents/ui-ux-tester.md"
)

REMOTE_URLS=(
  "$BASE/architect-reviewer.md"
  "$BASE/code-reviewer.md"
  "$BASE/ui-ux-tester.md"
)

updated=0
skipped=0
errors=0

for i in "${!LOCAL_PATHS[@]}"; do
  LOCAL_REL="${LOCAL_PATHS[$i]}"
  REMOTE="${REMOTE_URLS[$i]}"
  LOCAL="$PROJECT_ROOT/$LOCAL_REL"

  REMOTE_CONTENT=$(curl -sf "$REMOTE") || {
    echo "ERROR  $LOCAL_REL — download failed ($REMOTE)"
    (( errors++ )) || true
    continue
  }

  if [ ! -f "$LOCAL" ]; then
    mkdir -p "$(dirname "$LOCAL")"
    printf '%s\n' "$REMOTE_CONTENT" > "$LOCAL"
    echo "NEW    $LOCAL_REL"
    (( updated++ )) || true
    continue
  fi

  LOCAL_CONTENT=$(cat "$LOCAL")
  if [ "$REMOTE_CONTENT" = "$LOCAL_CONTENT" ]; then
    echo "OK     $LOCAL_REL"
    (( skipped++ )) || true
  else
    printf '%s\n' "$REMOTE_CONTENT" > "$LOCAL"
    echo "UPDATE $LOCAL_REL"
    (( updated++ )) || true
  fi
done

echo ""
echo "Done. Updated: $updated  Already up-to-date: $skipped  Errors: $errors"
