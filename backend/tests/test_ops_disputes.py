"""Development-Supabase coverage for platform-ops dispute resolution."""

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


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Ops-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"ops.creator.{RUN_ID}@inflo.test", "Fictional Ops Creator +91 98765 43210", "creator"),
    "B": (f"ops.brand.{RUN_ID}@inflo.test", "Fictional Ops Brand", "brand"),
    "O": (f"ops.active.{RUN_ID}@inflo.test", "Fictional Operations One", "brand"),
    "P": (f"ops.peer.{RUN_ID}@inflo.test", "Fictional Operations Two", "creator"),
    "I": (f"ops.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Operations", "brand"),
    "X": (f"platform-ops.{RUN_ID}@inflo.test", "Fictional Spoofed Operations", "brand"),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_id: str | None = None
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {MANAGEMENT_CREDENTIAL}"},
        json={"query": sql},
        timeout=60,
    )
    if not response.is_success:
        raise RuntimeError(f"Management SQL failed ({response.status_code})")
    return response.json()


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def call(
    method: str,
    path: str,
    actor: str | None,
    payload: object | None = None,
    headers: dict[str, str] | None = None,
):
    request_headers = dict(headers or {})
    if actor is not None:
        request_headers["Authorization"] = f"Bearer {tokens[actor]}"
    return api.request(method, path, headers=request_headers, json=payload)


def make_deal(label: str, *, structured: bool = False) -> dict[str, str]:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"],
        "brand_id": brand_id,
        "deal_name": f"Fictional {label} user@internalbox https://private.example.test +44 20 7946 0958",
        "direction": "inbound",
        "created_by": ids["B"],
        "stage": "payment",
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
    ]).execute()
    summary_id = admin.table("ai_summaries").insert({
        "deal_id": deal_id,
        "raw_output": {"source": "fictional ops fixture"},
        "structured_terms": {},
        "status": "approved",
    }).execute().data[0]["id"]
    payment_id = admin.table("payments").insert({
        "deal_id": deal_id,
        "source_summary_id": summary_id,
        "amount": "84000",
        "currency": "INR",
        "structure": "milestone" if structured else "single",
        "state": "paid_partial",
        "due_date_pending": False,
        "version": 3,
        "updated_by": ids["B"],
    }).execute().data[0]["id"]
    milestone_id = ""
    if structured:
        milestone_id = admin.table("payment_milestones").insert({
            "payment_id": payment_id,
            "sequence": 1,
            "trigger_description": "Fictional accepted deliverable",
            "amount": "84000",
            "due_date": "2026-09-30",
            "state": "paid_partial",
            "version": 2,
            "updated_by": ids["B"],
            "updated_at": "2026-09-02T00:00:00+00:00",
        }).execute().data[0]["id"]
    message_id = admin.table("messages").insert({
        "deal_id": deal_id,
        "sender_id": ids["C"],
        "body": "Fictional evidence user@internalbox https://private.example.test "
        "10.24.18.9 +1 (415) 555-2671 remains.",
    }).execute().data[0]["id"]
    return {
        "deal_id": deal_id,
        "payment_id": payment_id,
        "milestone_id": milestone_id,
        "message_id": message_id,
    }


def open_dispute(deal: dict[str, str], *, actor: str = "C"):
    return call(
        "POST",
        f"/deals/{deal['deal_id']}/disputes",
        actor,
        {
            "description": "Fictional issue from user@internalbox, 6123 4567, or "
            "98765&#8203;43210 "
            "requiring operations mediation.",
            "evidence": [{"kind": "message", "id": deal["message_id"]}],
        },
    )


def artifact_counts(deal_id: str) -> dict[str, int]:
    audits = admin.table("audit_log").select("id", count="exact").eq(
        "entity_type", "dispute"
    ).eq("metadata->>deal_id", deal_id).execute()
    return {
        "disputes": admin.table("disputes").select("id", count="exact").eq(
            "deal_id", deal_id
        ).execute().count or 0,
        "notifications": admin.table("notifications").select("id", count="exact").eq(
            "deal_id", deal_id
        ).execute().count or 0,
        "audits": audits.count or 0,
    }


def cleanup() -> None:
    management_sql(
        "DROP TRIGGER IF EXISTS test_ops_resolution_audit_failure ON public.audit_log; "
        "DROP FUNCTION IF EXISTS public.test_ops_resolution_audit_failure();"
    )
    if ids:
        quoted_users = ",".join(f"'{value}'" for value in ids.values())
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE actor_id IN ({quoted_users}); "
            "SET session_replication_role = origin; "
            f"DELETE FROM public.platform_ops_members WHERE profile_id IN ({quoted_users}) "
            f"OR provisioned_by IN ({quoted_users});"
        )
    for deal_id in deal_ids:
        admin.table("deals").delete().eq("id", deal_id).execute()
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)


def assert_safe_projection(payload: object) -> bool:
    encoded = json.dumps(payload).lower()
    forbidden_keys = {
        "email", "phone", "amount", "currency", "structure", "sender_id",
        "raised_by_id", "resolved_by", "request_fingerprint", "resolution_fingerprint",
        "resolution_request_id", "ip_address", "audit", "preview", "raw_url",
    }

    def keys_safe(value: object) -> bool:
        if isinstance(value, dict):
            return not (set(value) & forbidden_keys) and all(keys_safe(item) for item in value.values())
        if isinstance(value, list):
            return all(keys_safe(item) for item in value)
        return True

    return keys_safe(payload) and not any(secret in encoded for secret in (
        "user@internalbox", "private.example.test", "10.24.18.9", "https://",
        "+91 98765 43210", "+44 20 7946 0958", "+1 (415) 555-2671", "6123 4567",
        "98765 43210", "98765&#8203;43210",
    ))


def main() -> None:
    global brand_id
    cleanup()
    try:
        for key, (email, name, account_type) in USERS.items():
            created = admin.auth.admin.create_user({
                "email": email,
                "password": PASSWORD,
                "email_confirm": True,
                "user_metadata": {"platform_ops": True, "role": "platform_ops"} if key == "X" else {},
            })
            ids[key] = created.user.id
            admin.table("profiles").insert({
                "id": ids[key],
                "email": email,
                "display_name": name,
                "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Ops Studio {RUN_ID}",
            "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["O"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["X"], "brand_role": "member", "status": "active"},
        ]).execute()

        admin.table("platform_ops_members").insert({
            "profile_id": ids["I"], "is_active": False, "provisioned_by": ids["I"],
        }).execute()
        zero = make_deal("zero-recipient")
        zero_open = open_dispute(zero)
        zero_audit = admin.table("audit_log").select("metadata").eq(
            "entity_id", zero_open.json()["current_open"]["id"]
        ).single().execute().data["metadata"]
        check("raising succeeds with no active ops recipient and records that outcome", (
            zero_open.status_code == 200
            and artifact_counts(zero["deal_id"]) == {"disputes": 1, "notifications": 2, "audits": 1}
            and zero_audit["ops_recipient_count"] == 0
        ))

        admin.table("platform_ops_members").insert([
            {"profile_id": ids["O"], "is_active": True, "provisioned_by": ids["O"]},
            {"profile_id": ids["P"], "is_active": True, "provisioned_by": ids["O"]},
        ]).execute()

        main_deal = make_deal("main", structured=True)
        payment_before = admin.table("payments").select("*").eq(
            "id", main_deal["payment_id"]
        ).single().execute().data
        milestone_before = admin.table("payment_milestones").select("*").eq(
            "id", main_deal["milestone_id"]
        ).single().execute().data
        transition_count_before = admin.table("deal_stage_transitions").select(
            "id", count="exact"
        ).eq("deal_id", main_deal["deal_id"]).execute().count or 0
        opened = open_dispute(main_deal)
        dispute_id = opened.json()["current_open"]["id"]
        opened_counts = artifact_counts(main_deal["deal_id"])
        retry_open = open_dispute(main_deal)
        ops_notices = admin.table("notifications").select(
            "profile_id,tier,title,body,deal_id,dispute_id"
        ).eq("deal_id", main_deal["deal_id"]).in_("profile_id", [ids["O"], ids["P"]]).execute().data
        raise_audit = admin.table("audit_log").select("metadata").eq(
            "entity_id", dispute_id
        ).eq("action", "payment_dispute_raised").single().execute().data["metadata"]
        check("new raise adds one generic Critical notice per active ops member", (
            opened.status_code == 200
            and retry_open.status_code == 200
            and opened_counts == artifact_counts(main_deal["deal_id"])
            and opened_counts == {"disputes": 1, "notifications": 4, "audits": 1}
            and len(ops_notices) == 2
            and all(
                row["tier"] == "critical"
                and row["deal_id"] == main_deal["deal_id"]
                and row["dispute_id"] == dispute_id
                for row in ops_notices
            )
            and assert_safe_projection(ops_notices)
            and raise_audit["ops_recipient_count"] == 2
        ))

        missing_id = str(uuid4())
        unauthenticated = call("GET", "/ops/disputes", None)
        spoof_existing = call(
            "GET", f"/ops/disputes/{dispute_id}", "X", headers={"X-Platform-Ops": "true"}
        )
        spoof_missing = call("GET", f"/ops/disputes/{missing_id}", "X")
        inactive = call("GET", f"/ops/disputes/{dispute_id}", "I")
        participant = call("GET", f"/ops/disputes/{dispute_id}", "B")
        check("bearer auth plus active explicit membership is the only ops authority", (
            unauthenticated.status_code == 401
            and spoof_existing.status_code == spoof_missing.status_code == inactive.status_code == participant.status_code == 403
            and spoof_existing.json() == spoof_missing.json() == inactive.json() == participant.json()
        ))

        queue = call("GET", "/ops/disputes?status=open&limit=1", "O")
        cursor = queue.json().get("next_cursor")
        next_page = call("GET", f"/ops/disputes?status=open&limit=1&cursor={cursor}", "O")
        malformed_cursor = call("GET", "/ops/disputes?cursor=not-a-cursor", "O")
        excessive_limit = call("GET", "/ops/disputes?limit=51", "O")
        queue_ids = {queue.json()["disputes"][0]["id"], next_page.json()["disputes"][0]["id"]}
        check("open queue is bounded, deterministic and uses a validated opaque cursor", (
            queue.status_code == next_page.status_code == 200
            and cursor is not None
            and len(queue_ids) == 2
            and malformed_cursor.status_code == excessive_limit.status_code == 422
            and assert_safe_projection(queue.json())
            and assert_safe_projection(next_page.json())
        ))

        detail = call("GET", f"/ops/disputes/{dispute_id}", "O")
        active_missing = call("GET", f"/ops/disputes/{missing_id}", "O")
        check("ops detail exposes only sanitized mediation fields after authorization", (
            detail.status_code == 200
            and detail.json()["allowed_actions"] == {"can_resolve": True}
            and detail.json()["deal"]["id"] == main_deal["deal_id"]
            and active_missing.status_code == 404
            and assert_safe_projection(detail.json())
        ))

        resolution_id = str(uuid4())
        valid_resolution = {
            "outcome": "resume_payment",
            "resolution_note": "Participants confirmed at 2026-09-05 12:30 and "
            "2026-09-05T12:30:45.123456; payment may resume.",
            "request_id": resolution_id,
        }
        invalid_bodies = [
            {**valid_resolution, "outcome": "refund"},
            {**valid_resolution, "resolution_note": "short"},
            {**valid_resolution, "resolution_note": "A valid-looking note with <b>markup</b>."},
            {**valid_resolution, "resolution_note": "A valid-looking note at https://private.example.test."},
            {**valid_resolution, "resolution_note": "Call +91 98765 43210 before resuming payment."},
            {**valid_resolution, "resolution_note": "Call +65\u00a06123\u00a04567 before resuming payment."},
            {**valid_resolution, "resolution_note": "Call 98765&#8203;43210 before resuming payment."},
            {**valid_resolution, "resolution_note": "A valid-looking note with\u0000 control."},
            {**valid_resolution, "unexpected": True},
            {**valid_resolution, "request_id": "not-a-uuid"},
        ]
        invalid_statuses = [
            call("POST", f"/ops/disputes/{dispute_id}/resolve", "O", body).status_code
            for body in invalid_bodies
        ]
        timestamp_statuses = [
            call(
                "POST",
                f"/ops/disputes/{missing_id}/resolve",
                "O",
                {
                    **valid_resolution,
                    "resolution_note": f"Resolution safely recorded at {timestamp}.",
                    "request_id": str(uuid4()),
                },
            ).status_code
            for timestamp in (
                "2026-09-05 12:30",
                "2026/09/05 12:30:45",
                "05.09.2026 12:30",
                "2026 09 05 12:30",
                "2026-09-05T12:30:45.123456",
            )
        ]
        still_open = admin.table("disputes").select("status").eq(
            "id", dispute_id
        ).single().execute().data["status"]
        check("resolution contract rejects private contact values without rejecting timestamps", (
            set(invalid_statuses) == {422}
            and set(timestamp_statuses) == {404}
            and still_open == "open"
        ))

        nonops_resolution = call(
            "POST", f"/ops/disputes/{dispute_id}/resolve", "X", valid_resolution
        )
        direct_rpc_denied = False
        try:
            auth_client("C").rpc("resolve_payment_dispute", {
                "p_dispute_id": dispute_id,
                "p_actor_id": ids["O"],
                "p_outcome": "resume_payment",
                "p_resolution_note": valid_resolution["resolution_note"],
                "p_request_id": resolution_id,
                "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception:
            direct_rpc_denied = True
        check("non-ops HTTP and direct authenticated RPC resolution are denied without mutation", (
            nonops_resolution.status_code == 403 and direct_rpc_denied
            and admin.table("disputes").select("status").eq("id", dispute_id).single().execute().data["status"] == "open"
        ))

        resolved = call("POST", f"/ops/disputes/{dispute_id}/resolve", "O", valid_resolution)
        counts_after_resolution = artifact_counts(main_deal["deal_id"])
        exact_retry = call("POST", f"/ops/disputes/{dispute_id}/resolve", "O", valid_resolution)
        payment_after = admin.table("payments").select("*").eq(
            "id", main_deal["payment_id"]
        ).single().execute().data
        milestone_after = admin.table("payment_milestones").select("*").eq(
            "id", main_deal["milestone_id"]
        ).single().execute().data
        deal_after = admin.table("deals").select("stage,is_disputed").eq(
            "id", main_deal["deal_id"]
        ).single().execute().data
        transition_count_after = admin.table("deal_stage_transitions").select(
            "id", count="exact"
        ).eq("deal_id", main_deal["deal_id"]).execute().count or 0
        resolution_audit = admin.table("audit_log").select("metadata").eq(
            "entity_id", dispute_id
        ).eq("action", "payment_dispute_resolved").single().execute().data["metadata"]
        resolution_notices = admin.table("notifications").select(
            "profile_id,tier,title,body,deal_id,dispute_id"
        ).eq("deal_id", main_deal["deal_id"]).eq("tier", "important").execute().data
        check("atomic resolution restores only prior payment truth and clears the overlay", (
            resolved.status_code == exact_retry.status_code == 200
            and resolved.json()["idempotent"] is False
            and exact_retry.json()["idempotent"] is True
            and payment_after == payment_before
            and milestone_after == milestone_before
            and deal_after == {"stage": "payment", "is_disputed": False}
            and transition_count_after == transition_count_before
            and counts_after_resolution == artifact_counts(main_deal["deal_id"])
            and counts_after_resolution == {"disputes": 1, "notifications": 6, "audits": 2}
            and resolved.json()["dispute"]["allowed_actions"] == {"can_resolve": False}
            and {row["profile_id"] for row in resolution_notices} == {ids["C"], ids["B"]}
            and all(
                row["tier"] == "important"
                and row["dispute_id"] == dispute_id
                and row["deal_id"] == main_deal["deal_id"]
                for row in resolution_notices
            )
            and assert_safe_projection(resolution_notices)
            and assert_safe_projection(resolved.json())
            and "resolution_note" not in resolution_audit
            and "request_id" not in resolution_audit
            and "fingerprint" not in json.dumps(resolution_audit)
        ))

        participant_history = call("GET", f"/deals/{main_deal['deal_id']}/disputes", "C")
        resumed_tracking = call("GET", f"/deals/{main_deal['deal_id']}/payment-tracking", "B")
        check("participants see safe resolved history and normal Payment actions resume", (
            participant_history.status_code == resumed_tracking.status_code == 200
            and participant_history.json()["current_open"] is None
            and participant_history.json()["allowed_actions"]["can_resolve"] is False
            and participant_history.json()["history"][0]["resolution_note"] == valid_resolution["resolution_note"]
            and "allowed_actions" not in participant_history.json()["history"][0]
            and resumed_tracking.json()["state"] == "paid_partial"
            and resumed_tracking.json()["allowed_actions"]["can_update_milestones"] is True
            and assert_safe_projection(participant_history.json())
        ))

        changed_retry = call("POST", f"/ops/disputes/{dispute_id}/resolve", "O", {
            **valid_resolution,
            "resolution_note": "A materially different resolution note is rejected safely.",
        })
        second_actor = call("POST", f"/ops/disputes/{dispute_id}/resolve", "P", {
            **valid_resolution,
            "request_id": str(uuid4()),
        })
        check("changed retries and a second resolver conflict without duplicate effects", (
            changed_retry.status_code == second_actor.status_code == 409
            and artifact_counts(main_deal["deal_id"]) == counts_after_resolution
        ))

        concurrent = make_deal("concurrent")
        concurrent_id = open_dispute(concurrent).json()["current_open"]["id"]

        def resolve_raw(actor: str) -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            try:
                client.rpc("resolve_payment_dispute", {
                    "p_dispute_id": concurrent_id,
                    "p_actor_id": ids[actor],
                    "p_outcome": "resume_payment",
                    "p_resolution_note": f"Fictional concurrent resolution recorded by actor {actor}.",
                    "p_request_id": str(uuid4()),
                    "p_ip_address": "127.0.0.1",
                }).execute()
                return "resolved"
            except Exception as exc:
                return "conflict" if "PLATFORM_OPS_DISPUTE_RESOLUTION_CONFLICT" in str(exc) else "unexpected"

        with ThreadPoolExecutor(max_workers=2) as pool:
            concurrent_results = list(pool.map(resolve_raw, ["O", "P"]))
        concurrent_state = admin.table("payments").select("state").eq(
            "id", concurrent["payment_id"]
        ).single().execute().data["state"]
        check("concurrent resolvers converge on one winner, restore, audit and notice set", (
            sorted(concurrent_results) == ["conflict", "resolved"]
            and concurrent_state == "paid_partial"
            and artifact_counts(concurrent["deal_id"]) == {"disputes": 1, "notifications": 6, "audits": 2}
        ))

        reuse = make_deal("request-reuse")
        reuse_id = open_dispute(reuse).json()["current_open"]["id"]
        reused_request = call("POST", f"/ops/disputes/{reuse_id}/resolve", "O", valid_resolution)
        check("resolution request ids cannot be reused across disputes", (
            reused_request.status_code == 409
            and admin.table("deals").select("is_disputed").eq(
                "id", reuse["deal_id"]
            ).single().execute().data["is_disputed"] is True
            and artifact_counts(reuse["deal_id"]) == {"disputes": 1, "notifications": 4, "audits": 1}
        ))

        rollback = make_deal("rollback")
        rollback_id = open_dispute(rollback).json()["current_open"]["id"]
        management_sql(
            "CREATE OR REPLACE FUNCTION public.test_ops_resolution_audit_failure() RETURNS trigger "
            "LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='payment_dispute_resolved' THEN "
            "RAISE EXCEPTION 'FICTIONAL_AUDIT_FAILURE'; END IF; RETURN NEW; END; $$; "
            "CREATE TRIGGER test_ops_resolution_audit_failure BEFORE INSERT ON public.audit_log "
            "FOR EACH ROW EXECUTE FUNCTION public.test_ops_resolution_audit_failure();"
        )
        rollback_response = call("POST", f"/ops/disputes/{rollback_id}/resolve", "O", {
            **valid_resolution, "request_id": str(uuid4()),
        })
        management_sql(
            "DROP TRIGGER test_ops_resolution_audit_failure ON public.audit_log; "
            "DROP FUNCTION public.test_ops_resolution_audit_failure();"
        )
        rollback_row = admin.table("disputes").select("status,resolved_at,resolved_by").eq(
            "id", rollback_id
        ).single().execute().data
        check("audit failure rolls back dispute, payment, overlay and participant notices", (
            rollback_response.status_code == 409
            and rollback_row == {"status": "open", "resolved_at": None, "resolved_by": None}
            and admin.table("payments").select("state").eq(
                "id", rollback["payment_id"]
            ).single().execute().data["state"] == "disputed"
            and admin.table("deals").select("is_disputed").eq(
                "id", rollback["deal_id"]
            ).single().execute().data["is_disputed"] is True
            and artifact_counts(rollback["deal_id"]) == {"disputes": 1, "notifications": 4, "audits": 1}
        ))

        direct_member_denied = direct_enrol_denied = False
        direct_dispute_denied = direct_payment_denied = False
        direct = auth_client("C")
        try:
            direct.table("platform_ops_members").select("*").execute()
        except Exception:
            direct_member_denied = True
        try:
            direct.table("platform_ops_members").insert({
                "profile_id": ids["C"],
                "is_active": True,
                "provisioned_by": ids["C"],
            }).execute()
        except Exception:
            direct_enrol_denied = True
        try:
            direct.table("disputes").update({"status": "resolved"}).eq("id", rollback_id).execute()
        except Exception:
            direct_dispute_denied = True
        try:
            direct.table("payments").update({"state": "refunded"}).eq(
                "id", rollback["payment_id"]
            ).execute()
        except Exception:
            direct_payment_denied = True
        check("anon-key clients cannot inspect membership or mutate dispute/payment state", (
            direct_member_denied and direct_enrol_denied
            and direct_dispute_denied and direct_payment_denied
        ))

    finally:
        cleanup()

    failed = [label for label, passed in checks if not passed]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} ops dispute checks passed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
