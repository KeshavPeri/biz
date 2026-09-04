#!/usr/bin/env bash
set -euo pipefail

REPO="KeshavPeri/biz"

fail() {
  echo "Factory ticket preflight failed: $1" >&2
  exit 2
}

count_lines() {
  awk 'NF { count += 1 } END { print count + 0 }'
}

issue_number="${1:-}"
[[ "$issue_number" =~ ^[0-9]+$ ]] || fail "usage: $0 <ready-issue-number>"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside the Biz repository"
cd "$repo_root"

command -v gh >/dev/null 2>&1 || fail "GitHub CLI is unavailable"

building_numbers="$(gh issue list --repo "$REPO" --state open --label 'factory:building' --limit 100 --json number --jq '.[].number')"
building_count="$(printf '%s\n' "$building_numbers" | count_lines)"
[[ "$building_count" -eq 0 ]] || fail "building issue(s) already exist: ${building_numbers//$'\n'/, }"

ready_numbers="$(gh issue list --repo "$REPO" --state open --label 'factory:ready' --limit 100 --json number --jq '.[].number')"
ready_count="$(printf '%s\n' "$ready_numbers" | count_lines)"
[[ "$ready_count" -eq 1 ]] || fail "expected exactly one ready issue; found $ready_count"
[[ "$ready_numbers" == "$issue_number" ]] || fail "ready issue is #$ready_numbers, not #$issue_number"

issue_state="$(gh issue view "$issue_number" --repo "$REPO" --json state --jq '.state')"
[[ "$issue_state" == "OPEN" ]] || fail "issue #$issue_number is not open"

labels="$(gh issue view "$issue_number" --repo "$REPO" --json labels --jq '.labels[].name')"
printf '%s\n' "$labels" | grep -Fxq 'factory:ready' || fail "issue #$issue_number lacks factory:ready"
for conflicting_label in factory:planned factory:review factory:blocked; do
  if printf '%s\n' "$labels" | grep -Fxq "$conflicting_label"; then
    fail "issue #$issue_number still has conflicting label $conflicting_label"
  fi
done

metadata="$(gh issue view "$issue_number" --repo "$REPO" --json body --jq '.body | split("\n")[0]')"
metadata_pattern='^<!-- biz-factory-ticket:v3 base=([0-9a-f]{40}) dependency=(none|[0-9]+) route=(builder|senior_builder) review=(qa|combined|qa-security) regression=(affected|full) -->$'
[[ "$metadata" =~ $metadata_pattern ]] || fail "issue #$issue_number has invalid or missing v3 execution metadata"

ticket_base="${BASH_REMATCH[1]}"
dependency="${BASH_REMATCH[2]}"
route="${BASH_REMATCH[3]}"
review="${BASH_REMATCH[4]}"
regression="${BASH_REMATCH[5]}"

case "$route:$review:$regression" in
  builder:qa:affected|builder:combined:affected|senior_builder:combined:affected|senior_builder:qa-security:full) ;;
  *) fail "unsupported route/review/regression combination: $route/$review/$regression" ;;
esac

local_main="$(git rev-parse refs/heads/main)"
remote_main="$(git ls-remote --heads origin refs/heads/main | awk 'NR == 1 { print $1 }')"
[[ -n "$remote_main" ]] || fail "could not resolve GitHub main"
[[ "$local_main" == "$remote_main" ]] || fail "local main $local_main differs from GitHub main $remote_main"
[[ "$ticket_base" == "$local_main" ]] || fail "ticket base $ticket_base differs from current main $local_main; standing-orchestrator revalidation required"

if [[ "$dependency" != "none" ]]; then
  dependency_state="$(gh issue view "$dependency" --repo "$REPO" --json state --jq '.state')"
  [[ "$dependency_state" == "CLOSED" ]] || fail "dependency issue #$dependency is not closed"

  closing_prs="$(gh issue view "$dependency" --repo "$REPO" --json closedByPullRequestsReferences --jq '.closedByPullRequestsReferences[].number')"
  [[ -n "$closing_prs" ]] || fail "dependency issue #$dependency was not closed by a pull request"

  dependency_merged=false
  for pull_number in $closing_prs; do
    pull_is_merged="$(gh pr view "$pull_number" --repo "$REPO" --json state,mergedAt,baseRefName --jq '.state == "MERGED" and .mergedAt != null and .baseRefName == "main"')"
    if [[ "$pull_is_merged" == "true" ]]; then
      dependency_merged=true
      break
    fi
  done
  [[ "$dependency_merged" == "true" ]] || fail "dependency issue #$dependency has no merged pull request on main"
fi

expected_branch_prefix="codex/workplan-$issue_number-"
open_factory_heads="$(gh pr list --repo "$REPO" --state open --limit 100 --json headRefName --jq '.[].headRefName | select(startswith("codex/workplan-"))')"
for branch_name in $open_factory_heads; do
  [[ "$branch_name" == "$expected_branch_prefix"* ]] || fail "conflicting open factory pull-request branch: $branch_name"
done

local_factory_branches="$(git for-each-ref --format='%(refname:short)' 'refs/heads/codex/workplan-*')"
for branch_name in $local_factory_branches; do
  if [[ "$branch_name" == "$expected_branch_prefix"* ]]; then
    continue
  fi
  if git merge-base --is-ancestor "$branch_name" "$local_main"; then
    continue
  fi
  fail "conflicting local factory branch: $branch_name"
done

while read -r branch_sha branch_ref; do
  [[ -z "${branch_ref:-}" ]] && continue
  branch_name="${branch_ref#refs/heads/}"
  if [[ "$branch_name" == "$expected_branch_prefix"* ]]; then
    continue
  fi
  if git cat-file -e "$branch_sha^{commit}" 2>/dev/null \
    && git merge-base --is-ancestor "$branch_sha" "$remote_main"; then
    continue
  fi
  fail "conflicting remote factory branch: $branch_name"
done < <(git ls-remote --heads origin 'refs/heads/codex/workplan-*')

worktree_factory_branches="$(git worktree list --porcelain | awk '/^branch refs\/heads\/codex\/workplan-/ { sub(/^branch refs\/heads\//, ""); print }')"
for branch_name in $worktree_factory_branches; do
  [[ "$branch_name" == "$expected_branch_prefix"* ]] || fail "conflicting factory worktree branch: $branch_name"
done

echo "Factory ticket preflight passed: issue=$issue_number base=$ticket_base dependency=$dependency route=$route review=$review regression=$regression"
