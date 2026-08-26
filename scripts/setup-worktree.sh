#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -x "$repo_root/backend/.venv/bin/python" ]; then
  python3 -m venv "$repo_root/backend/.venv"
fi

"$repo_root/backend/.venv/bin/python" -m pip install --disable-pip-version-check -r "$repo_root/backend/requirements.txt"

(
  cd "$repo_root/frontend"
  npm ci
)

printf 'Biz worktree dependencies are ready.\n'
