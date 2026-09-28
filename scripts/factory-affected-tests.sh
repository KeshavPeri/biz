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
    backend/services/disclosure_service.py|backend/api/tracking.py|backend/migrations/*disclosure*tracker*.sql|backend/tests/test_disclosure_tracker.py|frontend/src/lib/disclosures*.ts|frontend/src/components/tracker/disclosure-card.tsx|frontend/src/app/disclosures.tsx|frontend/src/app/\(tabs\)/track.tsx|frontend/src/app/_layout.tsx|frontend/tests/disclosures-state.test.mjs)
      add_command 'backend/.venv/bin/python backend/tests/test_disclosure_tracker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deliverable_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_extraction_unit.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_extraction_db.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_alignment.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      add_command 'cd frontend && NODE_NO_WARNINGS=1 node --test --experimental-strip-types tests/disclosures-state.test.mjs tests/usage-rights-state.test.mjs tests/exclusivity-state.test.mjs tests/blackouts-state.test.mjs tests/tracker-state.test.mjs'
      ;;
    backend/migrations/*chat*attachment*.sql|backend/services/chat_attachment_service.py|backend/api/chat_attachments.py|backend/tests/test_chat_attachments.py|frontend/src/lib/chat-attachment*.ts|frontend/src/components/deal/chat-attachment.tsx|frontend/tests/chat-attachments.test.mjs|frontend/src/app/deal/\[id\].tsx)
      add_command 'backend/.venv/bin/python backend/tests/test_chat_attachments.py'
      add_command 'backend/.venv/bin/python backend/tests/test_storage_rls.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deal_close.py'
      add_command 'backend/.venv/bin/python backend/tests/test_chat_archive.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      add_command 'cd frontend && NODE_NO_WARNINGS=1 node --test --experimental-strip-types tests/chat-attachments.test.mjs'
      ;;
    backend/services/deal_name_service.py|backend/migrations/*deal*name*.sql|backend/tests/test_deal_name.py|frontend/src/components/deal/deal-name-sheet.tsx|frontend/src/lib/deal-name-context-fence.ts|frontend/tests/deal-name-context-fence.test.mjs)
      add_command 'backend/.venv/bin/python backend/tests/test_deal_name.py'
      add_command 'backend/.venv/bin/python backend/tests/test_chat_archive.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      add_command 'cd frontend && NODE_NO_WARNINGS=1 node --test --experimental-strip-types tests/deal-name-context-fence.test.mjs'
      ;;
    backend/services/participant_service.py|backend/migrations/*participant*add*.sql|backend/tests/test_participant_management.py|frontend/src/components/deal/participant-sheet.tsx)
      add_command 'backend/.venv/bin/python backend/tests/test_participant_management.py'
      add_command 'backend/.venv/bin/python backend/tests/test_summary_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/post_close_service.py|backend/services/chat_archive_service.py|backend/migrations/*post_close*.sql|backend/tests/test_post_close.py|backend/tests/test_chat_archive.py)
      add_command 'backend/.venv/bin/python backend/tests/test_post_close.py'
      add_command 'backend/.venv/bin/python backend/tests/test_chat_archive.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deal_close.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/close_service.py|backend/migrations/*deal*close*.sql|backend/tests/test_deal_close.py)
      add_command 'backend/.venv/bin/python backend/tests/test_deal_close.py'
      add_command 'backend/.venv/bin/python backend/tests/test_payment_tracking.py'
      add_command 'backend/.venv/bin/python backend/tests/test_disputes.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/dispute_service.py|backend/migrations/*payment*dispute*.sql|backend/tests/test_disputes.py)
      add_command 'backend/.venv/bin/python backend/tests/test_disputes.py'
      add_command 'backend/.venv/bin/python backend/tests/test_payment_tracking.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/payment_tracking_service.py|backend/migrations/*payment*tracking*.sql|backend/tests/test_payment_tracking.py)
      add_command 'backend/.venv/bin/python backend/tests/test_payment_tracking.py'
      add_command 'backend/.venv/bin/python backend/tests/test_payment_details.py'
      add_command 'backend/.venv/bin/python backend/tests/test_posting_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_extraction_unit.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
  esac

  case "$changed_path" in
    backend/*) backend_changed=true ;;
    frontend/*) frontend_changed=true ;;
  esac

  case "$changed_path" in
    backend/services/payment_details_service.py|backend/migrations/*payment*details*gate*.sql|backend/tests/test_payment_details.py)
      add_command 'backend/.venv/bin/python backend/tests/test_payment_details.py'
      add_command 'backend/.venv/bin/python backend/tests/test_posting_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/services/url_verifier.py|backend/services/posting_service.py|backend/migrations/036_live_post_gate.sql|backend/tests/test_url_verifier.py|backend/tests/test_posting_gate.py)
      add_command 'backend/.venv/bin/python backend/tests/test_url_verifier.py'
      add_command 'backend/.venv/bin/python backend/tests/test_posting_gate.py'
      add_command 'backend/.venv/bin/python backend/tests/test_content_approval.py'
      add_command 'backend/.venv/bin/python backend/tests/test_content_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deliverable_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_private_deliverable_labels.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
    backend/migrations/*private*deliverable*label*.sql|backend/tests/test_private_deliverable_labels.py|frontend/src/lib/private-deliverable-labels.ts|frontend/src/components/deal/private-deliverable-label-picker.tsx|frontend/src/components/deal/deliverables-card.tsx|frontend/src/components/deal/sticky-action-bar.tsx)
      add_command 'backend/.venv/bin/python backend/tests/test_private_deliverable_labels.py'
      add_command 'backend/.venv/bin/python backend/tests/test_content_approval.py'
      add_command 'backend/.venv/bin/python backend/tests/test_deliverable_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_stage_engine.py'
      add_command 'backend/.venv/bin/python backend/tests/test_term_approvals.py'
      add_command 'backend/.venv/bin/python backend/tests/test_maker_checker.py'
      add_command 'backend/.venv/bin/python backend/tests/test_contract_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_brief_flow.py'
      add_command 'backend/.venv/bin/python backend/tests/test_rls.py'
      ;;
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
    backend/services/deliverable_service.py|backend/migrations/*canonical*deliverable*.sql|backend/tests/test_deliverable_flow.py)
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
    frontend/src/lib/post-close-context-fence.ts|frontend/tests/post-close-context-fence.test.mjs|frontend/src/components/deal/sticky-action-bar.tsx)
      add_command 'cd frontend && NODE_NO_WARNINGS=1 node --test --experimental-strip-types tests/post-close-context-fence.test.mjs'
      ;;
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
