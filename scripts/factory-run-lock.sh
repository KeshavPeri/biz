#!/usr/bin/env bash

set -euo pipefail

EXIT_ALREADY_RUNNING=75
DEFAULT_TTL_SECONDS=64800
LOCK_NAME="biz-factory-run.lock"

usage() {
  echo "Usage: $0 {acquire|renew|release} <owner-token> | status" >&2
  exit 64
}

fail() {
  echo "$1" >&2
  exit "${2:-1}"
}

validate_owner() {
  local owner="${1:-}"
  case "$owner" in
    ""|*[!A-Za-z0-9._:-]*)
      fail "Owner token must contain only letters, numbers, dot, underscore, colon, or hyphen." 64
      ;;
  esac
}

resolve_lock_dir() {
  local common_dir
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || fail "Run this command inside the Biz Git repository."
  if [[ "$common_dir" != /* ]]; then
    common_dir="$(cd "$common_dir" && pwd -P)" || fail "Cannot resolve the shared Git directory."
  fi
  LOCK_DIR="$common_dir/$LOCK_NAME"
  OWNER_FILE="$LOCK_DIR/owner"
  HEARTBEAT_FILE="$LOCK_DIR/heartbeat"
}

mtime_epoch() {
  local path="$1"
  if stat -f '%m' "$path" >/dev/null 2>&1; then
    stat -f '%m' "$path"
  else
    stat -c '%Y' "$path"
  fi
}

heartbeat_age() {
  local source_path="$LOCK_DIR"
  local modified now
  [[ -e "$HEARTBEAT_FILE" ]] && source_path="$HEARTBEAT_FILE"
  modified="$(mtime_epoch "$source_path")" || fail "Cannot read the factory lock timestamp."
  now="$(date +%s)"
  echo $((now - modified))
}

read_owner() {
  if [[ -f "$OWNER_FILE" ]]; then
    tr -d '\r\n' < "$OWNER_FILE"
  else
    echo "unknown"
  fi
}

cleanup_exact_lock_dir() {
  local target="$1"
  rm -f -- "$target/owner" "$target/heartbeat"
  rmdir -- "$target" 2>/dev/null || fail "Refusing to remove a lock directory containing unexpected files: $target"
}

acquire_lock() {
  local owner="$1"
  local ttl_seconds="${BIZ_FACTORY_LOCK_TTL_SECONDS:-$DEFAULT_TTL_SECONDS}"
  local age existing_owner stale_dir

  [[ "$ttl_seconds" =~ ^[0-9]+$ ]] || fail "BIZ_FACTORY_LOCK_TTL_SECONDS must be a non-negative integer." 64

  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      umask 077
      printf '%s\n' "$owner" > "$OWNER_FILE"
      : > "$HEARTBEAT_FILE"
      echo "Factory lock acquired: $owner"
      return 0
    fi

    [[ -d "$LOCK_DIR" ]] || fail "Factory lock path exists but is not a directory: $LOCK_DIR"
    age="$(heartbeat_age)"
    existing_owner="$(read_owner)"
    if (( age < ttl_seconds )); then
      echo "Factory already running (owner: $existing_owner; heartbeat age: ${age}s)." >&2
      exit "$EXIT_ALREADY_RUNNING"
    fi

    stale_dir="${LOCK_DIR}.stale.$(date +%s).$$"
    if mv -- "$LOCK_DIR" "$stale_dir" 2>/dev/null; then
      cleanup_exact_lock_dir "$stale_dir"
      echo "Recovered stale factory lock previously owned by $existing_owner." >&2
    fi
  done
}

renew_lock() {
  local owner="$1"
  local existing_owner
  [[ -d "$LOCK_DIR" ]] || fail "No factory lock exists to renew."
  existing_owner="$(read_owner)"
  [[ "$existing_owner" == "$owner" ]] || fail "Factory lock belongs to $existing_owner; refusing to renew it as $owner."
  touch "$HEARTBEAT_FILE"
  echo "Factory lock renewed: $owner"
}

release_lock() {
  local owner="$1"
  local existing_owner
  [[ -d "$LOCK_DIR" ]] || fail "No factory lock exists to release."
  existing_owner="$(read_owner)"
  [[ "$existing_owner" == "$owner" ]] || fail "Factory lock belongs to $existing_owner; refusing to release it as $owner."
  cleanup_exact_lock_dir "$LOCK_DIR"
  echo "Factory lock released: $owner"
}

show_status() {
  local age
  if [[ ! -d "$LOCK_DIR" ]]; then
    echo "Factory lock: free"
    return 0
  fi
  age="$(heartbeat_age)"
  echo "Factory lock: held by $(read_owner) (heartbeat age: ${age}s)"
}

main() {
  local command="${1:-}"
  local owner="${2:-}"
  resolve_lock_dir

  case "$command" in
    acquire)
      [[ $# -eq 2 ]] || usage
      validate_owner "$owner"
      acquire_lock "$owner"
      ;;
    renew)
      [[ $# -eq 2 ]] || usage
      validate_owner "$owner"
      renew_lock "$owner"
      ;;
    release)
      [[ $# -eq 2 ]] || usage
      validate_owner "$owner"
      release_lock "$owner"
      ;;
    status)
      [[ $# -eq 1 ]] || usage
      show_status
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
