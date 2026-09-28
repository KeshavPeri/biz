"""Development-Supabase acceptance checks for sponsored-disclosure tracking."""

from __future__ import annotations

import copy
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
from services.deliverable_service import materialize_for_creating_entry as materialize_deliverables  # noqa: E402
from services.disclosure_service import materialize_for_creating_entry as materialize_disclosures  # noqa: E402
from services.term_extraction import (  # noqa: E402
    CHAT_PROMPT_VERSION_V1, CHAT_PROMPT_VERSION_V2, CHAT_SCHEMA_VERSION_V1, CHAT_SCHEMA_VERSION_V2,
)
from test_contract_alignment_unit import payload, payload_v2  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
PASSWORD = "Disclosures2028!Fictional"
EMAILS = {
    "creator": "disclosures.creator@inflo.test", "admin": "disclosures.admin@inflo.test",
    "maker": "disclosures.maker@inflo.test", "checker": "disclosures.checker@inflo.test",
    "cross_brand": "disclosures.cross-brand@inflo.test", "outsider": "disclosures.outsider@inflo.test",
    "parser": "disclosures.parser@inflo.test",
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
api = TestClient(app)
ids: dict[str, str] = {}; tokens: dict[str, str] = {}; deal_ids: list[str] = []; brand_ids: list[str] = []
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition)); print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> Any:
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"}, json={"query": sql}, timeout=30,
    )
    response.raise_for_status(); return response.json()


def rejected(sql: str, marker: str) -> bool:
    try: mgmt_sql(sql); return False
    except httpx.HTTPStatusError as exc: return marker in exc.response.text


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": EMAILS[key], "password": PASSWORD})
    return client


def bearer(key: str) -> dict[str, str]: return {"Authorization": f"Bearer {tokens[key]}"}


def terms(*, required: bool = True, version: int = 2) -> dict[str, Any]:
    value = copy.deepcopy(payload_v2() if version == 2 else payload())
    if version == 2:
        evidence = value["sponsored_content_disclosure"]["evidence"]
        value["sponsored_content_disclosure"] = {
            "status": "found",
            "value": {
                "required": required,
                "platform_rules": ([
                    {"platform": "Instagram", "rule": "Use #FictionalPartner"},
                    {"platform": "Instagram", "rule": "Use the paid partnership label"},
                    {"platform": "TikTok", "rule": "Use #FictionalPartner"},
                ] if required else []),
            },
            "evidence": evidence,
        }
    return value


def create_deal(
    label: str,
    *,
    required: bool = True,
    version: int = 2,
    canonical: bool = True,
    transition: bool = True,
    disclosure_rules: list[dict[str, str]] | None = None,
    creator_key: str = "creator",
) -> tuple[str, str, str, dict[str, Any]]:
    deal_id = admin.table("deals").insert({
        "creator_id": ids[creator_key], "brand_id": brand_ids[0], "deal_name": label,
        "deal_type": "campaign", "stage": "approval", "direction": "inbound", "currency": "INR",
        "created_by": ids["admin"],
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids[creator_key], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["admin"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["maker"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["checker"], "participant_role": "brand_checker"},
    ]).execute()
    schema = CHAT_SCHEMA_VERSION_V2 if version == 2 else CHAT_SCHEMA_VERSION_V1
    prompt = CHAT_PROMPT_VERSION_V2 if version == 2 else CHAT_PROMPT_VERSION_V1
    structured_terms = terms(required=required, version=version)
    if disclosure_rules is not None:
        structured_terms["sponsored_content_disclosure"]["value"]["platform_rules"] = disclosure_rules
    source = admin.table("ai_summaries").insert({
        "deal_id": deal_id, "raw_output": {"source": "fictional disclosure acceptance"},
        "structured_terms": structured_terms, "status": "approved",
        "schema_version": schema, "prompt_version": prompt,
    }).execute().data[0]
    contract = admin.table("contracts").insert({
        "deal_id": deal_id, "version": 1, "status": "executed",
        "storage_path": f"{deal_id}/fictional-executed-v1.pdf",
        "generated_from_summary_id": source["id"], "draft_source_sha256": "0" * 64,
    }).execute().data[0]
    executed_at = datetime.now(timezone.utc)
    admin.table("audit_log").insert({
        "actor_id": ids["admin"], "action": "contract_executed", "entity_type": "deal",
        "entity_id": deal_id, "metadata": {"contract_id": contract["id"], "version": 1},
        "ip_address": "127.0.0.1", "created_at": executed_at.isoformat(),
    }).execute()
    materialize_deliverables(admin, deal_id, ids["admin"], "127.0.0.1")
    outcome = materialize_disclosures(admin, deal_id, ids["admin"], "127.0.0.1") if canonical else {}
    mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='creating' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
    if transition:
        admin.table("deal_stage_transitions").insert({
            "deal_id": deal_id, "from_stage": "approval", "to_stage": "creating",
            "transition_type": "auto", "triggered_by": ids["admin"],
            "created_at": (executed_at + timedelta(minutes=1)).isoformat(),
        }).execute()
    return deal_id, source["id"], contract["id"], outcome


def raw_denied(client: Client, operation: str, deal_id: str) -> bool:
    try:
        table = client.table("disclosure_requirements")
        if operation == "select": table.select("*").eq("deal_id", deal_id).execute()
        elif operation == "insert": table.insert({"deal_id": deal_id, "platform": "instagram", "required": False, "rule_note": ""}).execute()
        elif operation == "update": table.update({"rule_note": "tamper"}).eq("deal_id", deal_id).execute()
        else: table.delete().eq("deal_id", deal_id).execute()
        return False
    except Exception: return True


def cleanup() -> None:
    if ids:
        quoted = ",".join(f"'{value}'" for value in ids.values())
        mgmt_sql("SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;")
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
    old_brands = {row["brand_id"] for row in rows}
    old_brands.update(row["brand_id"] for row in admin.table("brand_members").select("brand_id").in_("profile_id", old_ids).execute().data)
    for brand_id in old_brands: admin.table("brands").delete().eq("id", brand_id).execute()
    for user in leftovers: admin.auth.admin.delete_user(user.id)


def main() -> None:
    cleanup_leftovers()
    try:
        for key, email in EMAILS.items():
            account_type = "brand" if key in {"admin", "maker", "checker", "cross_brand"} else "creator"
            ids[key] = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True}).user.id
            admin.table("profiles").insert({"id": ids[key], "email": email, "display_name": f"{key.title()} Fictional Disclosure", "account_type": account_type}).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Disclosure Labs", "industry": "Media"}).execute().data[0]["id"])
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Cross Brand", "industry": "Media"}).execute().data[0]["id"])
        admin.table("brand_members").insert([
            {"brand_id": brand_ids[0], "profile_id": ids["admin"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["maker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[1], "profile_id": ids["cross_brand"], "brand_role": "admin", "status": "active"},
        ]).execute()

        required_id, required_source, _, created = create_deal("Fictional Required")
        false_id, _, _, _ = create_deal("Fictional Not Required", required=False)
        fallback_id, _, _, _ = create_deal("Fictional Historical V2", canonical=False)
        v1_id, v1_source, _, legacy = create_deal("Fictional Legacy V1", version=1)
        unavailable_id, _, _, _ = create_deal("Fictional Missing Transition", canonical=False, transition=False)
        ordering_id, _, _, _ = create_deal(
            "Fictional Cross-Layer Ordering",
            creator_key="parser",
            disclosure_rules=[
                {"platform": "Instagram", "rule": "Beta rule"},
                {"platform": "Instagram", "rule": "alpha rule"},
                {"platform": "TikTok", "rule": "State fictional sponsorship"},
            ],
        )

        rows = admin.table("disclosure_requirements").select("*").eq("deal_id", required_id).order("platform").order("rule_sequence").execute().data
        retry = admin.rpc("materialize_canonical_disclosures", {"p_deal_id": required_id, "p_source_summary_id": required_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute().data
        audits = admin.table("audit_log").select("id").eq("entity_id", required_id).eq("action", "canonical_disclosures_materialized").execute().data
        check("required rules are platform-bound, sequenced, idempotent, and audited once", created["outcome"] == "created" and len(rows) == 3 and {(row["platform"], row["rule_note"]) for row in rows} == {("instagram", "Use #FictionalPartner"), ("instagram", "Use the paid partnership label"), ("tiktok", "Use #FictionalPartner")} and retry["outcome"] == "existing" and len(audits) == 1)
        false_rows = admin.table("disclosure_requirements").select("platform,required,rule_note,rule_sequence").eq("deal_id", false_id).order("platform").execute().data
        check("explicit false persists one sequence-zero row per exact deliverable platform", false_rows == [{"platform": "instagram", "required": False, "rule_note": "", "rule_sequence": 0}, {"platform": "tiktok", "required": False, "rule_note": "", "rule_sequence": 0}])
        check("v1 remains an explicit unmapped no-op", legacy["outcome"] == "legacy_unmapped" and admin.table("disclosure_requirements").select("id").eq("deal_id", v1_id).execute().data == [])
        wrong_source_denied = v1_rpc_denied = False
        try: admin.rpc("materialize_canonical_disclosures", {"p_deal_id": false_id, "p_source_summary_id": required_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute()
        except Exception: wrong_source_denied = True
        try: admin.rpc("materialize_canonical_disclosures", {"p_deal_id": v1_id, "p_source_summary_id": v1_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute()
        except Exception: v1_rpc_denied = True
        check("database materialization rejects cross-deal and v1 sources without writes", wrong_source_denied and v1_rpc_denied and admin.table("disclosure_requirements").select("id").eq("deal_id", v1_id).execute().data == [])

        shape_id, shape_source, _, _ = create_deal("Fictional Shape", canonical=False, transition=False)
        malformed = rejected("INSERT INTO disclosure_requirements (deal_id,platform,required,rule_note,source_summary_id,rule_sequence) " f"VALUES ('{shape_id}','instagram',true,'', '{shape_source}',1);", "disclosure_requirements_canonical_shape")
        mgmt_sql("INSERT INTO disclosure_requirements (deal_id,platform,required,rule_note) " f"VALUES ('{shape_id}','instagram',true,'Fictional legacy rule');")
        check("malformed canonical rows are rejected while source-null legacy rows remain", malformed and admin.table("disclosure_requirements").select("source_summary_id").eq("deal_id", shape_id).execute().data == [{"source_summary_id": None}])

        duplicate_id, duplicate_source, _, _ = create_deal("Fictional Duplicate", canonical=False, transition=False)
        mgmt_sql("INSERT INTO disclosure_requirements (deal_id,platform,required,rule_note,source_summary_id,rule_sequence) " f"VALUES ('{duplicate_id}','instagram',true,'Straße','{duplicate_source}',1);")
        normalized_duplicate = rejected("INSERT INTO disclosure_requirements (deal_id,platform,required,rule_note,source_summary_id,rule_sequence) " f"VALUES ('{duplicate_id}','instagram',true,'STRASSE','{duplicate_source}',2);", "disclosure_requirements_canonical_rule_unique")
        normalized = mgmt_sql("SELECT disclosure_normalize_contract_text('Straße') AS sharp_s, disclosure_normalize_contract_text('ＦＯＯ') AS compatibility, disclosure_normalize_contract_text('ﬀ rule') AS ligature;")[0]
        check("canonical normalization, uniqueness, and sequencing key use NFKC plus full casefold", normalized_duplicate and normalized == {"sharp_s": "strasse", "compatibility": "foo", "ligature": "ff rule"})

        direct_id, direct_source, _, _ = create_deal("Fictional Direct Unicode Duplicate", canonical=False, transition=False)
        untrusted = terms()
        untrusted["sponsored_content_disclosure"]["value"]["platform_rules"] = [
            {"platform": "Instagram", "rule": "Straße"},
            {"platform": "Instagram", "rule": "STRASSE"},
            {"platform": "Instagram", "rule": "ＦＯＯ"},
            {"platform": "Instagram", "rule": "foo"},
            {"platform": "TikTok", "rule": "State fictional sponsorship"},
        ]
        encoded = json.dumps(untrusted, ensure_ascii=False, separators=(",", ":")).replace("'", "''")
        mgmt_sql("SET session_replication_role = replica; " f"UPDATE ai_summaries SET structured_terms='{encoded}'::jsonb WHERE id='{direct_source}'; " "SET session_replication_role = origin;")
        try:
            admin.rpc("materialize_canonical_disclosures", {"p_deal_id": direct_id, "p_source_summary_id": direct_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute()
            unicode_direct_denied = False
        except Exception:
            unicode_direct_denied = True
        direct_rows = admin.table("disclosure_requirements").select("id").eq("deal_id", direct_id).execute().data
        direct_audits = admin.table("audit_log").select("id").eq("entity_id", direct_id).eq("action", "canonical_disclosures_materialized").execute().data
        check("direct RPC rejects NFKC/casefold-equivalent source duplicates without rows or audit", unicode_direct_denied and direct_rows == [] and direct_audits == [])

        race_id, race_source, _, _ = create_deal("Fictional Race", canonical=False, transition=False)
        def race() -> str:
            return create_client(SUPABASE_URL, SERVICE_KEY).rpc("materialize_canonical_disclosures", {"p_deal_id": race_id, "p_source_summary_id": race_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute().data["outcome"]
        with ThreadPoolExecutor(max_workers=2) as pool: outcomes = sorted(pool.map(lambda _: race(), range(2)))
        check("concurrent retries converge on one exact set and one audit", outcomes == ["created", "existing"] and len(admin.table("disclosure_requirements").select("id").eq("deal_id", race_id).execute().data) == 3 and len(admin.table("audit_log").select("id").eq("entity_id", race_id).eq("action", "canonical_disclosures_materialized").execute().data) == 1)

        participant = auth_client("creator")
        check("authenticated raw select, insert, update, and delete are denied", all(raw_denied(participant, op, required_id) for op in ("select", "insert", "update", "delete")))
        check("service role has read and function-only write authority", bool(admin.table("disclosure_requirements").select("id").eq("deal_id", required_id).execute().data) and all(raw_denied(admin, op, required_id) for op in ("insert", "update", "delete")))
        try: participant.rpc("materialize_canonical_disclosures", {"p_deal_id": required_id, "p_source_summary_id": required_source, "p_actor_id": ids["creator"], "p_ip_address": "127.0.0.1"}).execute(); participant_rpc_denied = False
        except Exception: participant_rpc_denied = True
        check("authenticated callers cannot invoke the materializer", participant_rpc_denied)
        privileges = mgmt_sql("SELECT has_table_privilege('anon','public.disclosure_requirements','SELECT') AS anon_select, has_table_privilege('authenticated','public.disclosure_requirements','SELECT') AS authenticated_select, has_table_privilege('authenticated','public.disclosure_requirements','TRUNCATE') AS authenticated_truncate, has_table_privilege('service_role','public.disclosure_requirements','SELECT') AS service_select, has_table_privilege('service_role','public.disclosure_requirements','INSERT') AS service_insert, has_function_privilege('anon','public.materialize_canonical_disclosures(uuid,uuid,uuid,text)','EXECUTE') AS anon_execute, has_function_privilege('authenticated','public.materialize_canonical_disclosures(uuid,uuid,uuid,text)','EXECUTE') AS authenticated_execute, has_function_privilege('service_role','public.materialize_canonical_disclosures(uuid,uuid,uuid,text)','EXECUTE') AS service_execute;")[0]
        check("raw table and function grants expose only service select plus narrow execution", privileges == {"anon_select": False, "authenticated_select": False, "authenticated_truncate": False, "service_select": True, "service_insert": False, "anon_execute": False, "authenticated_execute": False, "service_execute": True})

        before = len(admin.table("disclosure_requirements").select("id").eq("deal_id", fallback_id).execute().data)
        response = api.get("/tracking/disclosures", headers=bearer("creator")); body = response.json(); by_id = {row["deal_id"]: row for row in body.get("deals", [])}
        after = len(admin.table("disclosure_requirements").select("id").eq("deal_id", fallback_id).execute().data)
        check("tracker distinguishes required, not-required, v1, and invalid-history states", response.status_code == 200 and by_id[required_id]["presence"] == "required" and by_id[false_id]["presence"] == "not_required" and by_id[v1_id] == {**by_id[v1_id], "presence": "unavailable", "platforms": []} and by_id[unavailable_id]["presence"] == "unavailable")
        check("historical v2 fallback is read-only and matches canonical grouping", before == after == 0 and by_id[fallback_id]["presence"] == "required" and by_id[fallback_id]["platforms"] == by_id[required_id]["platforms"])
        check("payload is minimal, bounded, canonically ordered, and omits provenance/evidence", [row["deal_id"] for row in body["deals"]] == sorted(row["deal_id"] for row in body["deals"]) and all(set(row) == {"deal_id", "deal_name", "counterparty_name", "direction", "stage", "presence", "platforms", "deal_path"} for row in body["deals"]) and all(set(group) == {"platform", "rules"} for row in body["deals"] for group in row["platforms"]))
        ordering_response = api.get("/tracking/disclosures", headers=bearer("parser"))
        ordering_payload = ordering_response.json()
        ordering_rules = next(group["rules"] for group in ordering_payload["deals"][0]["platforms"] if group["platform"] == "instagram")
        parsed = subprocess.run([
            "node", "--no-warnings", "--experimental-strip-types", "--input-type=module", "-e",
            "import { parseDisclosureSnapshot } from './frontend/src/lib/disclosures-state.ts';"
            "let input=''; for await (const chunk of process.stdin) input += chunk;"
            "parseDisclosureSnapshot(JSON.parse(input));",
        ], input=json.dumps(ordering_payload), text=True, capture_output=True, cwd=BACKEND_DIR.parent, check=False)
        if parsed.returncode != 0:
            print(f"client parser stderr: {parsed.stderr.strip()}")
        check("real API emits normalized mixed-case rule order", ordering_response.status_code == 200 and [row["deal_id"] for row in ordering_payload["deals"]] == [ordering_id] and ordering_rules == ["alpha rule", "Beta rule"])
        check("real API result passes the strict client parser", parsed.returncode == 0)

        role_payloads = [api.get("/tracking/disclosures", headers=bearer(role)) for role in ("admin", "maker", "checker")]
        check("active same-brand roles receive the same participant-safe snapshot", all(item.status_code == 200 and item.json()["deals"] == role_payloads[0].json()["deals"] for item in role_payloads))
        check("anonymous, outsider, and cross-brand callers expose no deal detail", api.get("/tracking/disclosures").status_code in {401, 403} and api.get("/tracking/disclosures", headers=bearer("outsider")).json().get("deals") == [] and api.get("/tracking/disclosures", headers=bearer("cross_brand")).json().get("deals") == [])
        admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_ids[0]).eq("profile_id", ids["maker"]).execute()
        check("membership loss immediately removes every deal", api.get("/tracking/disclosures", headers=bearer("maker")).json().get("deals") == [])

        corrupt_id, _, _, _ = create_deal("Fictional Corrupt")
        mgmt_sql(f"DELETE FROM disclosure_requirements WHERE id=(SELECT id FROM disclosure_requirements WHERE deal_id='{corrupt_id}' ORDER BY id LIMIT 1);")
        corrupt = next(row for row in api.get("/tracking/disclosures", headers=bearer("creator")).json()["deals"] if row["deal_id"] == corrupt_id)
        check("partial canonical sets fail to generic unavailable without repair", corrupt["presence"] == "unavailable" and corrupt["platforms"] == [] and len(admin.table("disclosure_requirements").select("id").eq("deal_id", corrupt_id).execute().data) == 2)

        mixed_id, mixed_source, _, _ = create_deal("Fictional Mixed Source")
        alternate = admin.table("ai_summaries").insert({"deal_id": mixed_id, "raw_output": {"source": "fictional alternate"}, "structured_terms": terms(), "status": "approved", "schema_version": CHAT_SCHEMA_VERSION_V2, "prompt_version": CHAT_PROMPT_VERSION_V2}).execute().data[0]["id"]
        mgmt_sql(f"UPDATE disclosure_requirements SET source_summary_id='{alternate}' WHERE id=(SELECT id FROM disclosure_requirements WHERE deal_id='{mixed_id}' ORDER BY id LIMIT 1);")
        mixed = next(row for row in api.get("/tracking/disclosures", headers=bearer("creator")).json()["deals"] if row["deal_id"] == mixed_id)
        check("mixed-source canonical sets fail closed without overwrite", mixed["presence"] == "unavailable" and len({row["source_summary_id"] for row in admin.table("disclosure_requirements").select("source_summary_id").eq("deal_id", mixed_id).execute().data}) == 2 and mixed_source != alternate)

        parent_id, _, _, _ = create_deal("Fictional Parent Cleanup")
        deal_ids.remove(parent_id); admin.table("deals").delete().eq("id", parent_id).execute()
        check("parent deletion cascades canonical disclosure fixtures", admin.table("disclosure_requirements").select("id").eq("deal_id", parent_id).execute().data == [])
    finally:
        cleanup()
    failures = [label for label, passed in checks if not passed]
    print(f"\n{len(checks) - len(failures)}/{len(checks)} disclosure tracker checks passed")
    if failures: raise AssertionError("; ".join(failures))


if __name__ == "__main__": main()
