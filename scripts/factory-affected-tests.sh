#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mode=list
base_ref=origin/main

if [ "${1:-}" = "--run" ]; then
  mode=run
  shift
elif [ "${1:-}" = "--list" ]; then
  shift
fi

if [ "$#" -gt 1 ]; then
  printf 'Usage: %s [--list|--run] [base-ref]\n' "$0" >&2
  exit 2
fi
[ "$#" -eq 1 ] && base_ref=$1

if ! git -C "$repo_root" rev-parse --verify "$base_ref^{commit}" >/dev/null 2>&1; then
  printf 'Unknown base ref: %s\n' "$base_ref" >&2
  exit 1
fi

affected_tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/biz-affected-tests.XXXXXX")
cleanup_affected_tmp() {
  rm -rf -- "$affected_tmp_dir"
}
trap cleanup_affected_tmp EXIT HUP INT TERM

changed_paths="$affected_tmp_dir/changed-paths.txt"
commands_file="$affected_tmp_dir/commands.txt"
{
  git -C "$repo_root" diff --name-only "$base_ref" --
  git -C "$repo_root" ls-files --others --exclude-standard
} | sed '/^$/d' | sort -u >"$changed_paths"
: >"$commands_file"

add_command() {
  command_text=$1
  if ! grep -Fqx -- "$command_text" "$commands_file"; then
    printf '%s\n' "$command_text" >>"$commands_file"
  fi
}

backend_changed=false
frontend_changed=false

while IFS= read -r changed_path; do
  case "$changed_path" in
    backend/*) backend_changed=true ;;
    frontend/*) frontend_changed=true ;;
  esac

  case "$changed_path" in
    backend/services/content_service.py|backend/services/maker_checker.py|backend/api/maker_checker.py|backend/migrations/*content*.sql|backend/tests/test_content_flow.py|backend/tests/test_content_approval.py|frontend/src/components/deal/content-submission-sheet.tsx)
      add_command 'backend/.venv/bin/python backend/tests/test_content_approval.py'
      add_command 'backend/.venv/bin/python backend/tests/test_content_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deliverable_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_brief_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/deliverable_service.py|backend/migrations/*canonical*deliverable*.sql|backend/tests/test_deliverable_flow.py|frontend/src/components/deal/deliverables-card.tsx)
      add_command 'backend/.venv/bin/python backend/tests/test_deliverable_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_brief_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/brief_service.py|backend/migrations/*creative*brief*.sql|backend/tests/test_brief_flow.py)
      add_command 'backend/.venv/bin/python backend/tests/test_brief_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/ai_service.py|backend/services/term_extraction.py|backend/migrations/*chat*summary*.sql)
      add_command 'backend/.venv/bin/python backend/tests/test_ai_service.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_extraction_unit.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_extraction_db.py'
      add_command 'backend/.venv/bin/python backend/tests/test_summary_gate_unit.py'
      add_command 'backend/.venv/bin/python backend/tests/test_summary_gate.py'
      ;;
    backend/services/term_approvals.py|backend/migrations/*term*approval*.sql|backend/tests/test_term_approvals.py)
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_summary_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/contract_alignment.py|backend/services/contract_service.py|backend/migrations/*contract*.sql|backend/tests/test_contract_alignment*.py)
      add_command 'backend/.venv/bin/python backend/tests/test_contract_alignment_unit.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_alignment.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_template.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/stage_engine.py|backend/migrations/*.sql)
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/core/auth.py|backend/api/auth.py|backend/migrations/*rls*.sql)
      add_command 'backend/.venv/bin/python backend/tests/test_auth_session.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/api/deals.py)
      add_command 'backend/.venv/bin/python backend/tests/test_brief_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_summary_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      ;;
  esac

  case "$changed_path" in
    frontend/package.json|frontend/package-lock.json)
      add_command 'cd frontend && npm run lint'
      add_command 'cd frontend && npx expo export --platform web'
      ;;
  esac
done <"$changed_paths"

[ "$backend_changed" = true ] && add_command 'backend/.venv/bin/python -m compileall -q backend'
[ "$frontend_changed" = true ] && add_command 'cd frontend && npx tsc --noEmit'
add_command 'git diff --check'

if [ "$mode" = list ]; then
  printf 'Affected-test floor for %s:\n' "$base_ref"
  sed 's/^/- /' "$commands_file"
  exit 0
fi

command_index=0
while IFS= read -r command_text; do
  command_index=$((command_index + 1))
  command_log="$affected_tmp_dir/command-$command_index.log"
  if (cd "$repo_root" && sh -c "$command_text") >"$command_log" 2>&1; then
    printf 'PASS — %s\n' "$command_text"
    tail -n 8 "$command_log"
  else
    printf 'FAIL — %s\n' "$command_text" >&2
    tail -n 200 "$command_log" >&2
    exit 1
  fi
done <"$commands_file"
