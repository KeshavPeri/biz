"""Development-Supabase acceptance checks for canonical whitelisting tracking."""

from __future__ import annotations

import copy
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from main import app  # noqa: E402
from services.term_extraction import (  # noqa: E402
    CHAT_PROMPT_VERSION_V2, CHAT_PROMPT_VERSION_V3, CHAT_SCHEMA_VERSION_V2, CHAT_SCHEMA_VERSION_V3,
)
from services.whitelisting_service import materialize_for_creating_entry, whitelisting_status  # noqa: E402
from test_contract_alignment_unit import payload_v2, payload_v3  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
FIXTURE_LOGIN = "Whitelisting2028!Fictional"
EMAILS = {
    "creator": "whitelisting.creator@inflo.test", "admin": "whitelisting.admin@inflo.test",
    "maker": "whitelisting.maker@inflo.test", "checker": "whitelisting.checker@inflo.test",
    "cross_brand": "whitelisting.cross-brand@inflo.test", "outsider": "whitelisting.outsider@inflo.test",
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
api = TestClient(app)
ids: dict[str, str] = {}; tokens: dict[str, str] = {}; deal_ids: list[str] = []; brand_ids: list[str] = []
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition)); print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> Any:
    response = httpx.post(f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query", headers={"Authorization": f"Bearer {ACCESS_TOKEN}"}, json={"query": sql}, timeout=30)
    response.raise_for_status(); return response.json()


def rejected(sql: str, marker: str) -> bool:
    try: mgmt_sql(sql); return False
    except httpx.HTTPStatusError as exc: return marker in exc.response.text


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY); client.auth.sign_in_with_password({"email": EMAILS[key], "password": FIXTURE_LOGIN}); return client


def bearer(key: str) -> dict[str, str]: return {"Authorization": f"Bearer {tokens[key]}"}


def source_terms(*, enabled: bool = True, version: int = 3, dates: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    value = copy.deepcopy(payload_v3() if version == 3 else payload_v2())
    if version == 3:
        if enabled:
            periods = dates or [("2028-02-01", "2028-02-28")]
            value["whitelisting"]["value"] = {"enabled": True, "arrangements": [
                {"platform": "Instagram", "ad_account": "Ｆictional Brand Ads", "start_date": start, "end_date": end,
                 "budget": ({"amount": 0, "currency": "INR"} if index == 0 else {"amount": 999999999999999999999, "currency": "INR"})}
                for index, (start, end) in enumerate(periods)
            ]}
        else:
            value["whitelisting"]["value"] = {"enabled": False, "arrangements": []}
    return value


def create_deal(label: str, *, enabled: bool = True, version: int = 3, canonical: bool = True, transition: bool = True, dates: list[tuple[str, str]] | None = None, exact_budgets: list[str] | None = None) -> tuple[str, str, str, dict[str, Any]]:
    deal_id = admin.table("deals").insert({"creator_id": ids["creator"], "brand_id": brand_ids[0], "deal_name": label, "deal_type": "campaign", "stage": "approval", "direction": "inbound", "currency": "INR", "created_by": ids["admin"]}).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["creator"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["admin"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["maker"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["checker"], "participant_role": "brand_checker"},
    ]).execute()
    schema, prompt = ((CHAT_SCHEMA_VERSION_V3, CHAT_PROMPT_VERSION_V3) if version == 3 else (CHAT_SCHEMA_VERSION_V2, CHAT_PROMPT_VERSION_V2))
    source = admin.table("ai_summaries").insert({"deal_id": deal_id, "raw_output": {"source": "fictional whitelisting acceptance"}, "structured_terms": source_terms(enabled=enabled, version=version, dates=dates), "status": "approved", "schema_version": schema, "prompt_version": prompt}).execute().data[0]
    for index, amount in enumerate(exact_budgets or []):
        if not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d*[1-9])?", amount):
            raise AssertionError("invalid exact fictional budget")
        mgmt_sql(
            "UPDATE ai_summaries SET structured_terms = jsonb_set(structured_terms, "
            f"'{{whitelisting,value,arrangements,{index},budget,amount}}', "
            f"to_jsonb({amount}::numeric), false) WHERE id='{source['id']}';"
        )
    contract = admin.table("contracts").insert({"deal_id": deal_id, "version": 1, "status": "executed", "storage_path": f"{deal_id}/fictional-executed-v1.pdf", "generated_from_summary_id": source["id"], "draft_source_sha256": "0" * 64}).execute().data[0]
    executed_at = datetime.now(timezone.utc)
    admin.table("audit_log").insert({"actor_id": ids["admin"], "action": "contract_executed", "entity_type": "deal", "entity_id": deal_id, "metadata": {"contract_id": contract["id"], "version": 1}, "ip_address": "127.0.0.1", "created_at": executed_at.isoformat()}).execute()
    outcome = materialize_for_creating_entry(admin, deal_id, ids["admin"], "127.0.0.1") if canonical else {}
    mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='creating' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
    if transition:
        admin.table("deal_stage_transitions").insert({"deal_id": deal_id, "from_stage": "approval", "to_stage": "creating", "transition_type": "auto", "triggered_by": ids["admin"], "created_at": (executed_at + timedelta(minutes=1)).isoformat()}).execute()
    return deal_id, source["id"], contract["id"], outcome


def raw_denied(client: Client, operation: str, deal_id: str) -> bool:
    try:
        table = client.table("whitelisting_arrangements")
        if operation == "select": table.select("*").eq("deal_id", deal_id).execute()
        elif operation == "insert": table.insert({"deal_id": deal_id, "has_whitelisting": False}).execute()
        elif operation == "update": table.update({"ad_account": "tamper"}).eq("deal_id", deal_id).execute()
        else: table.delete().eq("deal_id", deal_id).execute()
        return False
    except Exception: return True


def cleanup() -> None:
    if ids:
        quoted = ",".join(f"'{value}'" for value in ids.values()); mgmt_sql("SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;")
    for deal_id in deal_ids: admin.table("deals").delete().eq("id", deal_id).execute()
    for brand_id in brand_ids: admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values(): admin.auth.admin.delete_user(user_id)


def cleanup_leftovers() -> None:
    leftovers = [user for user in admin.auth.admin.list_users() if user.email in set(EMAILS.values())]
    if not leftovers: return
    old_ids = [user.id for user in leftovers]; quoted = ",".join(f"'{value}'" for value in old_ids)
    rows = mgmt_sql(f"SELECT id, brand_id FROM deals WHERE creator_id IN ({quoted}) OR created_by IN ({quoted});")
    mgmt_sql("SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;")
    for row in rows: admin.table("deals").delete().eq("id", row["id"]).execute()
    old_brands = {row["brand_id"] for row in rows}; old_brands.update(row["brand_id"] for row in admin.table("brand_members").select("brand_id").in_("profile_id", old_ids).execute().data)
    for brand_id in old_brands: admin.table("brands").delete().eq("id", brand_id).execute()
    for user in leftovers: admin.auth.admin.delete_user(user.id)


def main() -> None:
    cleanup_leftovers()
    try:
        for key, email in EMAILS.items():
            account_type = "brand" if key in {"admin", "maker", "checker", "cross_brand"} else "creator"
            ids[key] = admin.auth.admin.create_user({"email": email, "password": FIXTURE_LOGIN, "email_confirm": True}).user.id
            admin.table("profiles").insert({"id": ids[key], "email": email, "display_name": f"{key.title()} Fictional Whitelisting", "account_type": account_type}).execute(); tokens[key] = auth_client(key).auth.get_session().access_token
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Boosting Labs", "industry": "Media"}).execute().data[0]["id"])
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Cross Brand", "industry": "Media"}).execute().data[0]["id"])
        admin.table("brand_members").insert([
            {"brand_id": brand_ids[0], "profile_id": ids["admin"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["maker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[1], "profile_id": ids["cross_brand"], "brand_role": "admin", "status": "active"},
        ]).execute()

        today = datetime.now(timezone.utc).date()
        periods = [((today - timedelta(days=1)).isoformat(), (today + timedelta(days=1)).isoformat()), ((today + timedelta(days=2)).isoformat(), (today + timedelta(days=5)).isoformat()), ((today - timedelta(days=5)).isoformat(), (today - timedelta(days=2)).isoformat())]
        exact_fraction = "123456789.123456789123456789"
        enabled_id, enabled_source, _, created = create_deal("Fictional Enabled", dates=periods, exact_budgets=[exact_fraction, "10", "2"])
        false_id, _, _, _ = create_deal("Fictional Not Enabled", enabled=False)
        fallback_id, _, _, _ = create_deal("Fictional Historical V3", canonical=False, exact_budgets=[exact_fraction])
        ordering_period = [periods[0], periods[0]]
        ordering_id, ordering_source, _, _ = create_deal("Fictional Identity Order", dates=ordering_period, exact_budgets=["2", "10"])
        legacy_id, _, _, legacy = create_deal("Fictional Legacy V2", version=2)
        unavailable_id, _, _, _ = create_deal("Fictional Missing Transition", canonical=False, transition=False)
        rows = admin.table("whitelisting_arrangements").select("*").eq("deal_id", enabled_id).order("arrangement_sequence").execute().data
        retry = admin.rpc("materialize_canonical_whitelisting", {"p_deal_id": enabled_id, "p_source_summary_id": enabled_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute().data
        exact_projection = admin.rpc("project_whitelisting_exact", {"p_deal_id": enabled_id, "p_source_summary_id": enabled_source}).execute().data
        ordering_projection = admin.rpc("project_whitelisting_exact", {"p_deal_id": ordering_id, "p_source_summary_id": ordering_source}).execute().data
        canonical_payload = api.get("/tracking/whitelisting", headers=bearer("creator")).json()
        canonical_deal = next(row for row in canonical_payload["deals"] if row["deal_id"] == enabled_id)
        audits = admin.table("audit_log").select("metadata").eq("entity_id", enabled_id).eq("action", "canonical_whitelisting_materialized").execute().data
        check("enabled set and API preserve exact fractional budgets and identity-order 10 before 2 with stable source sequence and one metadata-only audit", created["count"] == 3 and retry["outcome"] == "existing" and [row["arrangement_sequence"] for row in rows] == [1, 2, 3] and all(row["source_summary_id"] == enabled_source for row in rows) and any(row["source_budget_text"] == exact_fraction and row["canonical_budget_text"] == exact_fraction for row in exact_projection) and any(item["budget"] == {"amount": exact_fraction, "currency": "INR"} for item in canonical_deal["arrangements"]) and [row["source_budget_text"] for row in ordering_projection] == ["10", "2"] and [row["canonical_budget_text"] for row in ordering_projection] == ["10", "2"] and len(audits) == 1 and set(audits[0]["metadata"]) == {"source_summary_id", "enabled", "row_count"})
        false_rows = admin.table("whitelisting_arrangements").select("*").eq("deal_id", false_id).execute().data
        check("explicit false is one sequence-zero null-detail sentinel while v2 is a no-op", len(false_rows) == 1 and false_rows[0]["arrangement_sequence"] == 0 and not false_rows[0]["has_whitelisting"] and all(false_rows[0][key] is None for key in ("platform", "ad_account", "budget", "start_date", "end_date")) and legacy["outcome"] == "legacy_unmapped" and admin.table("whitelisting_arrangements").select("id").eq("deal_id", legacy_id).execute().data == [])

        shape_id, shape_source, _, _ = create_deal("Fictional Shape", canonical=False, transition=False)
        bad_shape = rejected(f"INSERT INTO whitelisting_arrangements (deal_id,has_whitelisting,source_summary_id,arrangement_sequence) VALUES ('{shape_id}',true,'{shape_source}',1);", "whitelisting_arrangements_canonical_shape")
        unicode_edge = rejected(
            "INSERT INTO whitelisting_arrangements (deal_id,has_whitelisting,platform,ad_account,budget,start_date,end_date,source_summary_id,arrangement_sequence) "
            f"VALUES ('{shape_id}',true,'instagram',U&'\\00A0Fictional Account',0,'2028-01-01','2028-01-02','{shape_source}',1);",
            "whitelisting_arrangements_canonical_shape",
        )
        legacy_allowed = not rejected(f"INSERT INTO whitelisting_arrangements (deal_id,has_whitelisting) VALUES ('{shape_id}',false);", "whitelisting_arrangements_canonical_shape")
        check("fresh malformed or Unicode-edge-padded canonical rows are rejected while source-null legacy rows remain allowed", bad_shape and unicode_edge and legacy_allowed)

        race_id, race_source, _, _ = create_deal("Fictional Race", canonical=False, transition=False)
        def race_call() -> str:
            return create_client(SUPABASE_URL, SERVICE_KEY).rpc("materialize_canonical_whitelisting", {"p_deal_id": race_id, "p_source_summary_id": race_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute().data["outcome"]
        with ThreadPoolExecutor(max_workers=2) as pool: outcomes = sorted(pool.map(lambda _: race_call(), range(2)))
        check("concurrent identical retries converge on one exact set and audit", outcomes == ["created", "existing"] and len(admin.table("audit_log").select("id").eq("entity_id", race_id).eq("action", "canonical_whitelisting_materialized").execute().data) == 1)

        try: admin.rpc("materialize_canonical_whitelisting", {"p_deal_id": enabled_id, "p_source_summary_id": str(uuid4()), "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute(); wrong_denied = False
        except Exception: wrong_denied = True
        mgmt_sql(f"UPDATE whitelisting_arrangements SET arrangement_sequence=9 WHERE deal_id='{enabled_id}' AND arrangement_sequence=1;")
        try: admin.rpc("materialize_canonical_whitelisting", {"p_deal_id": enabled_id, "p_source_summary_id": enabled_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute(); conflict_denied = False
        except Exception: conflict_denied = True
        check("wrong sources and corrupted existing sets fail without repair or extra audit", wrong_denied and conflict_denied and admin.table("whitelisting_arrangements").select("arrangement_sequence").eq("deal_id", enabled_id).eq("arrangement_sequence", 9).execute().data != [] and len(admin.table("audit_log").select("id").eq("entity_id", enabled_id).eq("action", "canonical_whitelisting_materialized").execute().data) == 1)

        participant = auth_client("creator")
        check("authenticated raw select, insert, update, and delete are denied", all(raw_denied(participant, operation, enabled_id) for operation in ("select", "insert", "update", "delete")))
        grants = mgmt_sql("SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='whitelisting_arrangements' AND grantee IN ('anon','authenticated','service_role') ORDER BY grantee, privilege_type;")
        routine_grants = mgmt_sql("SELECT routine_name, grantee, privilege_type FROM information_schema.role_routine_grants WHERE specific_schema='public' AND routine_name IN ('materialize_canonical_whitelisting','project_whitelisting_exact') AND grantee IN ('anon','authenticated','service_role') ORDER BY routine_name, grantee;")
        check("service role has select-only table and exact RPC access while authenticated callers cannot execute either RPC", grants == [{"grantee": "service_role", "privilege_type": "SELECT"}] and routine_grants == [{"routine_name": "materialize_canonical_whitelisting", "grantee": "service_role", "privilege_type": "EXECUTE"}, {"routine_name": "project_whitelisting_exact", "grantee": "service_role", "privilege_type": "EXECUTE"}] and raw_denied(admin, "insert", enabled_id) and raw_denied(admin, "update", enabled_id) and raw_denied(admin, "delete", enabled_id) and bool(admin.table("whitelisting_arrangements").select("id").eq("deal_id", enabled_id).execute().data) and _participant_rpc_denied(participant, enabled_id, enabled_source))

        before = len(admin.table("whitelisting_arrangements").select("id").eq("deal_id", fallback_id).execute().data)
        creator_response = api.get("/tracking/whitelisting", headers=bearer("creator")); body = creator_response.json()
        after = len(admin.table("whitelisting_arrangements").select("id").eq("deal_id", fallback_id).execute().data)
        by_id = {row["deal_id"]: row for row in body.get("deals", [])}
        check("creator receives enabled, not-enabled, legacy unavailable, fallback, and integrity-unavailable states", creator_response.status_code == 200 and by_id[false_id]["presence"] == "not_enabled" and by_id[legacy_id]["presence"] == "unavailable" and by_id[fallback_id]["presence"] == "enabled" and by_id[unavailable_id]["presence"] == "unavailable")
        check("historical v3 fallback is read-only and preserves the exact high-precision fractional decimal string", before == after == 0 and by_id[fallback_id]["arrangements"][0]["budget"] == {"amount": exact_fraction, "currency": "INR"})
        check("corrupted canonical rows are unavailable and never partially projected", by_id[enabled_id]["presence"] == "unavailable" and by_id[enabled_id]["arrangements"] == [])
        check("payload is bounded, minimal, ordered, and excludes credentials and provenance", all(set(row) == {"deal_id", "deal_name", "counterparty_name", "direction", "stage", "presence", "arrangements", "deal_path"} for row in body["deals"]) and all("source" not in str(row).lower() and "token" not in str(row).lower() for row in body["deals"]))

        role_payloads = [api.get("/tracking/whitelisting", headers=bearer(role)) for role in ("admin", "maker", "checker")]
        check("all active exact-brand roles receive the same participant-safe deal set", all(response.status_code == 200 and {row["deal_id"] for row in response.json()["deals"]} == {row["deal_id"] for row in role_payloads[0].json()["deals"]} for response in role_payloads))
        check("anonymous, outsider, and cross-brand callers expose no deal or account detail", api.get("/tracking/whitelisting").status_code in {401, 403} and api.get("/tracking/whitelisting", headers=bearer("outsider")).json().get("deals") == [] and api.get("/tracking/whitelisting", headers=bearer("cross_brand")).json().get("deals") == [])
        admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_ids[0]).eq("profile_id", ids["maker"]).execute()
        check("membership loss immediately removes every arrangement", api.get("/tracking/whitelisting", headers=bearer("maker")).json().get("deals") == [])
        check("UTC status uses inclusive endpoints", whitelisting_status("2028-02-29", "2028-02-29", "2028-02-28") == "upcoming" and whitelisting_status("2028-02-29", "2028-02-29", "2028-02-29") == "active" and whitelisting_status("2028-02-29", "2028-02-29", "2028-03-01") == "expired")
    finally:
        cleanup()
    failures = [label for label, passed in checks if not passed]
    print(f"\n{len(checks) - len(failures)}/{len(checks)} whitelisting tracker checks passed")
    if failures: raise AssertionError("; ".join(failures))


def _participant_rpc_denied(client: Client, deal_id: str, source_id: str) -> bool:
    try: client.rpc("materialize_canonical_whitelisting", {"p_deal_id": deal_id, "p_source_summary_id": source_id, "p_actor_id": ids["creator"], "p_ip_address": "127.0.0.1"}).execute()
    except Exception: pass
    else: return False
    try: client.rpc("project_whitelisting_exact", {"p_deal_id": deal_id, "p_source_summary_id": source_id}).execute()
    except Exception: return True
    return False


if __name__ == "__main__": main()
