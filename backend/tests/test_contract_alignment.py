"""Development-Supabase acceptance evidence for Workplan 10-D.

Uses only fictional accounts/data and a deterministic fake extraction provider.
Migration and integration execution are serialised by the factory orchestrator.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from main import app  # noqa: E402
from services.contract_alignment import (  # noqa: E402
    PROMPT_VERSION,
    SCHEMA_VERSION,
    confirm_contract_alignment,
    start_contract_alignment,
)
from services.stage_engine import DealError  # noqa: E402
from test_contract_alignment_unit import Provider, payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

PASSWORD = "Alignment2026!Fictional"
IP = "127.0.0.1"
USERS = {
    "creator": ("alignment.creator@inflo.test", "Diya Fictional", "creator"),
    "maker": ("alignment.maker@inflo.test", "Arjun Fictional", "brand"),
    "checker": ("alignment.checker@inflo.test", "Leela Fictional", "brand"),
    "outsider": ("alignment.outsider@inflo.test", "Omar Outsider", "creator"),
}
VALID_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40">'
    '<path d="M 2 22 L 20 8 L 36 30 M 40 22 L 72 12 L 112 24" fill="none" '
    'stroke="#1C1B18" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_id: str | None = None
results: list[tuple[str, bool]] = []


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


def call(method: str, path: str, key: str, body: dict[str, Any] | None = None):
    return api.request(method, path, headers={"Authorization": f"Bearer {tokens[key]}"}, json=body)


def make_deal(label: str) -> tuple[str, str]:
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
    summary_id = admin.table("ai_summaries").insert(
        {
            "deal_id": deal_id,
            "raw_output": {"fixture": "fictional-approved-summary"},
            "structured_terms": payload(),
            "status": "approved",
        }
    ).execute().data[0]["id"]
    generated = call("POST", f"/deals/{deal_id}/contract", "creator", {})
    if generated.status_code != 200:
        raise AssertionError(f"contract generation failed safely: {generated.status_code} {generated.json()}")
    return deal_id, summary_id


def contract_for(deal_id: str) -> dict[str, Any]:
    return admin.table("contracts").select("*").eq("deal_id", deal_id).eq("version", 1).single().execute().data


def provider_payload(*, conflict: bool = False) -> dict[str, Any]:
    value = payload()
    for envelope in value.values():
        for item in envelope["evidence"]:
            item["quote"] = "Inflo collaboration agreement"
    if conflict:
        value["content_ownership"]["value"] = "brand"
    return value


def storage_names() -> list[str]:
    if not deal_ids:
        return []
    quoted = ",".join(f"'{deal_id}'" for deal_id in deal_ids)
    return [
        row["name"]
        for row in mgmt_sql(
            "select name from storage.objects where bucket_id='contracts' "
            f"and split_part(name,'/',1) in ({quoted});"
        )
    ]


def cleanup() -> None:
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


def cleanup_leftovers() -> None:
    leftovers = [user for user in admin.auth.admin.list_users() if user.email in {value[0] for value in USERS.values()}]
    if not leftovers:
        return
    old_ids = [user.id for user in leftovers]
    quoted = ",".join(f"'{user_id}'" for user_id in old_ids)
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    old_deals = admin.table("deals").select("id,brand_id").or_(
        f"creator_id.in.({','.join(old_ids)}),created_by.in.({','.join(old_ids)})"
    ).execute().data
    old_deal_ids = [row["id"] for row in old_deals]
    if old_deal_ids:
        old_names = [
            row["name"]
            for row in mgmt_sql(
                "select name from storage.objects where bucket_id='contracts' and split_part(name,'/',1) in ("
                + ",".join(f"'{deal}'" for deal in old_deal_ids)
                + ");"
            )
        ]
        if old_names:
            admin.storage.from_("contracts").remove(old_names)
        for row in old_deals:
            admin.table("deals").delete().eq("id", row["id"]).execute()
    old_brands = {row["brand_id"] for row in old_deals if row.get("brand_id")}
    old_brands.update(row["brand_id"] for row in admin.table("brand_members").select("brand_id").in_("profile_id", old_ids).execute().data)
    for old_brand in old_brands:
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
            tokens[key] = auth_client(key).auth.get_session().access_token
            admin.table("profiles").insert(
                {"id": ids[key], "account_type": account_type, "display_name": name, "email": email}
            ).execute()
        brand_id = admin.table("brands").insert(
            {"company_name": "Alignment Fictional Labs", "industry": "Beauty"}
        ).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [
                {"brand_id": brand_id, "profile_id": ids["maker"], "brand_role": "admin", "status": "active"},
                {"brand_id": brand_id, "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            ]
        ).execute()
        admin.table("maker_checker_config").insert(
            {"brand_id": brand_id, "action_type": "contract_signing", "requires_checker": False}
        ).execute()

        clear_deal, clear_summary = make_deal("Clear alignment fictional campaign")
        clear_contract = contract_for(clear_deal)
        blocked = call("POST", f"/deals/{clear_deal}/contract/sign", "creator", {"mode": "drawn", "svg": VALID_SVG})
        check("missing alignment blocks FastAPI signing with no artifact", blocked.status_code == 409 and admin.table("contract_signatures").select("id").eq("contract_id", clear_contract["id"]).execute().data == [])

        outsider_provider = Provider([json.dumps(provider_payload())])
        try:
            asyncio.run(start_contract_alignment(clear_deal, ids["outsider"], IP, provider=outsider_provider))
            outsider_blocked = False
        except DealError as exc:
            outsider_blocked = exc.status_code == 403 and not outsider_provider.requests
        check("outsider is rejected before PDF/provider access", outsider_blocked)

        clear_provider = Provider([json.dumps(provider_payload())])
        clear_state = asyncio.run(start_contract_alignment(clear_deal, ids["creator"], IP, provider=clear_provider))
        again = asyncio.run(start_contract_alignment(clear_deal, ids["maker"], IP, provider=Provider([])))
        check("exact v1 PDF produces one immutable clear extraction", clear_state["status"] == "clear" and clear_state["signing_enabled"] and len(clear_provider.requests) == 1 and again["status"] == "clear")
        extracted = admin.table("extracted_terms").select("*").eq("contract_id", clear_contract["id"]).execute().data
        attempt = admin.table("contract_alignment_attempts").select("*").eq("contract_id", clear_contract["id"]).single().execute().data
        check("success binds contract/version/summary/hash/schema/prompt/provider/model", len(extracted) == 1 and extracted[0]["generated_from_summary_id"] == clear_summary and extracted[0]["contract_version"] == 1 and extracted[0]["source_sha256"] == attempt["source_sha256"] and extracted[0]["schema_version"] == SCHEMA_VERSION and extracted[0]["prompt_version"] == PROMPT_VERSION)

        creator_client = auth_client("creator")
        raw_blocked = contract_hash_blocked = storage_path_blocked = direct_rpc_blocked = direct_write_blocked = False
        try:
            creator_client.table("extracted_terms").select("raw_output,structured_terms,source_sha256,provider,model").eq("contract_id", clear_contract["id"]).execute()
        except Exception:
            raw_blocked = True
        try:
            creator_client.table("contracts").select("draft_source_sha256").eq("id", clear_contract["id"]).execute()
        except Exception:
            contract_hash_blocked = True
        try:
            creator_client.table("contracts").select("storage_path").eq("id", clear_contract["id"]).execute()
        except Exception:
            storage_path_blocked = True
        try:
            creator_client.rpc("contract_alignment_is_ready", {"p_deal_id": clear_deal, "p_contract_id": clear_contract["id"]}).execute()
        except Exception:
            direct_rpc_blocked = True
        try:
            creator_client.table("contract_signatures").insert(
                {"contract_id": clear_contract["id"], "signer_id": ids["creator"], "signature_mode": "drawn", "signature_ref": "forged", "ip_address": IP}
            ).execute()
        except Exception:
            direct_write_blocked = True
        outsider_rows = auth_client("outsider").table("extracted_terms").select("id,deal_id,conflicts_detected").eq("contract_id", clear_contract["id"]).execute().data
        check("participant raw/provenance columns, private storage path, direct RPC/writes, and outsider rows are denied", raw_blocked and contract_hash_blocked and storage_path_blocked and direct_rpc_blocked and direct_write_blocked and outsider_rows == [])

        creator_sign = call("POST", f"/deals/{clear_deal}/contract/sign", "creator", {"mode": "drawn", "svg": VALID_SVG})
        maker_sign = call("POST", f"/deals/{clear_deal}/contract/sign", "maker", {"mode": "drawn", "svg": VALID_SVG})
        clear_after = contract_for(clear_deal)
        check("clear alignment preserves signing, execution, and exactly-once Creating transition", creator_sign.status_code == 200 and maker_sign.status_code == 200 and clear_after["status"] == "executed" and admin.table("deals").select("stage").eq("id", clear_deal).single().execute().data["stage"] == "creating" and len(admin.table("deal_stage_transitions").select("id").eq("deal_id", clear_deal).eq("to_stage", "creating").execute().data) == 1)

        conflict_deal, _ = make_deal("Conflict override fictional campaign")
        conflict_contract = contract_for(conflict_deal)
        conflict_state = asyncio.run(start_contract_alignment(conflict_deal, ids["creator"], IP, provider=Provider([json.dumps(provider_payload(conflict=True))])))
        check("substantive mismatch returns exact participant-safe conflict and locks signing", conflict_state["status"] == "conflict" and not conflict_state["signing_enabled"] and [row["field_key"] for row in conflict_state["conflicts"]] == ["content_ownership"])

        hard_signature = hard_hold = hard_execution = hard_stage = False
        try:
            admin.table("contract_signatures").insert(
                {"contract_id": conflict_contract["id"], "signer_id": ids["creator"], "signature_mode": "drawn", "signature_ref": "service-forged", "ip_address": IP}
            ).execute()
        except Exception:
            hard_signature = True
        try:
            admin.table("maker_checker_requests").insert(
                {"deal_id": conflict_deal, "action_type": "contract_signing", "initiated_by": ids["maker"], "checker_id": ids["checker"], "status": "pending", "action_payload": {"contract_id": conflict_contract["id"]}}
            ).execute()
        except Exception:
            hard_hold = True
        try:
            admin.table("contracts").update({"status": "executed"}).eq("id", conflict_contract["id"]).execute()
        except Exception:
            hard_execution = True
        try:
            admin.table("deals").update({"stage": "creating"}).eq("id", conflict_deal).execute()
        except Exception:
            hard_stage = True
        check("SQL hard gates block signature, held request, execution, and Approval-to-Creating", hard_signature and hard_hold and hard_execution and hard_stage)

        extraction_id = conflict_state["extraction_id"]
        try:
            confirm_contract_alignment(conflict_deal, extraction_id, ids["checker"], IP)
            checker_blocked = False
        except DealError as exc:
            checker_blocked = exc.status_code == 403
        creator_confirm = confirm_contract_alignment(conflict_deal, extraction_id, ids["creator"], IP)
        creator_retry = confirm_contract_alignment(conflict_deal, extraction_id, ids["creator"], IP)
        maker_confirm = confirm_contract_alignment(conflict_deal, extraction_id, ids["maker"], IP)
        persisted_override = admin.table("extracted_terms").select("creator_confirmed_by,brand_confirmed_by,confirmed_by_both").eq("id", extraction_id).single().execute().data
        check("checker cannot resolve; side decisions are idempotent and both sides unlock exact conflicts", checker_blocked and creator_confirm["status"] == "conflict" and creator_retry["creator_confirmation"]["actor_id"] == ids["creator"] and maker_confirm["status"] == "overridden" and maker_confirm["signing_enabled"] and persisted_override == {"creator_confirmed_by": ids["creator"], "brand_confirmed_by": ids["maker"], "confirmed_by_both": True})

        admin.table("maker_checker_config").update({"requires_checker": True}).eq("brand_id", brand_id).eq("action_type", "contract_signing").execute()
        creator_ok = call("POST", f"/deals/{conflict_deal}/contract/sign", "creator", {"mode": "drawn", "svg": VALID_SVG})
        held = call("POST", f"/deals/{conflict_deal}/contract/sign", "maker", {"mode": "drawn", "svg": VALID_SVG})
        request_id = held.json()["maker_checker"]["request_id"]
        released = call("POST", f"/maker-checker/requests/{request_id}/decide", "checker", {"decision": "approve"})
        check("overridden alignment preserves maker-checker hold/release and execution", creator_ok.status_code == 200 and held.status_code == 200 and held.json()["required_signatures"]["brand"] == "held" and released.status_code == 200 and contract_for(conflict_deal)["status"] == "executed")

        lease_deal, lease_summary = make_deal("Lease takeover fictional campaign")
        lease_contract = contract_for(lease_deal)
        pdf = admin.storage.from_("contracts").download(lease_contract["storage_path"])
        digest = hashlib.sha256(pdf).hexdigest()
        reserve_args = {
            "p_deal_id": lease_deal,
            "p_contract_id": lease_contract["id"],
            "p_summary_id": lease_summary,
            "p_source_sha256": digest,
            "p_actor_id": ids["creator"],
            "p_ip_address": IP,
        }
        wrong_digest = ("0" if digest[0] != "0" else "1") + digest[1:]
        try:
            admin.rpc("reserve_contract_alignment", reserve_args | {"p_source_sha256": wrong_digest}).execute()
            wrong_hash_blocked = False
        except Exception as exc:
            wrong_hash_blocked = "ALIGNMENT_SOURCE_MISMATCH" in str(exc)
        no_wrong_attempt = admin.table("contract_alignment_attempts").select("contract_id").eq(
            "contract_id", lease_contract["id"]
        ).execute().data == []
        check(
            "reservation rejects a well-formed hash that is not the authoritative generated v1 draft",
            wrong_hash_blocked and no_wrong_attempt and lease_contract["draft_source_sha256"] == digest,
        )
        first = admin.rpc("reserve_contract_alignment", reserve_args).execute().data
        active = admin.rpc("reserve_contract_alignment", reserve_args | {"p_actor_id": ids["maker"]}).execute().data
        admin.table("contract_alignment_attempts").update({"lease_until": "2000-01-01T00:00:00Z"}).eq("contract_id", lease_contract["id"]).execute()
        takeover = admin.rpc("reserve_contract_alignment", reserve_args | {"p_actor_id": ids["maker"]}).execute().data
        try:
            admin.rpc("complete_contract_alignment", {
                "p_attempt_token": first["attempt_token"], "p_raw_output": payload(), "p_structured_terms": payload(), "p_conflicts": [],
                "p_schema_version": SCHEMA_VERSION, "p_prompt_version": PROMPT_VERSION, "p_provider": "fictional", "p_model": "fictional", "p_ip_address": IP,
            }).execute()
            stale_blocked = False
        except Exception:
            stale_blocked = True
        check("active lease reports processing; expiry takeover rejects the old worker token", first["outcome"] == "reserved" and active["outcome"] == "processing" and takeover["outcome"] == "reserved" and takeover["attempt_token"] != first["attempt_token"] and stale_blocked)

        audits = admin.table("audit_log").select("action,metadata").in_("entity_id", [clear_deal, conflict_deal]).execute().data
        encoded = json.dumps(audits).lower()
        check("alignment audit is metadata-only with success and override evidence", "contract_alignment_succeeded" in encoded and "contract_alignment_override_confirmed" in encoded and "campaign terms" not in encoded and "attempt_token" not in encoded and "draft-v1.pdf" not in encoded)
    finally:
        cleanup()

    failures = [label for label, ok in results if not ok]
    print(f"\n{len(results) - len(failures)}/{len(results)} contract-alignment integration checks passed")
    if failures:
        raise SystemExit("Failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
