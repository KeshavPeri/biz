#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
require_integration_environment=false

if [ "${1:-}" = "--require-integration-env" ]; then
  require_integration_environment=true
elif [ "$#" -gt 0 ]; then
  printf 'Usage: %s [--require-integration-env]\n' "$0" >&2
  exit 2
fi

if [ ! -x "$repo_root/backend/.venv/bin/python" ]; then
  printf 'Preflight failed: backend virtual environment is missing.\n' >&2
  exit 1
fi

if [ ! -d "$repo_root/frontend/node_modules" ]; then
  printf 'Preflight failed: frontend dependencies are missing.\n' >&2
  exit 1
fi

missing_environment_files=''
for relative_path in .env frontend/.env; do
  if [ -f "$repo_root/$relative_path" ]; then
    if ! git -C "$repo_root" check-ignore -q -- "$relative_path"; then
      printf 'Preflight failed: %s exists but is not ignored.\n' "$relative_path" >&2
      exit 1
    fi
  else
    missing_environment_files="$missing_environment_files $relative_path"
  fi
done

if [ "$require_integration_environment" = true ] && [ -n "$missing_environment_files" ]; then
  printf 'Preflight failed: integration tests require:%s\n' "$missing_environment_files" >&2
  exit 1
fi

if git -C "$repo_root" ls-files --error-unmatch Checklist_new_rows.xlsx >/dev/null 2>&1; then
  printf 'Preflight failed: protected Checklist_new_rows.xlsx is tracked.\n' >&2
  exit 1
fi

printf 'Factory preflight passed.'
if [ -n "$missing_environment_files" ]; then
  printf ' Integration environment not requested; missing:%s' "$missing_environment_files"
fi
printf '\n'
