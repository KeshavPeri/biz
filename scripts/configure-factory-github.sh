#!/bin/sh
set -eu

if ! command -v gh >/dev/null 2>&1; then
  printf 'GitHub CLI is required.\n' >&2
  exit 1
fi

gh auth status >/dev/null
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

gh label create 'factory:planned' --repo "$repo" --color 'C5DEF5' --description 'Detailed ticket prepared; waiting for founder release' --force
gh label create 'factory:ready' --repo "$repo" --color '1F883D' --description 'Reviewed and available for the next factory run' --force
gh label create 'factory:building' --repo "$repo" --color 'BF8700' --description 'Claimed by an active or recoverable factory run' --force
gh label create 'factory:review' --repo "$repo" --color '8250DF' --description 'Draft pull request is ready for owner review' --force
gh label create 'factory:blocked' --repo "$repo" --color 'CF222E' --description 'Owner input, external action, dependency, or specification change is required' --force
gh label create 'risk:high' --repo "$repo" --color 'B60205' --description 'Requires senior builder and independent security review' --force
gh label create 'manual:test' --repo "$repo" --color '0969DA' --description 'Requires founder, device, browser, live-AI, or external-service evidence' --force

printf 'Configured Biz factory labels for %s\n' "$repo"
