#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
git_common_dir=$(git -C "$repo_root" rev-parse --git-common-dir)
case "$git_common_dir" in
  /*) ;;
  *) git_common_dir="$repo_root/$git_common_dir" ;;
esac
primary_root=$(CDPATH= cd -- "$git_common_dir/.." && pwd)

copy_approved_environment_file() {
  relative_path=$1
  source_path="$primary_root/$relative_path"
  destination_path="$repo_root/$relative_path"

  [ "$source_path" = "$destination_path" ] && return 0
  [ -e "$destination_path" ] && return 0
  [ -f "$source_path" ] || return 0

  if ! git -C "$repo_root" check-ignore -q -- "$relative_path"; then
    printf 'Refusing to copy unignored environment file: %s\n' "$relative_path" >&2
    exit 1
  fi

  mkdir -p "$(dirname -- "$destination_path")"
  cp -p "$source_path" "$destination_path"
}

copy_approved_environment_file .env
copy_approved_environment_file frontend/.env

setup_log_dir=$(mktemp -d "${TMPDIR:-/tmp}/biz-worktree-setup.XXXXXX")
cleanup_setup_logs() {
  rm -rf -- "$setup_log_dir"
}
trap cleanup_setup_logs EXIT HUP INT TERM

if [ ! -x "$repo_root/backend/.venv/bin/python" ]; then
  python3 -m venv "$repo_root/backend/.venv"
fi

if ! "$repo_root/backend/.venv/bin/python" -m pip install \
  --disable-pip-version-check \
  -r "$repo_root/backend/requirements.txt" \
  >"$setup_log_dir/pip.log" 2>&1; then
  printf 'Python dependency setup failed.\n' >&2
  tail -n 200 "$setup_log_dir/pip.log" >&2
  exit 1
fi

if ! (
  cd "$repo_root/frontend"
  npm ci
) >"$setup_log_dir/npm.log" 2>&1; then
  printf 'Frontend dependency setup failed.\n' >&2
  tail -n 200 "$setup_log_dir/npm.log" >&2
  exit 1
fi

missing_environment_files=''
for relative_path in .env frontend/.env; do
  if [ ! -f "$repo_root/$relative_path" ]; then
    missing_environment_files="$missing_environment_files $relative_path"
  fi
done

printf 'Biz worktree dependencies are ready.\n'
if [ -n "$missing_environment_files" ]; then
  printf 'Integration environment unavailable; missing:%s\n' "$missing_environment_files"
else
  printf 'Approved ignored integration environment is ready.\n'
fi
