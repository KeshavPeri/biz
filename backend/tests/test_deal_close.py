"""Development-Supabase integration coverage for workplan 9.17-A."""

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
from tests.test_payment_tracking import terms  # noqa: E402


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Close-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"close.creator.{RUN_ID}@inflo.test", "Fictional Close Creator", "creator"),
    "B": (f"close.admin.{RUN_ID}@inflo.test", "Fictional Close Admin", "brand"),
    "M": (f"close.maker.{RUN_ID}@inflo.test", "Fictional Close Maker", "brand"),
    "K": (f"close.checker.{RUN_ID}@inflo.test", "Fictional Close Checker", "brand"),
    "I": (f"close.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Maker", "brand"),
    "O": (f"close.outsider.{RUN_ID}@inflo.test", "Fictional Close Outsider", "brand"),
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


def call(method: str, path: str, actor: str, payload: object | None = None):
    return api.request(
        method,
        path,
        headers={"Authorization": f"Bearer {tokens[actor]}"},
        json=payload,
    )


def make_deal(label: str, kind: str = "on_posting", stage: str = "payment") -> str:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"],
        "brand_id": brand_id,
        "deal_name": f"Fictional close {label} {RUN_ID}",
        "direction": "inbound",
        "created_by": ids["B"],
        "stage": stage,
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
        {"deal_id": deal_id, "profile_id": ids["I"], "participant_role": "brand_maker"},
    ]).execute()
    if stage == "payment":
        summary_id = admin.table("ai_summaries").insert({
            "deal_id": deal_id,
            "raw_output": {"source": "fictional close fixture"},
            "structured_terms": terms(kind),
            "status": "approved",
        }).execute().data[0]["id"]
        admin.table("contracts").insert({
            "deal_id": deal_id,
            "version": 1,
            "storage_path": f"fictional/{deal_id}/executed-v1.pdf",
            "generated_from_summary_id": summary_id,
            "status": "executed",
            "draft_source_sha256": "b" * 64,
        }).execute()
        admin.rpc("initialize_payment_tracking", {
            "p_deal_id": deal_id,
            "p_actor_id": ids["B"],
            "p_ip_address": "127.0.0.1",
        }).execute()
    return deal_id


def complete_payment(deal_id: str) -> dict:
    state = call("GET", f"/deals/{deal_id}/payment-tracking", "B").json()
    if state["structure"] == "single":
        reported = call("PUT", f"/deals/{deal_id}/payment-tracking/state", "B", {
            "expected_version": state["version"], "state": "paid_full",
        }).json()
        return call("POST", f"/deals/{deal_id}/payment-tracking/confirm-receipt", "C", {
            "expected_version": reported["version"],
        }).json()
    current = state
    for milestone in state["milestones"]:
        current = call(
            "PUT",
            f"/deals/{deal_id}/payment-tracking/milestones/{milestone['id']}/state",
            "B",
            {"expected_version": milestone["version"], "state": "paid_full"},
        ).json()
        refreshed = next(item for item in current["milestones"] if item["id"] == milestone["id"])
        current = call("POST", f"/deals/{deal_id}/payment-tracking/confirm-receipt", "C", {
            "milestone_id": milestone["id"], "expected_version": refreshed["version"],
        }).json()
    return current


def close_counts(deal_id: str) -> tuple[int, int, int, int]:
    confirmations = admin.table("deal_close_confirmations").select("id").eq("deal_id", deal_id).execute().data
    transitions = admin.table("deal_stage_transitions").select("id").eq("deal_id", deal_id).eq(
        "from_stage", "payment"
    ).eq("to_stage", "closed").execute().data
    audits = admin.table("audit_log").select("id").eq("entity_id", deal_id).eq("action", "deal_closed").execute().data
    notifications = admin.table("notifications").select("id").eq("deal_id", deal_id).eq("title", "Deal closed").execute().data
    return len(confirmations), len(transitions), len(audits), len(notifications)


def cleanup() -> None:
    print("\nCleaning up fictional close-gate data...")
    if ids:
        admin.table("platform_ops_members").delete().in_("profile_id", list(ids.values())).execute()
        quoted = ",".join(f"'{value}'" for value in ids.values())
        management_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM public.audit_log WHERE actor_id IN ({quoted}); "
            "SET session_replication_role = origin;"
        )
    for deal_id in deal_ids:
        admin.table("deals").delete().eq("id", deal_id).execute()
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def main() -> None:
    global brand_id
    cleanup()
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user({
                "email": email, "password": PASSWORD, "email_confirm": True,
            }).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": name, "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Close Studio {RUN_ID}", "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "invited"},
            {"brand_id": brand_id, "profile_id": ids["O"], "brand_role": "member", "status": "active"},
        ]).execute()

        before_payment = make_deal("before-payment", stage="posted")
        unavailable = call("GET", f"/deals/{before_payment}/close-status", "C")
        check("participants receive the bounded not-yet-available status before Payment", (
            unavailable.status_code == 200
            and unavailable.json()["available"] is False
            and unavailable.json()["reason"] == "not_yet_available"
            and unavailable.json()["dispute_blocked"] is False
            and unavailable.json()["allowed_actions"] == {"can_confirm": False}
        ))
        check("outsiders receive no availability hint", (
            call("GET", f"/deals/{before_payment}/close-status", "O").status_code == 404
            and call("POST", f"/deals/{before_payment}/close", "O", {"extra": True}).status_code == 404
        ))

        incomplete = make_deal("incomplete")
        incomplete_status = call("GET", f"/deals/{incomplete}/close-status", "C").json()
        incomplete_request = str(uuid4())
        check("incomplete current payment blocks confirmation without artifacts", (
            incomplete_status["payment_complete"] is False
            and incomplete_status["dispute_blocked"] is False
            and incomplete_status["allowed_actions"]["can_confirm"] is False
            and call("POST", f"/deals/{incomplete}/close", "C", {"request_id": incomplete_request}).status_code == 409
            and close_counts(incomplete)[0] == 0
        ))

        single = make_deal("single")
        complete_payment(single)
        ready = call("GET", f"/deals/{single}/close-status", "C")
        inactive_status = call("GET", f"/deals/{single}/close-status", "I")
        safe_text = json.dumps(ready.json(), sort_keys=True)
        check("exact current paid-full receipt enables eligible sides only", (
            ready.status_code == 200 and ready.json()["payment_complete"]
            and ready.json()["dispute_blocked"] is False
            and ready.json()["allowed_actions"]["can_confirm"]
            and call("GET", f"/deals/{single}/close-status", "K").json()["allowed_actions"]["can_confirm"] is False
            and inactive_status.status_code == 404
        ))
        check("status omits actor ids, request ids, payment values and dispute details", all(
            key not in safe_text for key in ("actor_id", "request_id", "payment_id", "amount", "description", "audit")
        ))
        denied_before_body = [
            call("POST", f"/deals/{single}/close", actor, {"request_id": "bad", "extra": True}).status_code
            for actor in ("K", "I", "O")
        ]
        strict = call("POST", f"/deals/{single}/close", "C", {"request_id": str(uuid4()), "extra": True})
        check("checker is denied and stale/outsider callers receive no deal hint", denied_before_body == [403, 404, 404])
        check("authorized close body accepts exactly one UUID", strict.status_code == 422)

        admin.table("platform_ops_members").insert({
            "profile_id": ids["M"], "provisioned_by": ids["B"], "is_active": True,
        }).execute()
        ops_denied = call("POST", f"/deals/{single}/close", "M", {"request_id": str(uuid4())})
        admin.table("platform_ops_members").delete().eq("profile_id", ids["M"]).execute()
        check("an active platform-ops capability cannot represent the brand side", (
            ops_denied.status_code == 403 and close_counts(single)[0] == 0
        ))

        creator_request = str(uuid4())
        first = call("POST", f"/deals/{single}/close", "C", {"request_id": creator_request})
        first_retry = call("POST", f"/deals/{single}/close", "C", {"request_id": creator_request})
        changed_retry = call("POST", f"/deals/{single}/close", "C", {"request_id": str(uuid4())})
        pending = call("GET", f"/deals/{single}/close-status", "M").json()
        check("first side is durable, exact retry is idempotent and changed identity conflicts", (
            first.status_code == 200 and not first.json()["transitioned"]
            and first_retry.status_code == 200 and first_retry.json()["idempotent"]
            and changed_retry.status_code == 409
            and admin.table("deals").select("stage").eq("id", single).single().execute().data["stage"] == "payment"
            and close_counts(single)[0] == 1
        ))
        direct_stage_denied = False
        try:
            admin.table("deals").update({"stage": "closed"}).eq("id", single).execute()
        except Exception as exc:
            direct_stage_denied = "DEAL_CLOSE_CONFIRMATIONS_INCOMPLETE" in str(exc)
        check("database gate rejects a direct Payment-to-Closed bypass", (
            direct_stage_denied
            and admin.table("deals").select("stage").eq("id", single).single().execute().data["stage"] == "payment"
        ))
        check("other side sees safe confirmation label and its own allowed action", (
            pending["confirmations"]["creator"]["confirmed"]
            and pending["confirmations"]["creator"]["display_label"] == USERS["C"][1]
            and pending["allowed_actions"]["can_confirm"]
        ))

        payment_before = admin.table("payments").select("*").eq("deal_id", single).single().execute().data
        evidence_before = admin.table("messages").insert({
            "deal_id": single, "sender_id": ids["C"], "body": "Fictional preserved close evidence",
        }).execute().data[0]
        attachment_before = admin.table("message_attachments").insert({
            "message_id": evidence_before["id"],
            "storage_path": f"fictional/{single}/evidence.txt",
            "file_name": "evidence.txt",
            "file_type": "text/plain",
            "file_size": 64,
        }).execute().data[0]
        brand_request = str(uuid4())
        second = call("POST", f"/deals/{single}/close", "M", {"request_id": brand_request})
        final_status = call("GET", f"/deals/{single}/close-status", "K").json()
        payment_after = admin.table("payments").select("*").eq("deal_id", single).single().execute().data
        check("second side atomically closes with exactly one transition, audit and notification set", (
            second.status_code == 200 and second.json()["transitioned"]
            and final_status["stage"] == "closed"
            and final_status["confirmations"]["creator"]["confirmed"]
            and final_status["confirmations"]["brand"]["confirmed"]
            and close_counts(single) == (2, 1, 1, 4)
        ))
        check("close preserves the canonical payment record exactly", payment_before == payment_after)
        closed_retry = call("POST", f"/deals/{single}/close", "M", {"request_id": brand_request})
        check("exact retry after Closed returns final status without duplicate effects", (
            closed_retry.status_code == 200 and closed_retry.json()["idempotent"]
            and close_counts(single) == (2, 1, 1, 4)
        ))

        reused = make_deal("reused-request")
        complete_payment(reused)
        reused_response = call("POST", f"/deals/{reused}/close", "C", {"request_id": creator_request})
        spoof_failed = False
        try:
            admin.rpc("confirm_deal_close", {
                "p_deal_id": reused,
                "p_actor_id": ids["O"],
                "p_request_id": str(uuid4()),
                "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception as exc:
            spoof_failed = "DEAL_CLOSE_NOT_PARTICIPANT" in str(exc)
        check("reused request ids and spoofed service actors fail without close artifacts", (
            reused_response.status_code == 409 and spoof_failed and close_counts(reused)[0] == 0
        ))

        rollback = make_deal("rollback")
        complete_payment(rollback)
        call("POST", f"/deals/{rollback}/close", "B", {"request_id": str(uuid4())})
        rollback_failed = False
        try:
            admin.rpc("confirm_deal_close", {
                "p_deal_id": rollback,
                "p_actor_id": ids["C"],
                "p_request_id": str(uuid4()),
                "p_ip_address": None,
            }).execute()
        except Exception:
            rollback_failed = True
        check("audit failure rolls back final confirmation, stage, transition and notifications", (
            rollback_failed
            and admin.table("deals").select("stage").eq("id", rollback).single().execute().data["stage"] == "payment"
            and close_counts(rollback) == (1, 0, 0, 0)
        ))

        direct_client = auth_client("C")
        direct_table_denied = direct_rpc_denied = False
        try:
            direct_client.table("deal_close_confirmations").insert({
                "deal_id": single, "side": "creator", "actor_id": ids["C"], "request_id": str(uuid4()),
            }).execute()
        except Exception:
            direct_table_denied = True
        try:
            direct_client.rpc("confirm_deal_close", {
                "p_deal_id": single, "p_actor_id": ids["C"], "p_request_id": str(uuid4()), "p_ip_address": "x",
            }).execute()
        except Exception:
            direct_rpc_denied = True
        check("authenticated clients cannot write confirmation rows or call the service RPC", direct_table_denied and direct_rpc_denied)

        message_denied = attachment_denied = message_update_denied = attachment_update_denied = False
        message_delete_denied = attachment_delete_denied = False
        try:
            direct_client.table("messages").insert({
                "deal_id": single, "sender_id": ids["C"], "body": "Must be rejected",
            }).execute()
        except Exception as exc:
            message_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        try:
            admin.table("message_attachments").insert({
                "message_id": evidence_before["id"], "storage_path": "x", "file_name": "x", "file_type": "x", "file_size": 1,
            }).execute()
        except Exception as exc:
            attachment_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        try:
            admin.table("messages").update({"body": "Mutated"}).eq("id", evidence_before["id"]).execute()
        except Exception as exc:
            message_update_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        try:
            admin.table("message_attachments").update({"file_name": "mutated"}).eq("id", attachment_before["id"]).execute()
        except Exception as exc:
            attachment_update_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        try:
            admin.table("messages").delete().eq("id", evidence_before["id"]).execute()
        except Exception as exc:
            message_delete_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        try:
            admin.table("message_attachments").delete().eq("id", attachment_before["id"]).execute()
        except Exception as exc:
            attachment_delete_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        historical = direct_client.table("messages").select("id").eq("deal_id", single).execute().data
        check("Closed message and attachment mutations fail at the database boundary while reads survive", (
            message_denied and attachment_denied and message_update_denied and attachment_update_denied
            and message_delete_denied and attachment_delete_denied
            and any(row["id"] == evidence_before["id"] for row in historical)
        ))

        terminal_insert_denials = []
        for terminal_stage in ("declined", "cancelled"):
            terminal_deal = make_deal(f"terminal-{terminal_stage}", stage=terminal_stage)
            terminal_client = auth_client("C")
            try:
                terminal_client.table("messages").insert({
                    "deal_id": terminal_deal,
                    "sender_id": ids["C"],
                    "body": f"Must fail for {terminal_stage}",
                }).execute()
                terminal_insert_denials.append(False)
            except Exception as exc:
                terminal_insert_denials.append("DEAL_THREAD_READ_ONLY" in str(exc))
        check("Declined and Cancelled threads also reject message creation", all(terminal_insert_denials))

        structured = make_deal("structured", "combination")
        complete_payment(structured)
        s_creator = call("POST", f"/deals/{structured}/close", "C", {"request_id": str(uuid4())})
        s_brand = call("POST", f"/deals/{structured}/close", "B", {"request_id": str(uuid4())})
        check("structured close requires and accepts every exact paid-full milestone receipt", (
            s_creator.status_code == 200 and s_brand.status_code == 200
            and admin.table("deals").select("stage").eq("id", structured).single().execute().data["stage"] == "closed"
            and close_counts(structured) == (2, 1, 1, 4)
        ))

        disputed = make_deal("disputed")
        complete_payment(disputed)
        opened = call("POST", f"/deals/{disputed}/disputes", "K", {
            "description": "Fictional payment evidence needs platform review.", "evidence": [],
        })
        disputed_status = call("GET", f"/deals/{disputed}/close-status", "C")
        disputed_close = call("POST", f"/deals/{disputed}/close", "C", {"request_id": str(uuid4())})
        check("a complete disputed payment stays complete but explicitly blocks close", (
            opened.status_code == 200
            and disputed_status.status_code == 200
            and disputed_status.json()["payment_complete"] is True
            and disputed_status.json()["dispute_blocked"] is True
            and disputed_status.json()["allowed_actions"]["can_confirm"] is False
            and disputed_close.status_code == 409
            and close_counts(disputed)[0] == 0
        ))

        incomplete_disputed = make_deal("incomplete-disputed")
        incomplete_opened = call("POST", f"/deals/{incomplete_disputed}/disputes", "K", {
            "description": "Fictional incomplete payment needs platform review.", "evidence": [],
        })
        incomplete_disputed_status = call("GET", f"/deals/{incomplete_disputed}/close-status", "C")
        incomplete_disputed_close = call(
            "POST", f"/deals/{incomplete_disputed}/close", "C", {"request_id": str(uuid4())},
        )
        check("an incomplete disputed payment stays incomplete and blocks close", (
            incomplete_opened.status_code == 200
            and incomplete_disputed_status.status_code == 200
            and incomplete_disputed_status.json()["payment_complete"] is False
            and incomplete_disputed_status.json()["dispute_blocked"] is True
            and incomplete_disputed_status.json()["allowed_actions"]["can_confirm"] is False
            and incomplete_disputed_close.status_code == 409
            and close_counts(incomplete_disputed)[0] == 0
        ))

        structured_disputed = make_deal("structured-disputed", "combination")
        complete_payment(structured_disputed)
        structured_opened = call("POST", f"/deals/{structured_disputed}/disputes", "K", {
            "description": "Fictional structured payment needs platform review.", "evidence": [],
        })
        structured_complete_status = call(
            "GET", f"/deals/{structured_disputed}/close-status", "C",
        )
        structured_payment = admin.table("payments").select("id").eq(
            "deal_id", structured_disputed,
        ).single().execute().data
        stale_milestone = admin.table("payment_milestones").select("id,version").eq(
            "payment_id", structured_payment["id"],
        ).order("sequence").limit(1).single().execute().data
        admin.table("payment_milestones").update({
            "creator_receipt_version": stale_milestone["version"] - 1,
        }).eq("id", stale_milestone["id"]).execute()
        structured_disputed_status = call("GET", f"/deals/{structured_disputed}/close-status", "C")
        check("structured dispute completeness requires every exact milestone receipt version", (
            structured_opened.status_code == 200
            and structured_complete_status.status_code == 200
            and structured_complete_status.json()["payment_complete"] is True
            and structured_complete_status.json()["dispute_blocked"] is True
            and structured_complete_status.json()["allowed_actions"]["can_confirm"] is False
            and structured_disputed_status.status_code == 200
            and structured_disputed_status.json()["payment_complete"] is False
            and structured_disputed_status.json()["dispute_blocked"] is True
            and structured_disputed_status.json()["allowed_actions"]["can_confirm"] is False
        ))

        inconsistent_overlay = make_deal("inconsistent-overlay")
        admin.table("deals").update({"is_disputed": True}).eq("id", inconsistent_overlay).execute()
        inconsistent_status = call("GET", f"/deals/{inconsistent_overlay}/close-status", "C")
        check("a partial dispute overlay fails closed instead of projecting readiness", (
            inconsistent_status.status_code == 409 and close_counts(inconsistent_overlay)[0] == 0
        ))

        concurrent = make_deal("concurrent")
        complete_payment(concurrent)
        def concurrent_close(actor: str, request_id: str) -> dict:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("confirm_deal_close", {
                "p_deal_id": concurrent,
                "p_actor_id": ids[actor],
                "p_request_id": request_id,
                "p_ip_address": "127.0.0.1",
            }).execute().data
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(
                lambda item: concurrent_close(item[0], item[1]),
                [("C", str(uuid4())), ("B", str(uuid4()))],
            ))
        check("concurrent creator and brand confirmations converge once", (
            all(isinstance(response, dict) for response in responses)
            and close_counts(concurrent) == (2, 1, 1, 4)
            and admin.table("deals").select("stage").eq("id", concurrent).single().execute().data["stage"] == "closed"
        ))

        race = make_deal("send-race")
        complete_payment(race)
        call("POST", f"/deals/{race}/close", "B", {"request_id": str(uuid4())})
        race_client = auth_client("M")
        def close_race() -> dict:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("confirm_deal_close", {
                "p_deal_id": race,
                "p_actor_id": ids["C"],
                "p_request_id": str(uuid4()),
                "p_ip_address": "127.0.0.1",
            }).execute().data
        with ThreadPoolExecutor(max_workers=2) as pool:
            close_future = pool.submit(close_race)
            send_future = pool.submit(
                lambda: race_client.table("messages").insert({
                    "deal_id": race, "sender_id": ids["M"], "body": "Fictional racing message",
                }).execute()
            )
            race_close = close_future.result()
            try:
                send_future.result()
            except Exception:
                pass
        after_race_denied = False
        try:
            race_client.table("messages").insert({
                "deal_id": race, "sender_id": ids["M"], "body": "Must fail after close",
            }).execute()
        except Exception as exc:
            after_race_denied = "DEAL_THREAD_READ_ONLY" in str(exc)
        check("message-send versus final-close serializes and post-close sends fail", (
            race_close["transitioned"] is True
            and admin.table("deals").select("stage").eq("id", race).single().execute().data["stage"] == "closed"
            and after_race_denied
        ))

    finally:
        cleanup()

    passed = sum(1 for _, ok in checks if ok)
    total = len(checks)
    print(f"\nRESULT: {passed}/{total} checks passed")
    if passed != total:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
