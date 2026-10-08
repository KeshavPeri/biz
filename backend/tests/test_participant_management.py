"""Fictional development-Supabase acceptance checks for B3-004.

Migration 044 must be applied. The test owns run-unique users/deals, exercises
the HTTP and direct-RLS boundaries, and removes every created row in ``finally``.
"""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.term_approvals import _approver_roster  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Participant-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"participant.creator.{RUN_ID}@inflo.test", "Fictional Creator", "creator"),
    "B": (f"participant.admin.{RUN_ID}@inflo.test", "Fictional Brand Admin", "brand"),
    "M": (f"participant.maker.{RUN_ID}@inflo.test", "Fictional Brand Maker", "brand"),
    "K": (f"participant.checker.{RUN_ID}@inflo.test", "Fictional Brand Checker", "brand"),
    "N": (f"participant.member.{RUN_ID}@inflo.test", "Fictional New Member", "brand"),
    "A": (f"participant.admin2.{RUN_ID}@inflo.test", "Fictional New Admin", "brand"),
    "X": (f"participant.inactive.{RUN_ID}@inflo.test", "Fictional Invited Member", "brand"),
    "U": (f"participant.outsider.{RUN_ID}@inflo.test", "Fictional Outsider", "brand"),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": sql},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def apply_migration_044() -> None:
    management_sql((BACKEND_DIR / "migrations/044_participant_add_approval.sql").read_text())


def token_for(email: str) -> str:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY).auth.sign_in_with_password(
        {"email": email, "password": PASSWORD}
    ).session.access_token


def auth_client(email: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.auth.sign_in_with_password({"email": email, "password": PASSWORD})
    return client


def call(method: str, path: str, token: str, body: dict | None = None):
    return api.request(method, path, json=body, headers={"Authorization": f"Bearer {token}"})


def request_body(candidate_id: str, role: str, reason: str = "Help review fictional campaign work") -> dict:
    return {
        "request_id": str(uuid4()),
        "proposed_profile_id": candidate_id,
        "proposed_role": role,
        "reason": reason,
    }


def cleanup() -> None:
    users = [u for u in admin.auth.admin.list_users() if u.email in {row[0] for row in USERS.values()}]
    ids = [u.id for u in users]
    if not ids:
        return
    quoted = ",".join(f"'{value}'" for value in ids)
    management_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    deals = admin.table("deals").select("id").in_("created_by", ids).execute().data
    for deal in deals:
        admin.table("deals").delete().eq("id", deal["id"]).execute()
    memberships = admin.table("brand_members").select("brand_id").in_("profile_id", ids).execute().data
    for brand_id in {row["brand_id"] for row in memberships}:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user in users:
        admin.auth.admin.delete_user(user.id)


def main() -> None:
    cleanup()
    ids: dict[str, str] = {}
    deal_id = ""
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {"email": email, "password": PASSWORD, "email_confirm": True}
            ).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": name, "account_type": account_type,
            }).execute()

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Participant Brand {RUN_ID}", "industry": "Beauty",
        }).execute().data[0]["id"]
        other_brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Other Brand {RUN_ID}", "industry": "Travel",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["N"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["A"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["X"], "brand_role": "member", "status": "invited"},
            {"brand_id": other_brand_id, "profile_id": ids["U"], "brand_role": "member", "status": "active"},
        ]).execute()
        deal_id = admin.table("deals").insert({
            "creator_id": ids["C"], "brand_id": brand_id,
            "deal_name": f"Fictional participant approval {RUN_ID}",
            "direction": "inbound", "created_by": ids["B"], "stage": "chatting",
        }).execute().data[0]["id"]
        admin.table("deal_participants").insert([
            {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
            {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
            {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
            {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
        ]).execute()
        legacy_duplicate_deal_id = admin.table("deals").insert({
            "creator_id": ids["C"], "brand_id": brand_id,
            "deal_name": f"Fictional duplicate legacy approval {RUN_ID}",
            "direction": "inbound", "created_by": ids["B"], "stage": "chatting",
        }).execute().data[0]["id"]
        admin.table("deal_participants").insert([
            {"deal_id": legacy_duplicate_deal_id, "profile_id": ids["C"], "participant_role": "creator"},
            {"deal_id": legacy_duplicate_deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        ]).execute()
        admin.table("messages").insert({
            "deal_id": deal_id, "sender_id": ids["C"], "body": "Historical fictional deal message",
        }).execute()

        legacy_request_ids = [str(uuid4()) for _ in range(3)]
        management_sql(
            "DROP INDEX IF EXISTS uq_participant_add_pending_deal; "
            "ALTER TABLE participant_add_requests DROP CONSTRAINT IF EXISTS participant_add_pending_role_check; "
            "INSERT INTO participant_add_requests "
            "(id, deal_id, proposed_profile_id, requested_by, reason, status, approvals, proposed_role) VALUES "
            f"('{legacy_request_ids[0]}', '{deal_id}', '{ids['N']}', '{ids['C']}', 'legacy single', 'pending', '{{}}', NULL), "
            f"('{legacy_request_ids[1]}', '{legacy_duplicate_deal_id}', '{ids['N']}', '{ids['C']}', 'legacy duplicate one', 'pending', '{{}}', NULL), "
            f"('{legacy_request_ids[2]}', '{legacy_duplicate_deal_id}', '{ids['A']}', '{ids['B']}', 'legacy duplicate two', 'pending', '{{}}', NULL);"
        )
        apply_migration_044()
        legacy_rows = (
            admin.table("participant_add_requests")
            .select("id,status,decided_at,proposed_role")
            .in_("id", legacy_request_ids)
            .execute()
            .data
        )
        no_legacy_pending = all(
            not admin.rpc("participant_add_pending_for_deal", {"p_deal_id": legacy_deal_id}).execute().data
            for legacy_deal_id in (deal_id, legacy_duplicate_deal_id)
        )
        gate_after_upgrade = admin.rpc("apply_summary_gate_action", {
            "p_deal_id": legacy_duplicate_deal_id, "p_action": "request", "p_actor_id": ids["C"],
            "p_actor_side": "creator", "p_ip_address": "fictional-legacy-upgrade",
        }).execute().data
        upgrade_guards = management_sql("""
            SELECT
              NOT EXISTS (
                SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public'
                   AND tablename = 'participant_add_requests'
                   AND policyname IN (
                     'participant_add_requests_insert_participant',
                     'participant_add_requests_update_participant'
                   )
              ) AS legacy_write_policies_removed,
              NOT has_table_privilege('authenticated', 'public.participant_add_requests', 'INSERT')
                AND NOT has_table_privilege('authenticated', 'public.participant_add_requests', 'UPDATE')
                AND NOT has_table_privilege('authenticated', 'public.participant_add_requests', 'DELETE')
                AS authenticated_writes_revoked,
              EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.participant_add_requests'::regclass
                   AND conname = 'participant_add_pending_role_check'
                   AND convalidated
              ) AS pending_role_guard;
        """)[0]
        null_pending_rejected = False
        try:
            management_sql(
                "INSERT INTO participant_add_requests "
                "(id, deal_id, proposed_profile_id, requested_by, reason, status, approvals, proposed_role) "
                f"VALUES ('{uuid4()}', '{deal_id}', '{ids['N']}', '{ids['C']}', "
                "'invalid future pending', 'pending', '{}', NULL);"
            )
        except httpx.HTTPStatusError:
            null_pending_rejected = True
        check(
            "migration quarantines single and duplicate legacy pending rows before unique index",
            len(legacy_rows) == 3
            and all(row["status"] == "rejected" and row["decided_at"] for row in legacy_rows)
            and no_legacy_pending,
        )
        check(
            "upgrade restores Gate A, drops legacy writes and requires a role on future pending rows",
            gate_after_upgrade["outcome"] == "requested"
            and all(upgrade_guards.values())
            and null_pending_rejected,
        )
        tokens = {key: token_for(value[0]) for key, value in USERS.items()}

        initial_response = call("GET", f"/deals/{deal_id}/participants", tokens["C"])
        initial = initial_response.json()
        check("current participant receives four-person bounded roster", initial_response.status_code == 200 and len(initial["participants"]) == 4)
        check("eligible candidates and role choices are server-derived", {row["display_name"] for row in initial["candidates"]} == {"Fictional New Member", "Fictional New Admin"} and next(row for row in initial["candidates"] if row["display_name"] == "Fictional New Member")["eligible_roles"] == ["brand_maker", "brand_checker"])
        serialized = json.dumps(initial).lower()
        check("participant projection omits private identity and audit fields", all(key not in serialized for key in ["@inflo.test", '"email"', '"phone"', '"ip_address"', '"metadata"']))
        check("outsider and proposed person cannot view management state", call("GET", f"/deals/{deal_id}/participants", tokens["U"]).status_code == 403 and call("GET", f"/deals/{deal_id}/participants", tokens["N"]).status_code == 403)

        before_invalid = len(admin.table("participant_add_requests").select("id").eq("deal_id", deal_id).eq("status", "pending").execute().data)
        invalid_cases = [
            request_body(ids["N"], "brand_admin"),
            request_body(ids["X"], "brand_maker"),
            request_body(ids["U"], "brand_maker"),
            request_body(ids["B"], "brand_maker"),
        ]
        invalid_statuses = [call("POST", f"/deals/{deal_id}/participant-requests", tokens["C"], body).status_code for body in invalid_cases]
        creator_role = request_body(ids["N"], "creator")
        creator_role_status = call("POST", f"/deals/{deal_id}/participant-requests", tokens["C"], creator_role).status_code
        after_invalid = len(admin.table("participant_add_requests").select("id").eq("deal_id", deal_id).eq("status", "pending").execute().data)
        check("standing, inactive, different-brand, existing and creator-role candidates are rejected", invalid_statuses == [409, 409, 409, 409] and creator_role_status == 422)
        check("invalid proposals leave no request residue", before_invalid == after_invalid == 0)

        first_body = request_body(ids["N"], "brand_maker")
        created = call("POST", f"/deals/{deal_id}/participant-requests", tokens["M"], first_body)
        first_notices = admin.table("notifications").select("profile_id,tier,title,body,read,created_at").eq("deal_id", deal_id).execute().data
        check("request notice reaches each eligible approver once with database defaults",
              len(first_notices) == 3
              and {row["profile_id"] for row in first_notices} == {ids["C"], ids["B"], ids["K"]}
              and all(row["tier"] == "important" and row["title"] == "Participant request needs review"
                      and row["body"] == "A deal participant has requested a teammate addition."
                      and row["read"] is False and row["created_at"] for row in first_notices))
        retried = call("POST", f"/deals/{deal_id}/participant-requests", tokens["M"], first_body)
        check("request retry creates no duplicate notice",
              len(admin.table("notifications").select("id").eq("deal_id", deal_id).execute().data) == len(first_notices))
        changed = call("POST", f"/deals/{deal_id}/participant-requests", tokens["M"], {**first_body, "reason": "Changed fictional reason"})
        second = call("POST", f"/deals/{deal_id}/participant-requests", tokens["C"], request_body(ids["A"], "brand_admin"))
        decisions = admin.table("participant_add_decisions").select("approver_profile_id,decision").eq("request_id", first_body["request_id"]).execute().data
        normalized_request = admin.table("participant_add_requests").select("proposed_role").eq("id", first_body["request_id"]).single().execute().data
        check("normal post-upgrade request snapshots every participant with requester approved", created.status_code == 200 and normalized_request == {"proposed_role": "brand_maker"} and len(decisions) == 4 and next(row for row in decisions if row["approver_profile_id"] == ids["M"])["decision"] == "approved")
        check("exact create retry is idempotent while changed and second requests conflict", retried.status_code == 200 and changed.status_code == 409 and second.status_code == 409 and len(admin.table("participant_add_requests").select("id").eq("deal_id", deal_id).eq("status", "pending").execute().data) == 1)
        blocked = call("POST", f"/deals/{deal_id}/request-summary", tokens["C"])
        checklist = call("GET", f"/deals/{deal_id}/summary-checklist", tokens["C"]).json()
        db_blocked = False
        try:
            admin.rpc("apply_summary_gate_action", {
                "p_deal_id": deal_id, "p_action": "request", "p_actor_id": ids["C"],
                "p_actor_side": "creator", "p_ip_address": "fictional-participant-test",
            }).execute()
        except Exception as exc:
            db_blocked = "PARTICIPANT_ADD_PENDING_BLOCKS_GATE_A" in str(exc)
        check("pending request blocks Gate A in API, flags and database", blocked.status_code == 409 and checklist["participant_request_pending"] is True and checklist["summary_request_allowed"] is False and db_blocked)

        check("non-electorate outsider cannot decide", call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["U"], {"decision": "approved"}).status_code == 403)
        audit_count_before_drift = len(
            admin.table("audit_log").select("id").eq("entity_id", first_body["request_id"]).execute().data
        )
        admin.table("deals").update({"stage": "approval"}).eq("id", deal_id).execute()
        stage_drift = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["C"], {"decision": "approved"})
        exact_retry_during_drift = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["M"], {"decision": "approved"})
        admin.table("deals").update({"stage": "chatting"}).eq("id", deal_id).execute()
        summary_id = admin.table("ai_summaries").insert({
            "deal_id": deal_id, "raw_output": {}, "structured_terms": {}, "status": "pending_approval",
        }).execute().data[0]["id"]
        terms_drift = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["C"], {"decision": "approved"})
        admin.table("ai_summaries").delete().eq("id", summary_id).execute()
        unchanged_decision = (
            admin.table("participant_add_decisions")
            .select("decision,decided_at")
            .eq("request_id", first_body["request_id"])
            .eq("approver_profile_id", ids["C"])
            .single()
            .execute()
            .data
        )
        unchanged_request = (
            admin.table("participant_add_requests")
            .select("status,decided_at")
            .eq("id", first_body["request_id"])
            .single()
            .execute()
            .data
        )
        audit_count_after_drift = len(
            admin.table("audit_log").select("id").eq("entity_id", first_body["request_id"]).execute().data
        )
        check(
            "stage and terms drift reject every new vote without decision, audit or request mutation",
            stage_drift.status_code == 409
            and terms_drift.status_code == 409
            and unchanged_decision == {"decision": "pending", "decided_at": None}
            and unchanged_request == {"status": "pending", "decided_at": None}
            and audit_count_after_drift == audit_count_before_drift,
        )
        check(
            "an exact prior decision retry stays idempotent after stage drift",
            exact_retry_during_drift.status_code == 200,
        )
        check("creator approval is recorded", call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["C"], {"decision": "approved"}).status_code == 200)
        rejection = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["K"], {"decision": "rejected"})
        notice_count_after_rejection = len(admin.table("notifications").select("id").eq("deal_id", deal_id).execute().data)
        retry_rejection = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["K"], {"decision": "rejected"})
        opposite = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["K"], {"decision": "approved"})
        late = call("POST", f"/deals/{deal_id}/participant-requests/{first_body['request_id']}/decision", tokens["B"], {"decision": "approved"})
        check("rejection is final, exact retry idempotent and conflicting or late decisions fail", rejection.status_code == 200 and retry_rejection.status_code == 200 and opposite.status_code == 409 and late.status_code == 409)
        check("decision retry and failed votes add no notice",
              len(admin.table("notifications").select("id").eq("deal_id", deal_id).execute().data) == notice_count_after_rejection)
        check("rejected candidate receives no participant access", not admin.table("deal_participants").select("id").eq("deal_id", deal_id).eq("profile_id", ids["N"]).execute().data)

        final_body = request_body(ids["A"], "brand_admin", "Admin support for fictional approvals")
        check("new request can start after terminal rejection", call("POST", f"/deals/{deal_id}/participant-requests", tokens["C"], final_body).status_code == 200)
        for actor in ("M", "K"):
            check(f"{actor} approves snapshotted request", call("POST", f"/deals/{deal_id}/participant-requests/{final_body['request_id']}/decision", tokens[actor], {"decision": "approved"}).status_code == 200)

        admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_id).eq("profile_id", ids["A"]).execute()
        stale = call("POST", f"/deals/{deal_id}/participant-requests/{final_body['request_id']}/decision", tokens["B"], {"decision": "approved"})
        still_pending = admin.table("participant_add_decisions").select("decision").eq("request_id", final_body["request_id"]).eq("approver_profile_id", ids["B"]).single().execute().data["decision"]
        check("finalization revalidates membership and rolls back the failed final vote", stale.status_code == 409 and still_pending == "pending" and not admin.table("deal_participants").select("id").eq("deal_id", deal_id).eq("profile_id", ids["A"]).execute().data)
        admin.table("brand_members").update({"status": "active"}).eq("brand_id", brand_id).eq("profile_id", ids["A"]).execute()

        def final_vote():
            # Separate backend workers/clients exercise the database lock and
            # idempotency path without sharing TestClient/httpx transports.
            worker = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            result = worker.rpc("apply_participant_add_decision", {
                "p_deal_id": deal_id,
                "p_request_id": final_body["request_id"],
                "p_actor_id": ids["B"],
                "p_decision": "approved",
                "p_ip_address": "fictional-concurrent-final-vote",
            }).execute().data
            return result["status"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            final_statuses = list(pool.map(lambda _: final_vote(), range(2)))
        admitted = admin.table("deal_participants").select("participant_role").eq("deal_id", deal_id).eq("profile_id", ids["A"]).execute().data
        check("concurrent final vote and retry admit exactly once with approved role", final_statuses == ["approved", "approved"] and admitted == [{"participant_role": "brand_admin"}])

        new_client = auth_client(USERS["A"][0])
        new_deal = new_client.table("deals").select("id").eq("id", deal_id).execute().data
        new_history = new_client.table("messages").select("id").eq("deal_id", deal_id).execute().data
        new_client.table("messages").insert({"deal_id": deal_id, "sender_id": ids["A"], "body": "New fictional participant message"}).execute()
        outsider_client = auth_client(USERS["U"][0])
        check("admitted teammate gains historical deal/message access and can send", len(new_deal) == 1 and len(new_history) == 1 and len(admin.table("messages").select("id").eq("deal_id", deal_id).eq("sender_id", ids["A"]).execute().data) == 1)
        check("outsider remains denied after admission", outsider_client.table("deals").select("id").eq("id", deal_id).execute().data == [] and outsider_client.table("messages").select("id").eq("deal_id", deal_id).execute().data == [])
        roster = _approver_roster(admin, deal_id, str(uuid4()))
        check("subsequent Gate-B roster counts the admitted participant", len(roster) == 5 and any(row["profile_id"] == ids["A"] and row["role"] == "brand_admin" for row in roster))

        participant_client = auth_client(USERS["C"][0])
        direct_denials = []
        for operation in (
            lambda: participant_client.table("participant_add_requests").insert({
                "deal_id": deal_id, "proposed_profile_id": ids["N"], "requested_by": ids["C"], "reason": "forged",
            }).execute(),
            lambda: participant_client.table("participant_add_decisions").insert({
                "request_id": final_body["request_id"], "approver_profile_id": ids["C"], "decision": "approved", "decided_at": "2026-09-08T00:00:00Z",
            }).execute(),
            lambda: participant_client.table("deal_participants").insert({
                "deal_id": deal_id, "profile_id": ids["N"], "participant_role": "brand_maker",
            }).execute(),
            lambda: participant_client.table("deal_participants").update({"participant_role": "brand_admin"}).eq("deal_id", deal_id).eq("profile_id", ids["C"]).execute(),
        ):
            try:
                operation()
                direct_denials.append(False)
            except Exception:
                direct_denials.append(True)
        participant_client.table("deal_participants").update({"last_read_at": "2026-09-08T00:00:00Z"}).eq("deal_id", deal_id).eq("profile_id", ids["C"]).execute()
        check("direct request, decision, participant insert and role pivot are denied", all(direct_denials))
        check("existing own last-read update remains available", admin.table("deal_participants").select("last_read_at").eq("deal_id", deal_id).eq("profile_id", ids["C"]).single().execute().data["last_read_at"] is not None)

        audits = admin.table("audit_log").select("action,metadata,ip_address").in_("entity_id", [first_body["request_id"], final_body["request_id"]]).execute().data
        audit_blob = json.dumps(audits).lower()
        check("creation, decisions, rejection and admission produce immutable metadata-only audits", {"participant_add_requested", "participant_add_decided", "participant_add_rejected", "participant_added"}.issubset({row["action"] for row in audits}) and "fictional campaign" not in audit_blob and "@inflo.test" not in audit_blob)
        notifications = admin.table("notifications").select("profile_id,tier,title,body").in_("profile_id", list(ids.values())).eq("deal_id", deal_id).execute().data
        notification_blob = json.dumps(notifications).lower()
        check("generic post-commit notifications contain no candidate or reason details", len(notifications) >= 5 and all(value not in notification_blob for value in ["fictional new", "campaign", "@inflo.test"]))
        check("completed participant decisions notify only the requester",
              all(row["profile_id"] == ids["M"] for row in notifications
                  if row["title"] in {"Teammate added", "Participant request declined"}))
        participant_reader = auth_client(USERS["C"][0])
        outsider_reader = auth_client(USERS["U"][0])
        check("participant notice ledger is recipient-scoped",
              all(row["profile_id"] == ids["C"] for row in participant_reader.table("notifications").select("profile_id").eq("deal_id", deal_id).execute().data)
              and outsider_reader.table("notifications").select("id").eq("deal_id", deal_id).execute().data == [])

    finally:
        cleanup()

    passed = sum(1 for _, ok in checks if ok)
    print(f"RESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
