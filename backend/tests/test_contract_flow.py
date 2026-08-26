"""Phase 9.11/9.12 development integration test with fictional, cleaned data.

Requires migrations 019-022 on the development Supabase project. Exercises the
real FastAPI auth/RBAC layer, private Storage, database RPCs, WeasyPrint output,
maker-checker release, and the stage engine.
"""

from __future__ import annotations

import io
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.contract_service import _pdf  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

PASSWORD = "Contract2026!Fictional"
IP = "127.0.0.1"
USERS = {
    "creator": ("contract.creator@inflo.test", "Aarohi Fictional", "creator"),
    "maker": ("contract.maker@inflo.test", "Kabir Fictional", "brand"),
    "checker": ("contract.checker@inflo.test", "Meera Fictional", "brand"),
    "outsider": ("contract.outsider@inflo.test", "Nikhil Outsider", "creator"),
}
VALID_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40">'
    '<path d="M 2 22 L 20 8 L 36 30 M 40 22 L 72 12 L 112 24" fill="none" '
    'stroke="#1C1B18" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
results: list[tuple[str, bool]] = []
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
brand_id: str | None = None
deal_ids: list[str] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> Any:
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": sql},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[key][0], "password": PASSWORD})
    return client


def headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens[key]}"}


def call(method: str, path: str, key: str, json: dict[str, Any] | None = None):
    return api.request(method, path, headers=headers(key), json=json)


def make_deal(label: str) -> str:
    deal_id = admin.table("deals").insert(
        {
            "creator_id": ids["creator"],
            "brand_id": brand_id,
            "deal_name": label,
            "deal_type": "campaign",
            "stage": "approval",
            "direction": "inbound",
            "currency": "INR",
            "created_by": ids["maker"],
        }
    ).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert(
        [
            {"deal_id": deal_id, "profile_id": ids["creator"], "participant_role": "creator"},
            {"deal_id": deal_id, "profile_id": ids["maker"], "participant_role": "brand_maker"},
            {"deal_id": deal_id, "profile_id": ids["checker"], "participant_role": "brand_checker"},
        ]
    ).execute()
    admin.table("ai_summaries").insert(
        {
            "deal_id": deal_id,
            "raw_output": {"source": "fictional integration test"},
            "structured_terms": {
                "payment_amount": {"status": "found", "value": 42000},
                "deliverables": {"status": "found", "value": ["One Reel", "Three Stories"]},
                "creative_guidance": {"status": "found", "value": "Show <script>alert('x')</script> safely"},
                "exclusivity": {"status": "found", "value": False},
                "revision_rounds": {"status": "found", "value": 2},
            },
            "status": "approved",
        }
    ).execute()
    return deal_id


def contract_for(deal_id: str) -> dict[str, Any]:
    return admin.table("contracts").select("*").eq("deal_id", deal_id).single().execute().data


def upload_wet_pdf(deal_id: str, contract_id: str, *, valid: bool = True) -> str:
    path = f"{deal_id}/{contract_id}/wet-signatures/{ids['creator']}/{uuid4()}.pdf"
    content = _pdf("<html><body><h1>Wet-signed fictional agreement</h1><p>Hand signatures completed offline.</p></body></html>") if valid else b"%PDF fake"
    auth_client("creator").storage.from_("contracts").upload(
        path, content, file_options={"content-type": "application/pdf", "upsert": "false"}
    )
    return path


def storage_names() -> list[str]:
    if not deal_ids:
        return []
    quoted = ",".join(f"'{deal}'" for deal in deal_ids)
    rows = mgmt_sql(
        "select name from storage.objects where bucket_id='contracts' "
        f"and split_part(name,'/',1) in ({quoted});"
    )
    return [row["name"] for row in rows]


def cleanup() -> None:
    print("\nCleaning up fictional contract test data...")
    try:
        names = storage_names()
        if names:
            admin.storage.from_("contracts").remove(names)
    except Exception:
        pass
    user_ids = list(ids.values())
    if user_ids:
        quoted = ",".join(f"'{user_id}'" for user_id in user_ids)
        mgmt_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
            "SET session_replication_role = origin;"
        )
    for deal_id in deal_ids:
        admin.table("deals").delete().eq("id", deal_id).execute()
    if brand_id:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in user_ids:
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def cleanup_leftovers() -> None:
    emails = {row[0] for row in USERS.values()}
    leftovers = [user for user in admin.auth.admin.list_users() if user.email in emails]
    if not leftovers:
        return
    leftover_ids = [user.id for user in leftovers]
    quoted = ",".join(f"'{user_id}'" for user_id in leftover_ids)
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    old_deals = admin.table("deals").select("id,brand_id").or_(
        f"creator_id.in.({','.join(leftover_ids)}),created_by.in.({','.join(leftover_ids)})"
    ).execute().data
    old_deal_ids = [row["id"] for row in old_deals]
    if old_deal_ids:
        storage = mgmt_sql(
            "select name from storage.objects where bucket_id='contracts' and split_part(name,'/',1) in ("
            + ",".join(f"'{deal}'" for deal in old_deal_ids)
            + ");"
        )
        if storage:
            admin.storage.from_("contracts").remove([row["name"] for row in storage])
        for row in old_deals:
            admin.table("deals").delete().eq("id", row["id"]).execute()
    brand_ids = {row["brand_id"] for row in old_deals if row.get("brand_id")}
    brand_ids.update(row["brand_id"] for row in admin.table("brand_members").select("brand_id").in_("profile_id", leftover_ids).execute().data)
    for old_brand in brand_ids:
        admin.table("brands").delete().eq("id", old_brand).execute()
    for user in leftovers:
        admin.auth.admin.delete_user(user.id)


def main() -> None:
    global brand_id
    cleanup_leftovers()
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {"email": email, "password": PASSWORD, "email_confirm": True}
            ).user.id
            admin.table("profiles").insert(
                {"id": ids[key], "email": email, "display_name": name, "account_type": account_type}
            ).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table("brands").insert({"company_name": "Fictional Monsoon Foods", "industry": "F&B"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [
                {"brand_id": brand_id, "profile_id": ids["maker"], "brand_role": "admin", "status": "active"},
                {"brand_id": brand_id, "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            ]
        ).execute()
        admin.table("signatures").insert(
            [
                {"profile_id": ids["creator"], "signature_type": "typed", "signature_data": "Aarohi Fictional", "is_active": True},
                {"profile_id": ids["maker"], "signature_type": "typed", "signature_data": "Kabir Fictional", "is_active": True},
            ]
        ).execute()
        admin.table("maker_checker_config").insert(
            {"brand_id": brand_id, "action_type": "contract_signing", "requires_checker": False}
        ).execute()

        # Generation: wrong stage/missing approval rejected; concurrent generation is one v1.
        wrong = make_deal("Wrong-stage fictional contract")
        admin.table("deals").update({"stage": "chatting"}).eq("id", wrong).execute()
        check("generation is Approval-only", call("POST", f"/deals/{wrong}/contract", "creator", {}).status_code == 409)

        missing = make_deal("Missing-summary fictional contract")
        admin.table("ai_summaries").delete().eq("deal_id", missing).execute()
        check("generation requires an approved summary", call("POST", f"/deals/{missing}/contract", "creator", {}).status_code == 409)

        deal_a = make_deal("Concurrent digital signing campaign")
        with ThreadPoolExecutor(max_workers=4) as pool:
            generated = list(pool.map(lambda _: call("POST", f"/deals/{deal_a}/contract", "creator", {}), range(4)))
        check("concurrent generation requests all succeed idempotently", all(response.status_code == 200 for response in generated))
        contracts = admin.table("contracts").select("id,status,storage_path").eq("deal_id", deal_a).execute().data
        generation_audits = admin.table("audit_log").select("id").eq("entity_id", deal_a).eq("action", "contract_generated").execute().data
        check("exactly one version-1 contract and generation audit", len(contracts) == 1 and len(generation_audits) == 1)
        draft = admin.storage.from_("contracts").download(contracts[0]["storage_path"])
        draft_text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(draft)).pages)
        check("draft is a valid escaped PDF from the approved summary", draft.startswith(b"%PDF") and "42,000" in draft_text and "<script>" in draft_text and "alert" in draft_text)

        bucket = mgmt_sql("select public from storage.buckets where id='contracts';")
        check("contracts bucket is private", bucket == [{"public": False}])
        outsider_status = call("GET", f"/deals/{deal_a}/contract", "outsider")
        participant_link = call("GET", f"/deals/{deal_a}/contract/download", "creator")
        outsider_link = call("GET", f"/deals/{deal_a}/contract/download", "outsider")
        check("participant receives a short-lived signed download URL", participant_link.status_code == 200 and participant_link.json().get("expires_in") == 300)
        check("outsider contract status/download are denied", outsider_status.status_code == 403 and outsider_link.status_code == 403)
        direct_signature_blocked = False
        try:
            auth_client("creator").table("contract_signatures").insert(
                {
                    "contract_id": contracts[0]["id"], "signer_id": ids["creator"],
                    "signature_mode": "stored", "signature_ref": "bypass-attempt", "ip_address": IP,
                }
            ).execute()
        except Exception:
            direct_signature_blocked = True
        direct_request_blocked = False
        try:
            auth_client("maker").table("maker_checker_requests").insert(
                {
                    "deal_id": deal_a, "action_type": "contract_signing",
                    "initiated_by": ids["maker"], "checker_id": ids["checker"], "status": "pending",
                }
            ).execute()
        except Exception:
            direct_request_blocked = True
        check("direct client signature and approval-request writes are blocked", direct_signature_blocked and direct_request_blocked)

        # Stored + drawn, including concurrent duplicate protection and execution.
        with ThreadPoolExecutor(max_workers=2) as pool:
            signed = list(pool.map(lambda _: call("POST", f"/deals/{deal_a}/contract/sign", "creator", {"mode": "stored"}), range(2)))
        check("concurrent duplicate creator signature is protected", sorted(response.status_code for response in signed) == [200, 409])
        brand_drawn = call("POST", f"/deals/{deal_a}/contract/sign", "maker", {"mode": "drawn", "svg": VALID_SVG})
        row_a = contract_for(deal_a)
        transition_a = admin.table("deal_stage_transitions").select("id").eq("deal_id", deal_a).eq("from_stage", "approval").eq("to_stage", "creating").execute().data
        executed_a = admin.storage.from_("contracts").download(row_a["storage_path"])
        executed_text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(executed_a)).pages)
        check("stored and drawn signing execute the contract", brand_drawn.status_code == 200 and row_a["status"] == "executed")
        check("executed PDF is newly rendered with completed evidence", executed_a != draft and "EXECUTED" in executed_text and "Signature evidence ID" in executed_text)
        check("Approval advances to Creating exactly once", len(transition_a) == 1 and admin.table("deals").select("stage").eq("id", deal_a).single().execute().data["stage"] == "creating")

        # Print bypass: fake uploaded bytes rejected, real private PDF accepted and appended.
        deal_b = make_deal("Wet-sign fictional campaign")
        check("second contract generates", call("POST", f"/deals/{deal_b}/contract", "creator", {}).status_code == 200)
        contract_b = contract_for(deal_b)
        invalid_path = upload_wet_pdf(deal_b, contract_b["id"], valid=False)
        invalid_sign = call("POST", f"/deals/{deal_b}/contract/sign", "creator", {"mode": "print_bypass", "bypass_reason": "Signed while travelling", "physical_doc_path": invalid_path})
        check("fake PDF bytes are rejected after private upload", invalid_sign.status_code == 422)
        valid_path = upload_wet_pdf(deal_b, contract_b["id"], valid=True)
        outsider_path = f"{deal_b}/{contract_b['id']}/wet-signatures/{ids['creator']}/{uuid4()}.pdf"
        outsider_upload_blocked = False
        try:
            auth_client("outsider").storage.from_("contracts").upload(
                outsider_path, _pdf("<h1>Outsider</h1>"), file_options={"content-type": "application/pdf", "upsert": "false"}
            )
        except Exception:
            outsider_upload_blocked = True
        check("outsider cannot upload into a participant wet-sign folder", outsider_upload_blocked)
        print_sign = call("POST", f"/deals/{deal_b}/contract/sign", "creator", {"mode": "print_bypass", "bypass_reason": "Signed while travelling", "physical_doc_path": valid_path})
        brand_stored = call("POST", f"/deals/{deal_b}/contract/sign", "maker", {"mode": "stored"})
        executed_b = admin.storage.from_("contracts").download(contract_for(deal_b)["storage_path"])
        check("print bypass with a real PDF and stored brand signature succeeds", print_sign.status_code == 200 and brand_stored.status_code == 200)
        check("wet-signed PDF pages are appended to executed evidence", len(PdfReader(io.BytesIO(executed_b)).pages) > len(PdfReader(io.BytesIO(draft)).pages))
        private_columns_blocked = False
        try:
            auth_client("creator").table("contract_signatures").select("signature_ref,ip_address,physical_doc_path").eq("contract_id", contract_b["id"]).execute()
        except Exception:
            private_columns_blocked = True
        evidence_path = admin.table("contract_signatures").select("physical_doc_path").eq("contract_id", contract_b["id"]).eq("signer_id", ids["creator"]).single().execute().data["physical_doc_path"]
        evidence_delete_blocked = False
        try:
            auth_client("creator").storage.from_("contracts").remove([evidence_path])
        except Exception:
            evidence_delete_blocked = True
        if not evidence_delete_blocked:
            still_there = mgmt_sql(
                "select count(*)::int as count from storage.objects "
                f"where bucket_id='contracts' and name='{evidence_path}';"
            )
            evidence_delete_blocked = still_there == [{"count": 1}]
        check("signature snapshots, IPs and evidence paths are not participant-readable", private_columns_blocked)
        check("backend wet-sign evidence copy cannot be deleted by a participant", evidence_delete_blocked)

        # Maker-checker: held, reject (no signature), retry, approve exactly once.
        admin.table("maker_checker_config").update({"requires_checker": True}).eq("brand_id", brand_id).eq("action_type", "contract_signing").execute()
        deal_c = make_deal("Maker-checker fictional campaign")
        call("POST", f"/deals/{deal_c}/contract", "creator", {})
        call("POST", f"/deals/{deal_c}/contract/sign", "creator", {"mode": "drawn", "svg": VALID_SVG})
        held = call("POST", f"/deals/{deal_c}/contract/sign", "maker", {"mode": "stored"})
        held_state = held.json()
        first_request = held_state["maker_checker"]["request_id"]
        held_payload_blocked = False
        try:
            auth_client("creator").table("maker_checker_requests").select("action_payload").eq("id", first_request).execute()
        except Exception:
            held_payload_blocked = True
        before_reject = admin.table("contract_signatures").select("id").eq("contract_id", held_state["contract"]["id"]).execute().data
        rejected = call("POST", f"/maker-checker/requests/{first_request}/decide", "checker", {"decision": "reject", "comment": "Please redraw clearly."})
        after_reject = admin.table("contract_signatures").select("id").eq("contract_id", held_state["contract"]["id"]).execute().data
        check("maker signature is held for checker", held.status_code == 200 and held_state["required_signatures"]["brand"] == "held")
        check("held signature payload is not participant-readable", held_payload_blocked)
        check("checker rejection applies no brand signature", rejected.status_code == 200 and len(before_reject) == len(after_reject) == 1)
        retry = call("POST", f"/deals/{deal_c}/contract/sign", "maker", {"mode": "drawn", "svg": VALID_SVG})
        second_request = retry.json()["maker_checker"]["request_id"]
        approved = call("POST", f"/maker-checker/requests/{second_request}/decide", "checker", {"decision": "approve", "comment": "Approved."})
        approve_again = call("POST", f"/maker-checker/requests/{second_request}/decide", "checker", {"decision": "approve"})
        sigs_c = admin.table("contract_signatures").select("signer_id,on_behalf_of_brand_id").eq("contract_id", retry.json()["contract"]["id"]).execute().data
        transitions_c = admin.table("deal_stage_transitions").select("id").eq("deal_id", deal_c).eq("from_stage", "approval").eq("to_stage", "creating").execute().data
        check("rejected maker can retry with a new held request", retry.status_code == 200 and second_request != first_request)
        check("checker approval releases the maker signature exactly once", approved.status_code == 200 and approve_again.status_code == 409 and sum(bool(row["on_behalf_of_brand_id"]) for row in sigs_c) == 1)
        check("checker approval produces one executed contract and one transition", contract_for(deal_c)["status"] == "executed" and len(transitions_c) == 1)

        audits = admin.table("audit_log").select("action,metadata,ip_address").in_("entity_id", [deal_a, deal_b, deal_c]).execute().data
        actions = [row["action"] for row in audits]
        check("generation, signing, execution, download and IP audit records exist", all(action in actions for action in ["contract_generated", "contract_signature_applied", "contract_executed", "contract_download_link_issued"]) and all(row["ip_address"] for row in audits))
        extracted = admin.table("extracted_terms").select("id").in_("deal_id", [deal_a, deal_b, deal_c]).execute().data
        check("Phase 10 seam remains honest (no fabricated extracted_terms)", extracted == [])
    finally:
        cleanup()

    failures = [label for label, ok in results if not ok]
    print(f"\n{len(results) - len(failures)}/{len(results)} contract-flow checks passed")
    if failures:
        raise SystemExit("Failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
