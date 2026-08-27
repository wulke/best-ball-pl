#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${1:-claude}"
ISSUE_NUMBER=""
HANDOFF_FILE=""

# Parse --issue and --handoff flags
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue=*)
      ISSUE_NUMBER="${1#--issue=}"
      [[ -z "$ISSUE_NUMBER" ]] && { echo "Error: --issue= requires a number." >&2; exit 1; }
      shift
      ;;
    --issue)
      [[ -z "${2:-}" ]] && { echo "Error: --issue requires a number." >&2; exit 1; }
      ISSUE_NUMBER="$2"
      shift 2
      ;;
    --handoff=*)
      HANDOFF_FILE="${1#--handoff=}"
      [[ -z "$HANDOFF_FILE" ]] && { echo "Error: --handoff= requires a path." >&2; exit 1; }
      shift
      ;;
    --handoff)
      [[ -z "${2:-}" ]] && { echo "Error: --handoff requires a path." >&2; exit 1; }
      HANDOFF_FILE="$2"
      shift 2
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done
AGENT="${args[0]:-claude}"

if [[ -n "$HANDOFF_FILE" ]]; then
  [[ ! -f "$HANDOFF_FILE" ]] && { echo "Error: Handoff file not found: $HANDOFF_FILE" >&2; exit 1; }
  [[ ! -r "$HANDOFF_FILE" ]] && { echo "Error: Handoff file is not readable: $HANDOFF_FILE" >&2; exit 1; }
fi

# Returns "in-progress" if the issue has that label, exits on other blocking conditions.
validate_issue() {
  local issue="$1"
  local number
  number=$(echo "$issue" | jq -r '.number')

  local state
  state=$(echo "$issue" | jq -r '.state')
  [[ "$state" == "CLOSED" ]] && { echo "Error: Issue #$number is already closed." >&2; exit 1; }

  local blocking_label
  blocking_label=$(echo "$issue" | jq -r '.labels | map(.name) | .[] | select(. == "blocked" or . == "needs-info" or . == "needs-triage" or . == "in-progress")' | head -1)

  if [[ "$blocking_label" == "in-progress" ]]; then
    echo "in-progress"
    return 0
  fi

  [[ -n "$blocking_label" ]] && { echo "Error: Issue #$number has label \"$blocking_label\"." >&2; exit 1; }

  local body deps
  body=$(echo "$issue" | jq -r '.body')
  deps=$(echo "$body" | awk 'tolower($0) ~ /^## *(blocked by|depends on)/{f=1;next} /^##/{f=0} f{print}' | grep -oE '#[0-9]+' | tr -d '#' || true)
  for dep in $deps; do
    local dep_state
    dep_state=$(gh issue view "$dep" --json state | jq -r '.state')
    [[ "$dep_state" == "OPEN" ]] && { echo "Error: Issue #$number is blocked by open issue #$dep." >&2; exit 1; }
  done
  return 0
}

# Checks out the PR branch for an in-progress issue and returns PR metadata.
# Prints: "<pr_number> <branch>" on success, exits on error.
pickup_pr() {
  local issue_number="$1"

  # Find open PRs referencing this issue
  local prs
  prs=$(gh pr list --state open --json number,title,headRefName,body \
    --search "Closes #${issue_number}" --limit 10)

  local pr_count
  pr_count=$(echo "$prs" | jq 'length')

  if [[ "$pr_count" -eq 0 ]]; then
    echo "Warning: Issue #${issue_number} is marked in-progress but no open PR was found. Continuing without PR context." >&2
    printf 'NO_PR'
    return 0
  fi

  if [[ "$pr_count" -gt 1 ]]; then
    echo "Error: Multiple open PRs found for issue #${issue_number}. Resolve manually." >&2
    exit 1
  fi

  local pr_number pr_branch pr_description pr_diff
  pr_number=$(echo "$prs" | jq -r '.[0].number')
  pr_branch=$(echo "$prs" | jq -r '.[0].headRefName')
  pr_description=$(echo "$prs" | jq -r '.[0].body')

  # Abort if working tree is dirty
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: Uncommitted local changes detected. Stash or commit them before picking up PR #${pr_number}." >&2
    exit 1
  fi

  echo "Checking out branch: $pr_branch" >&2
  git checkout "$pr_branch"
  git pull

  # Bring in merged work from main
  git fetch origin main
  if ! git merge origin/main --no-edit 2>&1; then
    echo "Error: Merge conflicts when integrating origin/main into ${pr_branch}. Resolve conflicts manually, then re-run." >&2
    exit 1
  fi

  pr_diff=$(gh pr diff "$pr_number" 2>/dev/null || echo "(diff unavailable)")

  # Output structured pickup context for the caller
  printf '%s\n---PR_DESCRIPTION---\n%s\n---PR_DIFF---\n%s' \
    "$pr_number" "$pr_description" "$pr_diff"
}

if [[ -n "$ISSUE_NUMBER" ]]; then
  if ! selected=$(gh issue view "$ISSUE_NUMBER" --json number,title,labels,body,state); then
    echo "Error: Could not fetch issue #$ISSUE_NUMBER." >&2
    exit 1
  fi
  validation_result=$(validate_issue "$selected")
else
  issues_json=$(gh issue list --state open --json number,title,labels,body --limit 100)
  [[ -z "$issues_json" || "$issues_json" == "[]" ]] && { echo "Error: No open issues found." >&2; exit 1; }

  open_numbers=$(echo "$issues_json" | jq '[.[].number]')

  candidates=$(echo "$issues_json" | jq -c '
    map(select(.labels | map(.name) | any(. == "blocked" or . == "needs-info" or . == "needs-triage" or . == "in-progress") | not)) |
    sort_by(if (.labels | map(.name) | any(. == "bug")) then 0 elif (.labels | map(.name) | any(. == "ready-for-agent")) then 1 else 2 end) | .[]')

  selected=""
  while IFS= read -r issue; do
    body=$(echo "$issue" | jq -r '.body')
    deps=$(echo "$body" | awk 'tolower($0) ~ /^## *(blocked by|depends on)/{f=1;next} /^##/{f=0} f{print}' | grep -oE '#[0-9]+' | tr -d '#' || true)
    has_open_dep=false
    for dep in $deps; do
      echo "$open_numbers" | jq -e "contains([$dep])" > /dev/null 2>&1 && { has_open_dep=true; break; }
    done
    $has_open_dep || { selected="$issue"; break; }
  done <<< "$candidates"

  [[ -z "$selected" ]] && { echo "Error: No actionable issues found." >&2; exit 1; }
  validation_result=""
fi

echo "Working on #$(echo "$selected" | jq -r '.number'): $(echo "$selected" | jq -r '.title')"

commits=$(git log -n 5 --format="[%H] %ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
prompt=$(cat "$SCRIPT_DIR/prompt.md")

context="$prompt

## Recent Commits (last 5)
$commits

## Your Task
Work on and close issue #$(echo "$selected" | jq -r '.number'): $(echo "$selected" | jq -r '.title')

$(echo "$selected" | jq -r '.body')"

if [[ -n "$HANDOFF_FILE" ]]; then
  context="$context

## Handoff Notes
$(cat "$HANDOFF_FILE")"
fi

# If picking up an in-progress PR, append resume context
if [[ "${validation_result:-}" == "in-progress" ]]; then
  pickup_output=$(pickup_pr "$(echo "$selected" | jq -r '.number')")

  if [[ "$pickup_output" == "NO_PR" ]]; then
    context="$context

## Resuming In-Progress Work (No PR Found)
This issue was marked in-progress but no open PR exists — work was likely interrupted before a PR was created.
Check for any local branch related to this issue (e.g. \`git branch --list '*$(echo "$selected" | jq -r '.number')*'\`), check it out if present, then continue implementing from where things left off."
  else
    pr_number=$(echo "$pickup_output" | awk '/---PR_DESCRIPTION---/{exit} {print}')
    pr_description=$(echo "$pickup_output" | awk '/---PR_DESCRIPTION---/{f=1;next} /---PR_DIFF---/{f=0} f{print}')
    pr_diff=$(echo "$pickup_output" | awk '/---PR_DIFF---/{f=1;next} f{print}')

    context="$context

## Resuming In-Progress Work
You are picking up an existing PR (#${pr_number}) for this issue. The branch has already been checked out and merged with the latest main.

### PR Description
${pr_description}

### PR Diff (current state of the branch)
\`\`\`diff
${pr_diff}
\`\`\`

Do not re-do work already reflected in the diff above. Focus on what remains unfinished, any review feedback, or new requirements described in the issue or its comments."
  fi
fi

if [[ "$AGENT" == "codex" ]]; then
  codex "$context"
elif [[ "$AGENT" == "pi" ]]; then
  pi "$context"
else
  claude --permission-mode acceptEdits "$context"
fi
