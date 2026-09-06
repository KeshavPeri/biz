"""Development-Supabase integration coverage for workplan 9.15-C."""

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
from services.term_extraction import TermsExtraction  # noqa: E402


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Tracking-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"tracking.creator.{RUN_ID}@inflo.test", "Fictional Tracking Creator", "creator"),
    "B": (f"tracking.admin.{RUN_ID}@inflo.test", "Fictional Tracking Admin", "brand"),
    "M": (f"tracking.maker.{RUN_ID}@inflo.test", "Fictional Tracking Maker", "brand"),
    "K": (f"tracking.checker.{RUN_ID}@inflo.test", "Fictional Tracking Checker", "brand"),
    "I": (f"tracking.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Maker", "brand"),
    "O": (f"tracking.outsider.{RUN_ID}@inflo.test", "Fictional Tracking Outsider", "brand"),
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


def found(value: object) -> dict:
    return {
        "status": "found",
        "value": value,
        "evidence": [{"message_id": "fictional-tracking-message", "quote": "fictional agreed term"}],
    }


def not_discussed() -> dict:
    return {"status": "not_discussed", "value": None, "evidence": []}


def terms(kind: str, *, amount: int = 72000) -> dict:
    schedule = not_discussed()
    from_date = not_discussed()
    if kind in {"milestone", "combination"}:
        schedule = found([
            {"trigger": "Fictional draft accepted", "amount": {"amount": 30000, "currency": "INR"}, "due_date": "2026-09-10"},
            {"trigger": "Fictional post recorded", "amount": {"amount": amount - 30000, "currency": "INR"}, "due_date": "2026-09-20"},
        ])
    if kind == "net_x_days":
        from_date = found({"basis": "invoice_date", "net_days": 30})
    value = {
        "payment_amount": found({"amount": amount, "currency": "INR"}),
        "payment_terms_type": found(kind),
        "payment_terms_from_date": from_date,
        "exclusivity": found(False),
        "exclusivity_duration_days": not_discussed(),
        "exclusivity_category": not_discussed(),
        "usage_rights": found(False),
        "usage_rights_duration": not_discussed(),
        "usage_rights_channels": not_discussed(),
        "whitelisting": found(False),
        "blackout_window": found(False),
        "blackout_duration_timing": not_discussed(),
        "revision_rounds_max": found(1),
        "creative_guidance": found({"kind": "creator_discretion", "text": "Fictional tracking brief"}),
        "content_format_per_deliverable": found([{"deliverable_index": 1, "content_format": "Reel"}]),
        "platform_per_deliverable": found([{"deliverable_index": 1, "platform": "Instagram"}]),
        "posting_window_per_deliverable": found([{
            "deliverable_index": 1, "posting_date": "2026-09-01", "window_start": None, "window_end": None,
        }]),
        "sponsored_content_disclosure": found({"required": True, "platform_rules": ["Use #ad"]}),
        "content_ownership": found("creator"),
        "deliverable_count": found(1),
        "location_per_deliverable": found([{"deliverable_index": 1, "location": "Fictional studio"}]),
        "milestone_schedule": schedule,
    }
    TermsExtraction.model_validate(value)
    return value


def make_deal(
    label: str,
    kind: str,
    *,
    stage: str = "payment",
    initialize: bool = True,
    terms_override: dict | None = None,
) -> str:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"],
        "brand_id": brand_id,
        "deal_name": f"Fictional tracking {label} {RUN_ID}",
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
    summary_id = admin.table("ai_summaries").insert({
        "deal_id": deal_id,
        "raw_output": {"source": "fictional payment tracking fixture"},
        "structured_terms": terms_override or terms(kind),
        "status": "approved",
    }).execute().data[0]["id"]
    admin.table("contracts").insert({
        "deal_id": deal_id,
        "version": 1,
        "storage_path": f"fictional/{deal_id}/executed-v1.pdf",
        "generated_from_summary_id": summary_id,
        "status": "executed",
        "draft_source_sha256": "a" * 64,
    }).execute()
    if initialize:
        admin.rpc("initialize_payment_tracking", {
            "p_deal_id": deal_id,
            "p_actor_id": ids["B"],
            "p_ip_address": "127.0.0.1",
        }).execute()
    return deal_id


def cleanup() -> None:
    print("\nCleaning up fictional payment-tracking data...")
    if ids:
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
            "company_name": f"Fictional Tracking Studio {RUN_ID}", "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "invited"},
            {"brand_id": brand_id, "profile_id": ids["O"], "brand_role": "member", "status": "active"},
        ]).execute()

        prepayment = make_deal("prepayment", "on_posting", stage="posted", initialize=False)
        pre = call("GET", f"/deals/{prepayment}/payment-tracking", "C")
        check("participant gets stable not-yet-available projection before Payment", (
            pre.status_code == 200 and pre.json()["available"] is False and pre.json()["reason"] == "not_yet_available"
        ))
        check("outsider is denied before availability details leak", (
            call("GET", f"/deals/{prepayment}/payment-tracking", "O").status_code == 403
        ))

        partial_terms = terms("on_posting")
        partial_terms.pop("deliverable_count")
        malformed_recovery = make_deal(
            "malformed-recovery",
            "on_posting",
            initialize=False,
            terms_override=partial_terms,
        )
        malformed_blocked = False
        try:
            admin.rpc("initialize_payment_tracking", {
                "p_deal_id": malformed_recovery,
                "p_actor_id": ids["B"],
                "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception:
            malformed_blocked = True
        malformed_audits = admin.table("audit_log").select("id").eq(
            "entity_id", malformed_recovery
        ).eq("action", "payment_tracking_initialized").execute().data
        check("service-role recovery rejects an incomplete 22-field summary atomically", (
            malformed_blocked
            and admin.table("payments").select("id").eq("deal_id", malformed_recovery).execute().data == []
            and admin.table("payment_milestones").select("id").execute().data == []
            and malformed_audits == []
        ))

        oversized_evidence_terms = terms("on_posting")
        oversized_evidence_terms["payment_amount"]["evidence"][0]["quote"] = " " * 500 + "x"
        oversized_evidence_recovery = make_deal(
            "oversized-evidence-recovery",
            "on_posting",
            initialize=False,
            terms_override=oversized_evidence_terms,
        )
        oversized_evidence_blocked = False
        try:
            admin.rpc("initialize_payment_tracking", {
                "p_deal_id": oversized_evidence_recovery,
                "p_actor_id": ids["B"],
                "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception:
            oversized_evidence_blocked = True
        oversized_evidence_audits = admin.table("audit_log").select("id").eq(
            "entity_id", oversized_evidence_recovery
        ).eq("action", "payment_tracking_initialized").execute().data
        check("service-role recovery enforces untrimmed evidence quote bounds atomically", (
            oversized_evidence_blocked
            and admin.table("payments").select("id").eq(
                "deal_id", oversized_evidence_recovery
            ).execute().data == []
            and admin.table("payment_milestones").select("id").execute().data == []
            and oversized_evidence_audits == []
        ))

        single = make_deal("single", "on_posting")
        init_retry = admin.rpc("initialize_payment_tracking", {
            "p_deal_id": single,
            "p_actor_id": ids["B"],
            "p_ip_address": "127.0.0.1",
        }).execute().data
        single_read = call("GET", f"/deals/{single}/payment-tracking", "K")
        safe_text = json.dumps(single_read.json(), sort_keys=True)
        check("all participants read the same bounded canonical single projection", (
            single_read.status_code == 200
            and single_read.json()["available"]
            and single_read.json()["amount"] in {"72000", "72000.0"}
            and single_read.json()["structure"] == "single"
            and single_read.json()["version"] == 1
            and single_read.json()["due_date_pending"] is False
        ))
        check("exact initialization retry converges without a duplicate tracker or audit", (
            init_retry["idempotent"] is True
            and len(admin.table("payments").select("id").eq("deal_id", single).execute().data) == 1
            and len(admin.table("audit_log").select("id").eq("entity_id", single).eq(
                "action", "payment_tracking_initialized"
            ).execute().data) == 1
        ))
        check("safe projection omits provenance ids, actors, audit and approved JSON", all(
            token not in safe_text for token in (
                "source_summary_id", "updated_by", "confirmed_by", "audit_log", "structured_terms", "bank_or_upi",
            )
        ))

        malformed = {"expected_version": True, "state": "disputed", "extra": "x"}
        denied_responses = [
            (actor, call("PUT", f"/deals/{single}/payment-tracking/state", actor, malformed))
            for actor in ("K", "C", "I", "O")
        ]
        check("checker, creator, inactive maker and outsider are denied before malformed state details", all(
            response.status_code == 403 for _, response in denied_responses
        ))
        check("authorized actor receives strict boolean, extra and disputed-state rejection", (
            call("PUT", f"/deals/{single}/payment-tracking/state", "B", malformed).status_code == 422
        ))
        wrong_route = call(
            "PUT", f"/deals/{single}/payment-tracking/milestones/{uuid4()}/state", "B",
            {"expected_version": 1, "state": "paid_partial"},
        )
        check("single structures reject milestone updates", wrong_route.status_code == 409)

        partial = call("PUT", f"/deals/{single}/payment-tracking/state", "M", {
            "expected_version": 1, "state": "paid_partial",
        })
        retry = call("PUT", f"/deals/{single}/payment-tracking/state", "M", {
            "expected_version": 1, "state": "paid_partial",
        })
        stale = call("PUT", f"/deals/{single}/payment-tracking/state", "B", {
            "expected_version": 1, "state": "paid_full",
        })
        check("changed single report advances once and identical retry is idempotent", (
            partial.status_code == 200 and partial.json()["version"] == 2
            and retry.status_code == 200 and retry.json()["outcome"]["idempotent"]
        ))
        check("different stale report fails without a lost update", stale.status_code == 409)
        receipt = call("POST", f"/deals/{single}/payment-tracking/confirm-receipt", "C", {
            "expected_version": 2,
        })
        receipt_retry = call("POST", f"/deals/{single}/payment-tracking/confirm-receipt", "C", {
            "expected_version": 2,
        })
        check("named creator confirms exact paid-partial version idempotently", (
            receipt.status_code == 200 and receipt.json()["receipt_confirmed"]
            and receipt_retry.json()["outcome"]["idempotent"]
        ))
        full = call("PUT", f"/deals/{single}/payment-tracking/state", "B", {
            "expected_version": 2, "state": "paid_full",
        })
        check("later brand report makes prior receipt non-current", (
            full.status_code == 200 and full.json()["version"] == 3 and not full.json()["receipt_confirmed"]
        ))
        complete = call("POST", f"/deals/{single}/payment-tracking/confirm-receipt", "C", {
            "expected_version": 3,
        })
        check("paid-full plus matching creator confirmation derives receipt_complete", (
            complete.status_code == 200 and complete.json()["receipt_complete"]
            and complete.json()["future_actions"]["can_request_close"] is True
        ))

        structured = make_deal("milestones", "milestone")
        structured_read = call("GET", f"/deals/{structured}/payment-tracking", "C").json()
        milestones = structured_read["milestones"]
        check("approved milestones materialize in stable order and reconcile exactly", (
            [item["sequence"] for item in milestones] == [1, 2]
            and [item["amount"] for item in milestones] in (["30000", "42000"], ["30000.0", "42000.0"])
            and structured_read["due_date"] == "2026-09-20"
        ))
        check("structured aggregate route and receipt without milestone are rejected", (
            call("PUT", f"/deals/{structured}/payment-tracking/state", "B", {
                "expected_version": 1, "state": "paid_full",
            }).status_code == 409
            and call("POST", f"/deals/{structured}/payment-tracking/confirm-receipt", "C", {
                "expected_version": 1,
            }).status_code == 409
        ))

        first_paid = call("PUT", f"/deals/{structured}/payment-tracking/milestones/{milestones[0]['id']}/state", "B", {
            "expected_version": 1, "state": "paid_full",
        })
        delayed = call("PUT", f"/deals/{structured}/payment-tracking/milestones/{milestones[1]['id']}/state", "B", {
            "expected_version": 1, "state": "not_paid_delayed",
        })
        bad_debt = call("PUT", f"/deals/{structured}/payment-tracking/milestones/{milestones[1]['id']}/state", "B", {
            "expected_version": 2, "state": "bad_debt",
        })
        check("database aggregate precedence covers partial, delayed and bad-debt", (
            first_paid.json()["state"] == "paid_partial"
            and delayed.json()["state"] == "not_paid_delayed"
            and bad_debt.json()["state"] == "bad_debt"
        ))
        second_paid = call("PUT", f"/deals/{structured}/payment-tracking/milestones/{milestones[1]['id']}/state", "M", {
            "expected_version": 3, "state": "paid_full",
        })
        check("all paid-full milestones derive paid-full aggregate", second_paid.json()["state"] == "paid_full")
        first_receipt = call("POST", f"/deals/{structured}/payment-tracking/confirm-receipt", "C", {
            "milestone_id": milestones[0]["id"], "expected_version": 2,
        })
        second_receipt = call("POST", f"/deals/{structured}/payment-tracking/confirm-receipt", "C", {
            "milestone_id": milestones[1]["id"], "expected_version": 4,
        })
        check("structured receipt_complete requires every current paid-full version", (
            not first_receipt.json()["receipt_complete"] and second_receipt.json()["receipt_complete"]
        ))

        invoice = make_deal("invoice-date", "net_x_days")
        invoice_read = call("GET", f"/deals/{invoice}/payment-tracking", "C").json()
        check("invoice-date net terms keep an honest pending due date", (
            invoice_read["due_date"] is None and invoice_read["due_date_pending"] is True
        ))

        combination = make_deal("combination", "combination")
        combination_read = call("GET", f"/deals/{combination}/payment-tracking", "M").json()
        check("combination terms materialize the exact reconciled schedule", (
            combination_read["structure"] == "combination"
            and len(combination_read["milestones"]) == 2
            and combination_read["state"] == "not_paid_in_window"
        ))

        upfront = make_deal("upfront", "upfront", initialize=False)
        management_sql(
            "INSERT INTO public.deal_stage_transitions "
            "(deal_id,from_stage,to_stage,transition_type,triggered_by,created_at) VALUES "
            f"('{upfront}','approval','creating','auto','{ids['B']}','2026-08-15T12:00:00Z');"
        )
        admin.rpc("initialize_payment_tracking", {
            "p_deal_id": upfront, "p_actor_id": ids["B"], "p_ip_address": "127.0.0.1",
        }).execute()
        check("upfront due date uses deterministic Approval-to-Creating evidence", (
            call("GET", f"/deals/{upfront}/payment-tracking", "C").json()["due_date"] == "2026-08-15"
        ))

        immutable_blocked = False
        try:
            admin.table("payments").update({"amount": 1}).eq("deal_id", single).execute()
        except Exception:
            immutable_blocked = True
        check("canonical approved amount and provenance identity are immutable even to direct backend updates", (
            immutable_blocked
            and admin.table("payments").select("amount").eq("deal_id", single).execute().data[0]["amount"] == 72000
        ))

        race_deal = make_deal("race", "on_posting")
        def race_update(state: str) -> bool:
            try:
                client = create_client(SUPABASE_URL, SERVICE_KEY)
                client.rpc("update_payment_tracking_state", {
                    "p_deal_id": race_deal, "p_actor_id": ids["B"],
                    "p_expected_version": 1, "p_state": state, "p_ip_address": "127.0.0.1",
                }).execute()
                return True
            except Exception:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            race_results = list(pool.map(race_update, ("paid_partial", "paid_full")))
        race_rows = admin.table("audit_log").select("id").eq("entity_type", "payment").in_(
            "entity_id", [admin.table("payments").select("id").eq("deal_id", race_deal).execute().data[0]["id"]]
        ).eq("action", "payment_state_reported").execute().data
        check("concurrent changed reports produce one winner, one version and one audit", (
            sum(race_results) == 1 and len(race_rows) == 1
        ))

        disputed = make_deal("valid-dispute", "on_posting")
        opened_dispute = call("POST", f"/deals/{disputed}/disputes", "K", {
            "description": "Fictional payment tracking needs platform review.", "evidence": [],
        })
        disputed_read = call("GET", f"/deals/{disputed}/payment-tracking", "C")
        blocked_dispute = call("PUT", f"/deals/{disputed}/payment-tracking/state", "B", {
            "expected_version": 1, "state": "refunded",
        })
        check("disputed deal stays readable while every tracking mutation fails closed", (
            opened_dispute.status_code == 200
            and disputed_read.status_code == 200
            and disputed_read.json()["state"] == "disputed"
            and blocked_dispute.status_code == 409
        ))
        disputed_uninitialized = make_deal("disputed-uninitialized", "on_posting", initialize=False)
        admin.table("deals").update({"is_disputed": True}).eq("id", disputed_uninitialized).execute()
        disputed_initialization_blocked = False
        try:
            admin.rpc("initialize_payment_tracking", {
                "p_deal_id": disputed_uninitialized,
                "p_actor_id": ids["B"],
                "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception:
            disputed_initialization_blocked = True
        check("dispute also blocks backend initialization and Payment-entry recovery", (
            disputed_initialization_blocked
            and admin.table("payments").select("id").eq("deal_id", disputed_uninitialized).execute().data == []
        ))
        call("POST", f"/deals/{single}/close", "C", {"request_id": str(uuid4())})
        call("POST", f"/deals/{single}/close", "B", {"request_id": str(uuid4())})
        closed = call("GET", f"/deals/{single}/payment-tracking", "B")
        closed_write = call("PUT", f"/deals/{single}/payment-tracking/state", "B", {
            "expected_version": 3, "state": "refunded",
        })
        check("Closed payment tracking stays readable and all actions become read-only", (
            closed.status_code == 200
            and not closed.json()["allowed_actions"]["can_update_state"]
            and closed_write.status_code == 409
        ))

        direct = auth_client("C")
        denied_select = denied_write = denied_rpc = False
        try:
            direct.table("payments").select("*").eq("deal_id", single).execute()
        except Exception:
            denied_select = True
        try:
            direct.table("payments").update({"state": "refunded"}).eq("deal_id", single).execute()
        except Exception:
            denied_write = True
        try:
            direct.rpc("update_payment_tracking_state", {
                "p_deal_id": single, "p_actor_id": ids["C"], "p_expected_version": 3,
                "p_state": "refunded", "p_ip_address": "127.0.0.1",
            }).execute()
        except Exception:
            denied_rpc = True
        check("authenticated users cannot select, mutate or execute payment mutation RPCs directly", (
            denied_select and denied_write and denied_rpc
        ))

        audit_rows = admin.table("audit_log").select("action,entity_type,entity_id,metadata").in_(
            "action", [
                "payment_tracking_initialized", "payment_state_reported",
                "payment_milestone_state_reported", "payment_receipt_confirmed",
                "payment_milestone_receipt_confirmed",
            ]
        ).in_("actor_id", list(ids.values())).execute().data
        audit_text = json.dumps(audit_rows, sort_keys=True)
        check("payment audits are metadata-only and omit financial/private request values", all(
            token not in audit_text for token in (
                "72000", "30000", "42000", "INR", "Fictional draft", "bank", "tax", "billing", "structured_terms",
            )
        ))

    finally:
        cleanup()

    failed = [label for label, passed in checks if not passed]
    print(f"\nTEST-PAYMENT-TRACKING: {len(checks) - len(failed)}/{len(checks)} checks passed")
    if failed:
        for label in failed:
            print(f"  - {label}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
