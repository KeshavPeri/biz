"""Development-Supabase acceptance checks for canonical exclusivity tracking.

Requires migration 052 on the approved development project. All fixtures are
fictional and are removed even when a check fails.
"""

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
from services.exclusivity_service import exclusivity_status  # noqa: E402
from test_contract_alignment_unit import payload as alignment_payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
PASSWORD = "Exclusivity2028!Fictional"
EMAILS = {
    "creator": "exclusivity.creator@inflo.test",
    "admin": "exclusivity.admin@inflo.test",
    "maker": "exclusivity.maker@inflo.test",
    "checker": "exclusivity.checker@inflo.test",
    "cross_brand": "exclusivity.cross-brand@inflo.test",
    "outsider": "exclusivity.outsider@inflo.test",
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
api = TestClient(app)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_ids: list[str] = []
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> Any:
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"}, json={"query": sql}, timeout=30,
    )
    response.raise_for_status()
    return response.json()


def mgmt_sql_rejected(sql: str, marker: str) -> bool:
    try:
        mgmt_sql(sql)
        return False
    except httpx.HTTPStatusError as exc:
        return marker in exc.response.text


def auth_client(key: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": EMAILS[key], "password": PASSWORD})
    return client


def terms(has_exclusivity: bool, duration: int | None = None, category: str | None = None) -> dict[str, Any]:
    value = copy.deepcopy(alignment_payload())
    evidence = value["exclusivity"]["evidence"]
    value["exclusivity"] = {"status": "found", "value": has_exclusivity, "evidence": evidence}
    if has_exclusivity:
        value["exclusivity_duration_days"] = {"status": "found", "value": duration, "evidence": evidence}
        value["exclusivity_category"] = {"status": "found", "value": category, "evidence": evidence}
    return value


def create_deal(
    label: str, *, has_exclusivity: bool = True, duration: int = 30, category: str = "Fictional skincare",
    executed_at: datetime | None = None, canonical: bool = True, transition: bool = True,
) -> tuple[str, str, str]:
    executed_at = executed_at or datetime.now(timezone.utc)
    brand_id = brand_ids[0]
    deal_id = admin.table("deals").insert({
        "creator_id": ids["creator"], "brand_id": brand_id, "deal_name": label,
        "deal_type": "campaign", "stage": "approval", "direction": "inbound", "currency": "INR",
        "created_by": ids["admin"],
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["creator"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["admin"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["maker"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["checker"], "participant_role": "brand_checker"},
    ]).execute()
    source = admin.table("ai_summaries").insert({
        "deal_id": deal_id, "raw_output": {"source": "fictional exclusivity acceptance"},
        "structured_terms": terms(has_exclusivity, duration, category), "status": "approved",
    }).execute().data[0]
    contract = admin.table("contracts").insert({
        "deal_id": deal_id, "version": 1, "status": "executed",
        "storage_path": f"{deal_id}/fictional-executed-v1.pdf",
        "generated_from_summary_id": source["id"], "draft_source_sha256": "0" * 64,
    }).execute().data[0]
    admin.table("audit_log").insert({
        "actor_id": ids["admin"], "action": "contract_executed", "entity_type": "deal",
        "entity_id": deal_id, "metadata": {"contract_id": contract["id"], "version": 1},
        "ip_address": "127.0.0.1", "created_at": executed_at.isoformat(),
    }).execute()
    if canonical:
        admin.rpc("materialize_canonical_exclusivity", {
            "p_deal_id": deal_id, "p_source_summary_id": source["id"],
            "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1",
        }).execute()
    mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='creating' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
    if transition:
        admin.table("deal_stage_transitions").insert({
            "deal_id": deal_id, "from_stage": "approval", "to_stage": "creating",
            "transition_type": "auto", "triggered_by": ids["admin"],
            "created_at": (executed_at + timedelta(minutes=1)).isoformat(),
        }).execute()
    return deal_id, source["id"], contract["id"]


def bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens[key]}"}


def raw_denied(client: Client, operation: str, deal_id: str) -> bool:
    try:
        table = client.table("exclusivity_clauses")
        if operation == "select": table.select("*").eq("deal_id", deal_id).execute()
        elif operation == "insert": table.insert({"deal_id": deal_id, "has_exclusivity": False}).execute()
        elif operation == "update": table.update({"category": "tamper"}).eq("deal_id", deal_id).execute()
        else: table.delete().eq("deal_id", deal_id).execute()
        return False
    except Exception:
        return True


def cleanup() -> None:
    if ids:
        quoted = ",".join(f"'{value}'" for value in ids.values())
        mgmt_sql("SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;")
    for deal_id in deal_ids:
        admin.table("deals").delete().eq("id", deal_id).execute()
    for brand_id in brand_ids:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user_id in ids.values():
        admin.auth.admin.delete_user(user_id)


def cleanup_leftovers() -> None:
    leftovers = [user for user in admin.auth.admin.list_users() if user.email in set(EMAILS.values())]
    if not leftovers:
        return
    old_ids = [user.id for user in leftovers]
    quoted = ",".join(f"'{value}'" for value in old_ids)
    rows = mgmt_sql(f"SELECT id, brand_id FROM deals WHERE creator_id IN ({quoted}) OR created_by IN ({quoted});")
    mgmt_sql("SET session_replication_role = replica; " f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); " "SET session_replication_role = origin;")
    for row in rows:
        admin.table("deals").delete().eq("id", row["id"]).execute()
    old_brands = {row["brand_id"] for row in rows}
    old_brands.update(row["brand_id"] for row in admin.table("brand_members").select("brand_id").in_("profile_id", old_ids).execute().data)
    for brand_id in old_brands:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user in leftovers:
        admin.auth.admin.delete_user(user.id)


def main() -> None:
    cleanup_leftovers()
    try:
        for key, email in EMAILS.items():
            account_type = "brand" if key in {"admin", "maker", "checker", "cross_brand"} else "creator"
            ids[key] = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True}).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": f"{key.title()} Fictional Exclusivity",
                "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Boundary Labs", "industry": "Media"}).execute().data[0]["id"])
        brand_ids.append(admin.table("brands").insert({"company_name": "Fictional Cross Brand", "industry": "Media"}).execute().data[0]["id"])
        admin.table("brand_members").insert([
            {"brand_id": brand_ids[0], "profile_id": ids["admin"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["maker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[0], "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_ids[1], "profile_id": ids["cross_brand"], "brand_role": "admin", "status": "active"},
        ]).execute()

        now = datetime.now(timezone.utc)
        active_id, active_source, _ = create_deal("Fictional Active", duration=30, executed_at=now)
        expiring_id, _, _ = create_deal("Fictional Expiring", duration=10, executed_at=now - timedelta(days=2))
        expired_id, _, _ = create_deal("Fictional Expired", duration=3, executed_at=now - timedelta(days=5))
        false_id, _, _ = create_deal("Fictional Explicit False", has_exclusivity=False, executed_at=now)
        fallback_id, _, _ = create_deal("Fictional Historical", duration=20, executed_at=now - timedelta(days=1), canonical=False)
        unavailable_id, _, _ = create_deal("Fictional Missing Transition", duration=20, executed_at=now, canonical=False, transition=False)

        canonical = admin.table("exclusivity_clauses").select("*").eq("deal_id", active_id).execute().data
        retry = admin.rpc("materialize_canonical_exclusivity", {
            "p_deal_id": active_id, "p_source_summary_id": active_source,
            "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1",
        }).execute().data
        audits = admin.table("audit_log").select("id").eq("entity_id", active_id).eq("action", "canonical_exclusivity_materialized").execute().data
        check("canonical materialization is source-bound, inclusive, idempotent, and audited once", len(canonical) == 1 and canonical[0]["source_summary_id"] == active_source and canonical[0]["start_date"] == now.date().isoformat() and canonical[0]["end_date"] == (now.date() + timedelta(days=29)).isoformat() and retry["outcome"] == "existing" and len(audits) == 1)
        false_rows = admin.table("exclusivity_clauses").select("*").eq("deal_id", false_id).execute().data
        check("explicit false is persisted with no category, duration, or dates", len(false_rows) == 1 and false_rows[0]["has_exclusivity"] is False and all(false_rows[0][key] is None for key in ("category", "duration_days", "start_date", "end_date")))

        shape_id, shape_source, _ = create_deal("Fictional Canonical Shape", canonical=False, transition=False)
        shape_date = now.date().isoformat()
        missing_duration_rejected = mgmt_sql_rejected(
            "INSERT INTO exclusivity_clauses "
            "(deal_id,has_exclusivity,category,duration_days,start_date,end_date,source_summary_id) "
            f"VALUES ('{shape_id}',true,'Fictional shape',NULL,'{shape_date}','{shape_date}','{shape_source}');",
            "exclusivity_clauses_canonical_shape",
        )
        missing_end_rejected = mgmt_sql_rejected(
            "INSERT INTO exclusivity_clauses "
            "(deal_id,has_exclusivity,category,duration_days,start_date,end_date,source_summary_id) "
            f"VALUES ('{shape_id}',true,'Fictional shape',1,'{shape_date}',NULL,'{shape_source}');",
            "exclusivity_clauses_canonical_shape",
        )
        mgmt_sql(
            "INSERT INTO exclusivity_clauses "
            "(deal_id,has_exclusivity,category,duration_days,start_date,end_date,source_summary_id) "
            f"VALUES ('{shape_id}',true,'Fictional legacy evidence',NULL,NULL,NULL,NULL);"
        )
        legacy_rows = admin.table("exclusivity_clauses").select("source_summary_id,duration_days,end_date").eq("deal_id", shape_id).execute().data
        check(
            "canonical true rows require duration and end date while source-null legacy rows remain permitted",
            missing_duration_rejected and missing_end_rejected and legacy_rows == [{"source_summary_id": None, "duration_days": None, "end_date": None}],
        )

        race_id, race_source, _ = create_deal("Fictional Race", duration=21, executed_at=now, canonical=False, transition=False)
        def race_call() -> str:
            client = create_client(SUPABASE_URL, SERVICE_KEY)
            return client.rpc("materialize_canonical_exclusivity", {"p_deal_id": race_id, "p_source_summary_id": race_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute().data["outcome"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = sorted(pool.map(lambda _: race_call(), range(2)))
        check("concurrent retries converge on one row and one audit", outcomes == ["created", "existing"] and len(admin.table("exclusivity_clauses").select("id").eq("deal_id", race_id).execute().data) == 1 and len(admin.table("audit_log").select("id").eq("entity_id", race_id).eq("action", "canonical_exclusivity_materialized").execute().data) == 1)

        wrong_source = str(uuid4())
        try:
            admin.rpc("materialize_canonical_exclusivity", {"p_deal_id": active_id, "p_source_summary_id": wrong_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute()
            wrong_source_denied = False
        except Exception:
            wrong_source_denied = True
        mgmt_sql(f"UPDATE exclusivity_clauses SET category='Fictional conflicting evidence' WHERE deal_id='{active_id}' AND source_summary_id IS NOT NULL;")
        try:
            admin.rpc("materialize_canonical_exclusivity", {"p_deal_id": active_id, "p_source_summary_id": active_source, "p_actor_id": ids["admin"], "p_ip_address": "127.0.0.1"}).execute()
            conflict_denied = False
        except Exception:
            conflict_denied = True
        conflicted = admin.table("exclusivity_clauses").select("category").eq("deal_id", active_id).execute().data[0]["category"]
        check("wrong sources and conflicting canonical evidence fail closed without overwrite", wrong_source_denied and conflict_denied and conflicted == "Fictional conflicting evidence")

        participant = auth_client("creator")
        check("authenticated raw select, insert, update, and delete are denied", all(raw_denied(participant, operation, active_id) for operation in ("select", "insert", "update", "delete")))
        check("ordinary service-role raw writes are denied while reads remain available", raw_denied(admin, "insert", active_id) and raw_denied(admin, "update", active_id) and raw_denied(admin, "delete", active_id) and bool(admin.table("exclusivity_clauses").select("id").eq("deal_id", active_id).execute().data))
        try:
            participant.rpc("materialize_canonical_exclusivity", {"p_deal_id": active_id, "p_source_summary_id": active_source, "p_actor_id": ids["creator"], "p_ip_address": "127.0.0.1"}).execute()
            participant_rpc_denied = False
        except Exception:
            participant_rpc_denied = True
        check("materialization RPC is not callable with an authenticated client", participant_rpc_denied)

        before_fallback = len(admin.table("exclusivity_clauses").select("id").eq("deal_id", fallback_id).execute().data)
        creator_response = api.get("/tracking/exclusivity", headers=bearer("creator"))
        creator_body = creator_response.json()
        after_fallback = len(admin.table("exclusivity_clauses").select("id").eq("deal_id", fallback_id).execute().data)
        visible_ids = {row["deal_id"] for row in creator_body.get("clauses", [])}
        check("creator receives canonical and strict historical rows but explicit false stays hidden", creator_response.status_code == 200 and {expiring_id, expired_id, fallback_id}.issubset(visible_ids) and false_id not in visible_ids)
        check("historical fallback is read-only and missing transition is integrity-unavailable", before_fallback == after_fallback == 0 and creator_body.get("integrity_unavailable_count", 0) >= 2 and unavailable_id not in visible_ids)
        check("payload is bounded, minimal, deterministic, and contains no provenance identifiers", [row["status"] for row in creator_body["clauses"]] == sorted([row["status"] for row in creator_body["clauses"]], key={"expiring": 0, "active": 1, "expired": 2}.get) and all(set(row) == {"deal_id", "deal_name", "brand_name", "creator_name", "category", "start_date", "end_date", "status", "deal_path"} for row in creator_body["clauses"]))

        role_payloads = [api.get("/tracking/exclusivity", headers=bearer(role)) for role in ("admin", "maker", "checker")]
        check("all active brand roles receive the same safe clauses", all(response.status_code == 200 and response.json()["clauses"] == role_payloads[0].json()["clauses"] for response in role_payloads))
        check("anonymous, outsider, and cross-brand callers expose no deal or clause detail", api.get("/tracking/exclusivity").status_code in {401, 403} and api.get("/tracking/exclusivity", headers=bearer("outsider")).json().get("clauses") == [] and api.get("/tracking/exclusivity", headers=bearer("cross_brand")).json().get("clauses") == [])

        admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_ids[0]).eq("profile_id", ids["maker"]).execute()
        lost = api.get("/tracking/exclusivity", headers=bearer("maker")).json()
        check("lost same-brand membership immediately removes every clause", lost.get("clauses") == [] and lost.get("integrity_unavailable_count") == 0)
        mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='closed' WHERE id='{expired_id}'; " "SET session_replication_role = origin;")
        closed = api.get("/tracking/exclusivity", headers=bearer("creator")).json()
        check("expired exclusivity remains visible after Closed", any(row["deal_id"] == expired_id and row["status"] == "expired" for row in closed["clauses"]))

        check("UTC status boundaries include first expiring date and expiry date", exclusivity_status("2028-03-15", "2028-02-29") == "active" and exclusivity_status("2028-03-14", "2028-02-29") == "expiring" and exclusivity_status("2028-02-29", "2028-02-29") == "expiring" and exclusivity_status("2028-02-28", "2028-02-29") == "expired")
    finally:
        cleanup()
    failures = [label for label, passed in checks if not passed]
    print(f"\n{len(checks) - len(failures)}/{len(checks)} exclusivity tracker checks passed")
    if failures:
        raise AssertionError("; ".join(failures))


if __name__ == "__main__":
    main()
