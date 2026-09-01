"""Development-Supabase acceptance checks for workplan 9.15-A.

All values are deliberately fictional. The suite uses real JWT/API/RPC/RLS
boundaries, serializes shared setup, and removes every created row in ``finally``.
Migration 037 must be applied first.
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
from services.payment_details_service import update_brand_details, update_creator_details  # noqa: E402
from services.stage_engine import DealError  # noqa: E402


SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"PaymentDetails-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"details.creator.{RUN_ID}@inflo.test", "Fictional Detail Creator", "creator"),
    "B": (f"details.admin.{RUN_ID}@inflo.test", "Fictional Detail Admin", "brand"),
    "M": (f"details.maker.{RUN_ID}@inflo.test", "Fictional Detail Maker", "brand"),
    "K": (f"details.checker.{RUN_ID}@inflo.test", "Fictional Detail Checker", "brand"),
    "I": (f"details.inactive.{RUN_ID}@inflo.test", "Fictional Inactive Maker", "brand"),
    "O": (f"details.outsider.{RUN_ID}@inflo.test", "Fictional Detail Outsider", "brand"),
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
        raise RuntimeError(f"Management SQL failed ({response.status_code}): {response.text}")
    return response.json()


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def call(method: str, path: str, actor: str, body: dict | None = None):
    return api.request(
        method,
        path,
        headers={"Authorization": f"Bearer {tokens[actor]}"},
        json=body,
    )


def creator_body(version: int, suffix: str = "one", tax_id: str | None = "FICTIONAL-TAX-01") -> dict:
    return {
        "expected_version": version,
        "creator_legal_name": f"  Fictional Creator Studio {suffix}  ",
        "creator_bank_or_upi": f"  Fictional off-platform payment instruction {suffix}  ",
        "creator_tax_id": tax_id,
    }


def brand_body(version: int, suffix: str = "one", gst: str | None = "FICTIONAL-GST-01") -> dict:
    return {
        "expected_version": version,
        "brand_billing_name": f"  Fictional Brand Billing {suffix}  ",
        "brand_billing_address": f"  Fictional billing address {suffix}, Test District  " ,
        "brand_gst": gst,
    }


def make_deal(stage: str, label: str) -> str:
    deal_id = admin.table("deals").insert(
        {
            "creator_id": ids["C"],
            "brand_id": brand_id,
            "deal_name": f"Fictional payment details {label} {RUN_ID}",
            "direction": "inbound",
            "created_by": ids["B"],
            "stage": stage,
        }
    ).execute().data[0]["id"]
    admin.table("deal_participants").insert(
        [
            {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
            {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
            {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
            {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
            {"deal_id": deal_id, "profile_id": ids["I"], "participant_role": "brand_maker"},
        ]
    ).execute()
    deal_ids.append(deal_id)
    return deal_id


def detail_row(deal_id: str) -> dict | None:
    rows = admin.table("deal_payment_details").select("*").eq("deal_id", deal_id).execute().data
    return rows[0] if rows else None


def audit_count(deal_id: str) -> int:
    return len(
        admin.table("audit_log")
        .select("id")
        .eq("action", "payment_details_updated")
        .contains("metadata", {"deal_id": deal_id})
        .execute()
        .data
    )


def direct_denied(action) -> bool:
    try:
        action()
    except Exception:
        return True
    return False


def cleanup() -> None:
    print("\nCleaning up fictional payment-detail data...")
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
            ids[key] = admin.auth.admin.create_user(
                {"email": email, "password": PASSWORD, "email_confirm": True}
            ).user.id
            admin.table("profiles").insert(
                {"id": ids[key], "email": email, "display_name": name, "account_type": account_type}
            ).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table("brands").insert(
            {"company_name": f"Fictional Detail Studio {RUN_ID}", "industry": "Media"}
        ).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [
                {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
                {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
                {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
                {"brand_id": brand_id, "profile_id": ids["I"], "brand_role": "member", "status": "invited"},
                {"brand_id": brand_id, "profile_id": ids["O"], "brand_role": "member", "status": "active"},
            ]
        ).execute()

        preposted = make_deal("creating", "not available")
        posted = make_deal("posted", "ownership")

        check("participant read before Posted is a stable not-yet-available conflict", call(
            "GET", f"/deals/{preposted}/payment-details", "C"
        ).status_code == 409)
        check("outsider read is denied before stage details", call(
            "GET", f"/deals/{preposted}/payment-details", "O"
        ).status_code == 403)

        empty_reads = [call("GET", f"/deals/{posted}/payment-details", actor) for actor in ("C", "B", "M", "K", "I")]
        check("all current participants share the same empty Posted projection", all(
            response.status_code == 200
            and response.json()["creator_version"] == 0
            and response.json()["brand_version"] == 0
            for response in empty_reads
        ))
        check("inactive brand participant is read-only", empty_reads[-1].json()["allowed_actions"]["can_edit_brand"] is False)

        invalid_creator = {"unexpected": "value"}
        check("outsider and wrong-side checks precede creator field validation", all(
            call("PUT", f"/deals/{posted}/payment-details/creator", actor, invalid_creator).status_code == 403
            for actor in ("B", "O")
        ))
        check("checker, creator and inactive member cannot write brand fields", all(
            call("PUT", f"/deals/{posted}/payment-details/brand", actor, {"unexpected": "value"}).status_code == 403
            for actor in ("K", "C", "I", "O")
        ))
        check("stage freeze precedes field validation for an authorized side", call(
            "PUT", f"/deals/{preposted}/payment-details/creator", "C", invalid_creator
        ).status_code == 409)

        check("missing or extra creator fields fail closed", call(
            "PUT", f"/deals/{posted}/payment-details/creator", "C",
            {**creator_body(0), "extra": "blocked"},
        ).status_code == 422)
        check("blank required brand value is rejected", call(
            "PUT", f"/deals/{posted}/payment-details/brand", "B",
            {**brand_body(0), "brand_billing_name": "   "},
        ).status_code == 422)
        check("control characters and oversize values are rejected cleanly", all(
            response.status_code == 422 for response in (
                call("PUT", f"/deals/{posted}/payment-details/creator", "C", {
                    **creator_body(0), "creator_bank_or_upi": "fictional\nsecret",
                }),
                call("PUT", f"/deals/{posted}/payment-details/brand", "B", {
                    **brand_body(0), "brand_billing_address": "x" * 1001,
                }),
            )
        ))

        creator_saved = call(
            "PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(0, tax_id="   ")
        )
        creator_state = creator_saved.json()
        check("creator saves only its normalized side at version one", (
            creator_saved.status_code == 200
            and creator_state["creator_version"] == 1
            and creator_state["brand_version"] == 0
            and creator_state["creator_tax_id"] is None
            and creator_state["creator_legal_name"] == "Fictional Creator Studio one"
        ))
        audit_after_creator = audit_count(posted)
        creator_retry = call(
            "PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(0, tax_id="")
        )
        check("exact creator retry is idempotent without audit or version noise", (
            creator_retry.status_code == 200
            and creator_retry.json()["outcome"]["idempotent"]
            and creator_retry.json()["creator_version"] == 1
            and audit_count(posted) == audit_after_creator
        ))

        brand_saved = call(
            "PUT", f"/deals/{posted}/payment-details/brand", "M", brand_body(0, gst="")
        )
        check("active brand maker completes only the brand side", (
            brand_saved.status_code == 200
            and brand_saved.json()["creator_version"] == 1
            and brand_saved.json()["brand_version"] == 1
            and brand_saved.json()["brand_gst"] is None
        ))
        safe_read = call("GET", f"/deals/{posted}/payment-details", "K")
        safe_text = json.dumps(safe_read.json(), sort_keys=True)
        check("dedicated response has business fields, versions, completion, timestamps and actions", (
            safe_read.status_code == 200
            and safe_read.json()["creator_complete"]
            and safe_read.json()["brand_complete"]
            and safe_read.json()["creator_updated_at"]
            and safe_read.json()["brand_updated_at"]
        ))
        check("safe response omits actor ids, audit rows and service metadata", all(
            term not in safe_text for term in ("updated_by", "actor_id", "audit_log", "ip_address", "details_id")
        ))

        creator_changed = call(
            "PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(1, "two", None)
        )
        check("creator change advances only creator version", (
            creator_changed.status_code == 200
            and creator_changed.json()["creator_version"] == 2
            and creator_changed.json()["brand_version"] == 1
        ))
        stale = call(
            "PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(1, "stale", None)
        )
        check("stale creator write fails without mutation or audit noise", (
            stale.status_code == 409
            and detail_row(posted)["creator_version"] == 2
            and audit_count(posted) == 3
        ))
        brand_changed = call(
            "PUT", f"/deals/{posted}/payment-details/brand", "B", brand_body(1, "two", None)
        )
        check("brand change advances independently", (
            brand_changed.status_code == 200
            and brand_changed.json()["creator_version"] == 2
            and brand_changed.json()["brand_version"] == 2
        ))

        race_deal = make_deal("posted", "cross-side race")

        def cross_side(side: str) -> tuple[str, int]:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            try:
                if side == "creator":
                    state = update_creator_details(
                        race_deal, ids["C"], creator_body(0, "race", None), "fictional-race", _client=client
                    )
                    return side, state["creator_version"]
                state = update_brand_details(
                    race_deal, ids["B"], brand_body(0, "race", None), "fictional-race", _client=client
                )
                return side, state["brand_version"]
            except DealError as exc:
                return side, -exc.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            race_results = list(pool.map(cross_side, ("creator", "brand")))
        race_row = detail_row(race_deal)
        check("simultaneous legitimate side writes preserve both independent versions", (
            sorted(race_results) == [("brand", 1), ("creator", 1)]
            and race_row["creator_version"] == 1
            and race_row["brand_version"] == 1
        ))

        same_side_deal = make_deal("posted", "same-side race")
        first_same = call(
            "PUT", f"/deals/{same_side_deal}/payment-details/creator", "C", creator_body(0, "base", None)
        )
        assert first_same.status_code == 200

        def same_side(suffix: str) -> int:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            try:
                update_creator_details(
                    same_side_deal, ids["C"], creator_body(1, suffix, None), "fictional-race", _client=client
                )
                return 200
            except DealError as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            same_results = list(pool.map(same_side, ("alpha", "beta")))
        check("same-side concurrent edits produce one version and one stale conflict", (
            sorted(same_results) == [200, 409]
            and detail_row(same_side_deal)["creator_version"] == 2
        ))

        admin.table("deals").update({"stage": "payment"}).eq("id", posted).execute()
        frozen_row = detail_row(posted)
        frozen_audits = audit_count(posted)
        check("both sides freeze once Payment starts", all(
            response.status_code == 409 for response in (
                call("PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(2, "frozen", None)),
                call("PUT", f"/deals/{posted}/payment-details/brand", "B", brand_body(2, "frozen", None)),
            )
        ))
        check("Payment read remains stable and freeze creates no mutation", (
            call("GET", f"/deals/{posted}/payment-details", "K").status_code == 200
            and detail_row(posted) == frozen_row
            and audit_count(posted) == frozen_audits
        ))
        admin.table("deals").update({"stage": "closed"}).eq("id", posted).execute()
        check("Closed participant read remains available and read-only", (
            call("GET", f"/deals/{posted}/payment-details", "C").status_code == 200
            and call("PUT", f"/deals/{posted}/payment-details/creator", "C", creator_body(2, "closed", None)).status_code == 409
        ))

        creator_client = auth_client("C")
        anon_client = create_client(SUPABASE_URL, ANON_KEY)
        row_id = detail_row(posted)["id"]
        check("authenticated direct select is denied", direct_denied(
            lambda: creator_client.table("deal_payment_details").select("*").execute()
        ))
        check("authenticated direct insert, update, delete and deal pivot are denied", all((
            direct_denied(lambda: creator_client.table("deal_payment_details").insert({"deal_id": posted}).execute()),
            direct_denied(lambda: creator_client.table("deal_payment_details").update({"deal_id": race_deal}).eq("id", row_id).execute()),
            direct_denied(lambda: creator_client.table("deal_payment_details").delete().eq("id", row_id).execute()),
        )))
        check("anon direct table write is denied", direct_denied(
            lambda: anon_client.table("deal_payment_details").insert({"deal_id": posted}).execute()
        ))
        check("participant and anon cannot execute backend-owned RPCs", all((
            direct_denied(lambda: creator_client.rpc("update_creator_payment_details", {
                "p_deal_id": posted,
                "p_actor_id": ids["C"],
                "p_expected_version": 2,
                "p_creator_legal_name": "Fictional",
                "p_creator_bank_or_upi": "Fictional instruction",
                "p_creator_tax_id": None,
                "p_ip_address": "forbidden",
            }).execute()),
            direct_denied(lambda: anon_client.rpc("update_creator_payment_details", {
                "p_deal_id": posted,
                "p_actor_id": ids["C"],
                "p_expected_version": 2,
                "p_creator_legal_name": "Fictional",
                "p_creator_bank_or_upi": "Fictional instruction",
                "p_creator_tax_id": None,
                "p_ip_address": "forbidden",
            }).execute()),
        )))

        audit_rows = (
            admin.table("audit_log")
            .select("action,entity_type,entity_id,metadata")
            .eq("action", "payment_details_updated")
            .contains("metadata", {"deal_id": posted})
            .execute()
            .data
        )
        audit_text = json.dumps(audit_rows, sort_keys=True)
        check("audit evidence is side/version/outcome metadata only", (
            '"side"' in audit_text and '"version"' in audit_text and '"outcome"' in audit_text
        ))
        check("audit evidence contains no payment-detail values or request bodies", all(
            value not in audit_text for value in (
                "Fictional Creator Studio", "Fictional off-platform payment instruction",
                "Fictional Brand Billing", "Fictional billing address", "FICTIONAL-TAX", "FICTIONAL-GST",
                "request_body", "creator_bank_or_upi", "brand_billing_address",
            )
        ))

    finally:
        cleanup()

    failed = [label for label, passed in checks if not passed]
    print(f"\nTEST-PAYMENT-DETAILS: {len(checks) - len(failed)}/{len(checks)} checks passed")
    if failed:
        print("Failed checks:")
        for label in failed:
            print(f"  - {label}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
