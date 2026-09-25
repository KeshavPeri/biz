"""Workplan 11.3 calendar integration checks with fictional, cleaned fixtures.

Requires migration 051 on the development Supabase project.
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / ".env")

from test_contract_alignment_unit import payload as alignment_payload  # noqa: E402
from services.calendar_service import materialize_for_creating_entry as materialize_calendar_terms  # noqa: E402
from services.stage_engine import DealError  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

PASSWORD = "Calendar2028!Fictional"
EMAILS = {
    "creator": "calendar.creator@inflo.test",
    "brand": "calendar.brand@inflo.test",
    "cross_brand": "calendar.cross-brand@inflo.test",
    "outsider": "calendar.outsider@inflo.test",
}

admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_id: str | None = None
cross_brand_id: str | None = None
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
    client.auth.sign_in_with_password({"email": EMAILS[key], "password": PASSWORD})
    return client


def terms(*, historical: bool = False) -> dict[str, Any]:
    value = copy.deepcopy(alignment_payload())
    value["usage_rights"] = {"status": "found", "value": True, "evidence": value["usage_rights"]["evidence"]}
    value["usage_rights_duration"] = {
        "status": "found", "value": {"duration_days": 5, "is_perpetual": False},
        "evidence": value["payment_amount"]["evidence"],
    }
    value["usage_rights_channels"] = {
        "status": "found", "value": ["Paid social", "Website"],
        "evidence": value["payment_amount"]["evidence"],
    }
    value["blackout_window"] = {"status": "found", "value": True, "evidence": value["blackout_window"]["evidence"]}
    value["blackout_duration_timing"] = {
        "status": "found", "value": {"timing": "both", "duration_days": 2},
        "evidence": value["payment_amount"]["evidence"],
    }
    value["posting_window_per_deliverable"]["value"] = [
        {"deliverable_index": 1, "posting_date": "2028-02-29", "window_start": None, "window_end": None},
        {"deliverable_index": 2, "posting_date": None, "window_start": "2028-03-02", "window_end": "2028-03-03"},
    ]
    value["milestone_schedule"]["value"] = [
        {"trigger": "Fictional draft approval", "amount": {"amount": 20000, "currency": "INR"}, "due_date": "2028-02-28"},
        {"trigger": "Fictional live post", "amount": {"amount": 30000, "currency": "INR"}, "due_date": "2028-03-04"},
    ]
    if historical:
        value["usage_rights_channels"]["value"] = ["Historical fictional website"]
    return value


def create_deal(
    label: str,
    *,
    historical: bool = False,
    contract_version: int = 1,
    audit_mode: str = "valid",
) -> tuple[str, str, list[dict[str, Any]]]:
    assert brand_id
    deal_id = admin.table("deals").insert({
        "creator_id": ids["creator"], "brand_id": brand_id, "deal_name": label,
        "deal_type": "campaign", "stage": "approval", "direction": "inbound",
        "currency": "INR", "created_by": ids["brand"],
    }).execute().data[0]["id"]
    deal_ids.append(deal_id)
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["creator"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["brand"], "participant_role": "brand_maker"},
    ]).execute()
    source = admin.table("ai_summaries").insert({
        "deal_id": deal_id, "raw_output": {"source": "fictional calendar acceptance"},
        "structured_terms": terms(historical=historical), "status": "approved",
    }).execute().data[0]
    contract = admin.table("contracts").insert({
        "deal_id": deal_id, "version": contract_version, "storage_path": f"{deal_id}/executed-fictional-v{contract_version}.pdf",
        "generated_from_summary_id": source["id"], "status": "executed", "draft_source_sha256": "0" * 64,
    }).execute().data[0]
    if audit_mode != "missing":
        audit_contract_id = contract["id"] if audit_mode == "valid" else str(uuid4())
        admin.table("audit_log").insert({
            "actor_id": ids["brand"], "action": "contract_executed", "entity_type": "deal",
            "entity_id": deal_id, "metadata": {"contract_id": audit_contract_id, "version": contract_version},
            "ip_address": "127.0.0.1", "created_at": "2028-02-27T23:30:00Z",
        }).execute()
    items = [
        {"sequence": 1, "content_format": "reel", "platform": "instagram", "posting_date": "2028-02-29", "posting_window_start": None, "posting_window_end": None, "location": "Online", "revision_max": 0, "revision_current": 0, "status": "pending"},
        {"sequence": 2, "content_format": "story", "platform": "instagram", "posting_date": None, "posting_window_start": "2028-03-02", "posting_window_end": "2028-03-03", "location": "Online", "revision_max": 0, "revision_current": 0, "status": "pending"},
    ]
    admin.rpc("materialize_canonical_deliverables", {
        "p_deal_id": deal_id, "p_source_summary_id": source["id"], "p_actor_id": ids["brand"],
        "p_expected_count": 2, "p_items": items, "p_ip_address": "127.0.0.1",
    }).execute()
    deliverables = admin.table("deliverables").select("id,sequence").eq("deal_id", deal_id).order("sequence").execute().data
    return deal_id, source["id"], deliverables


def rpc_fails(client: Client, name: str, args: dict[str, Any]) -> bool:
    try:
        client.rpc(name, args).execute()
        return False
    except Exception:
        return True


def raw_table_read_denied(client: Client, table: str, deal_id: str) -> bool:
    try:
        client.table(table).select("*").eq("deal_id", deal_id).execute()
        return False
    except Exception:
        return True


def move_to_creating(deal_id: str, *, at: str = "2028-02-28T00:15:00Z") -> None:
    mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='creating' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
    admin.table("deal_stage_transitions").insert({
        "deal_id": deal_id, "from_stage": "approval", "to_stage": "creating",
        "transition_type": "auto", "triggered_by": ids["brand"], "created_at": at,
    }).execute()


def cleanup() -> None:
    print("\nCleaning up fictional campaign calendar data...")
    user_ids = list(ids.values())
    if user_ids:
        quoted = ",".join(f"'{value}'" for value in user_ids)
        mgmt_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
            "SET session_replication_role = origin;"
        )
    for deal_id in deal_ids:
        admin.table("deals").delete().eq("id", deal_id).execute()
    for fixture_brand_id in (brand_id, cross_brand_id):
        if fixture_brand_id:
            admin.table("brands").delete().eq("id", fixture_brand_id).execute()
    for user_id in user_ids:
        admin.auth.admin.delete_user(user_id)
    print("  cleanup complete")


def cleanup_leftovers() -> None:
    leftovers = [user for user in admin.auth.admin.list_users() if user.email in set(EMAILS.values())]
    if not leftovers:
        return
    old_ids = [user.id for user in leftovers]
    quoted = ",".join(f"'{value}'" for value in old_ids)
    rows = mgmt_sql(f"SELECT id, brand_id FROM deals WHERE creator_id IN ({quoted}) OR created_by IN ({quoted});")
    old_deals = [row["id"] for row in rows]
    old_brands = {row["brand_id"] for row in rows}
    old_brands.update(
        row["brand_id"]
        for row in admin.table("brand_members").select("brand_id").in_("profile_id", old_ids).execute().data
    )
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    for deal_id in old_deals:
        admin.table("deals").delete().eq("id", deal_id).execute()
    for old_brand in old_brands:
        admin.table("brands").delete().eq("id", old_brand).execute()
    for user in leftovers:
        admin.auth.admin.delete_user(user.id)


def main() -> None:
    global brand_id, cross_brand_id
    cleanup_leftovers()
    try:
        for key, email in EMAILS.items():
            account_type = "brand" if key in {"brand", "cross_brand"} else "creator"
            ids[key] = admin.auth.admin.create_user({"email": email, "password": PASSWORD, "email_confirm": True}).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": f"{key.title()} Fictional Calendar",
                "account_type": account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token
        brand_id = admin.table("brands").insert({"company_name": "Fictional Leap Day Studio", "industry": "Media"}).execute().data[0]["id"]
        admin.table("brand_members").insert({
            "brand_id": brand_id, "profile_id": ids["brand"], "brand_role": "admin", "status": "active",
        }).execute()
        cross_brand_id = admin.table("brands").insert({"company_name": "Fictional Cross Brand", "industry": "Media"}).execute().data[0]["id"]
        admin.table("brand_members").insert({
            "brand_id": cross_brand_id, "profile_id": ids["cross_brand"], "brand_role": "admin", "status": "active",
        }).execute()

        deal_id, source_id, deliverables = create_deal("Fictional Leap Campaign")
        created = admin.rpc("materialize_canonical_calendar_terms", {
            "p_deal_id": deal_id, "p_source_summary_id": source_id, "p_actor_id": ids["brand"], "p_ip_address": "127.0.0.1",
        }).execute().data
        repeated = admin.rpc("materialize_canonical_calendar_terms", {
            "p_deal_id": deal_id, "p_source_summary_id": source_id, "p_actor_id": ids["brand"], "p_ip_address": "127.0.0.1",
        }).execute().data
        rights = admin.table("usage_rights").select("*").eq("deal_id", deal_id).execute().data
        blackouts = admin.table("blackout_windows").select("*").eq("deal_id", deal_id).execute().data
        check("execution materializes exactly one source-bound rights row and one blackout row", created["outcome"] == "created" and len(rights) == len(blackouts) == 1 and rights[0]["source_summary_id"] == blackouts[0]["source_summary_id"] == source_id)
        check("materialization is idempotent and finite rights use inclusive UTC dates", repeated["outcome"] == "existing" and repeated["idempotent"] is True and rights[0]["start_date"] == "2028-02-27" and rights[0]["end_date"] == "2028-03-02")
        direct_write_blocked = rpc_fails(auth_client("creator"), "materialize_canonical_calendar_terms", {
            "p_deal_id": deal_id, "p_source_summary_id": source_id, "p_actor_id": ids["creator"], "p_ip_address": "127.0.0.1",
        })
        try:
            auth_client("creator").table("usage_rights").insert({"deal_id": deal_id, "has_usage_rights": False}).execute()
            table_write_blocked = False
        except Exception:
            table_write_blocked = True
        check("canonical rights writes remain service-only", direct_write_blocked and table_write_blocked)
        creator_client = auth_client("creator")
        outsider_client = auth_client("outsider")
        cross_brand_client = auth_client("cross_brand")
        check("raw canonical rights tables deny creator, outsider and cross-brand reads", all(
            raw_table_read_denied(client, table, deal_id)
            for client in (creator_client, outsider_client, cross_brand_client)
            for table in ("usage_rights", "blackout_windows")
        ))

        mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='creating' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
        auth_client("creator").rpc("set_private_deliverable_label", {"p_deliverable_id": deliverables[0]["id"], "p_label": "Scheduled"}).execute()
        mgmt_sql("SET session_replication_role = replica; " f"UPDATE deals SET stage='payment' WHERE id='{deal_id}'; " "SET session_replication_role = origin;")
        admin.rpc("initialize_payment_tracking", {"p_deal_id": deal_id, "p_actor_id": ids["brand"], "p_ip_address": "127.0.0.1"}).execute()
        submission_id = str(uuid4())
        mgmt_sql(
            "INSERT INTO live_post_submissions "
            "(id,deliverable_id,version,submitted_url,final_url,final_host,status,submitted_by,verified_at,confirmed_by,confirmed_at) VALUES "
            f"('{submission_id}','{deliverables[0]['id']}',1,'https://example.test/fictional','https://example.test/fictional','example.test','confirmed','{ids['creator']}','2028-03-01T09:00:00Z','{ids['brand']}','2028-03-01T10:00:00Z'); "
            f"UPDATE deliverables SET current_live_post_submission_id='{submission_id}', status='posted' WHERE id='{deliverables[0]['id']}';"
        )

        historical_deal, _, _ = create_deal("Fictional Historical Campaign", historical=True)
        move_to_creating(historical_deal)
        missing_audit_deal, _, _ = create_deal("Fictional Missing Audit Campaign", historical=True, audit_mode="missing")
        move_to_creating(missing_audit_deal)
        mismatched_audit_deal, _, _ = create_deal("Fictional Mismatched Audit Campaign", historical=True, audit_mode="mismatch")
        move_to_creating(mismatched_audit_deal)
        v2_deal, v2_source, _ = create_deal("Fictional V2 Contract Campaign", contract_version=2)
        try:
            materialize_calendar_terms(admin, v2_deal, ids["brand"], "127.0.0.1")
            python_v2_blocked = False
        except DealError:
            python_v2_blocked = True
        database_v2_blocked = rpc_fails(admin, "materialize_canonical_calendar_terms", {
            "p_deal_id": v2_deal, "p_source_summary_id": v2_source,
            "p_actor_id": ids["brand"], "p_ip_address": "127.0.0.1",
        })
        move_to_creating(v2_deal)

        args = {"p_viewer": ids["creator"], "p_as_of": "2028-03-01T12:00:00Z", "p_start": "2028-02-25", "p_end": "2028-03-10"}
        creator = admin.rpc("campaign_calendar_snapshot", args).execute().data
        brand = admin.rpc("campaign_calendar_snapshot", {**args, "p_viewer": ids["brand"]}).execute().data
        kinds = [row["kind"] for row in creator["events"]]
        check("calendar includes exact dates, inclusive windows, actual posts, payments and rights expiry", kinds.count("scheduled_post") == 4 and "actual_post" in kinds and kinds.count("payment_due") == 2 and kinds.count("rights_expiry") == 2)
        check("actual-post payload exposes no URL, preview or actor metadata", all(key not in json.dumps(creator) for key in ("submitted_url", "final_url", "preview_title", "confirmed_by")))
        creator_labels = [row["creator_label"] for row in creator["events"] if row["deal_id"] == deal_id]
        brand_labels = [row["creator_label"] for row in brand["events"]]
        check("creator-owned labels are visible only to that creator", "Scheduled" in creator_labels and all(value is None for value in brand_labels))
        shaded = {(row["start_date"], row["end_date"]) for row in creator["ranges"] if row["deal_id"] == deal_id}
        check("blackouts merge only adjacent non-posting UTC dates", shaded == {("2028-02-27", "2028-02-28"), ("2028-03-01", "2028-03-01"), ("2028-03-04", "2028-03-05")})
        historical_rights = [row for row in creator["events"] if row["deal_id"] == historical_deal and row["kind"] == "rights_expiry"]
        check("historical rights use the matching execution audit across UTC midnight without write-on-read", len(historical_rights) == 1 and historical_rights[0]["start_date"] == "2028-03-02" and not admin.table("usage_rights").select("id").eq("deal_id", historical_deal).execute().data)
        check("missing or mismatched execution audits fail historical fallback closed", not any(row["deal_id"] in {missing_audit_deal, mismatched_audit_deal} for row in creator["events"] + creator["ranges"]) and creator["unscheduled"]["integrity_issue_count"] >= 2)
        check("approved executed v2 contracts cannot materialize or emit trusted calendar facts", python_v2_blocked and database_v2_blocked and not any(row["deal_id"] == v2_deal for row in creator["events"] + creator["ranges"]))

        brand_client = auth_client("brand")
        wrapper_creator = creator_client.rpc("get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}).execute().data
        wrapper_brand = brand_client.rpc("get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}).execute().data
        check("authenticated creator and active same-brand participant use auth-derived identity", wrapper_creator["viewer_kind"] == "creator" and wrapper_brand["viewer_kind"] == "brand")
        outsider = outsider_client.rpc("get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}).execute().data
        check("outsider receives no deal data or private side channel", outsider["events"] == [] and outsider["ranges"] == [] and outsider["unscheduled"] == {"payment_due_count": 0, "integrity_issue_count": 0})
        anonymous = create_client(SUPABASE_URL, ANON_KEY)
        check("anonymous calendar access is denied", rpc_fails(anonymous, "get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}))
        admin.table("brand_members").update({"status": "invited"}).eq("brand_id", brand_id).eq("profile_id", ids["brand"]).execute()
        stale_brand = brand_client.rpc("get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}).execute().data
        check("inactive brand membership loses every calendar fact", stale_brand["events"] == [] and stale_brand["ranges"] == [])
        check("inactive brand membership cannot read raw canonical rights tables", all(
            raw_table_read_denied(brand_client, table, deal_id)
            for table in ("usage_rights", "blackout_windows")
        ))
        admin.table("brand_members").update({"status": "active"}).eq("brand_id", brand_id).eq("profile_id", ids["brand"]).execute()
        admin.table("deal_participants").delete().eq("deal_id", deal_id).eq("profile_id", ids["brand"]).execute()
        lost = brand_client.rpc("get_campaign_calendar", {"p_start": "2028-02-25", "p_end": "2028-03-10"}).execute().data
        check("current deal participation is required in addition to brand membership", all(row["deal_id"] != deal_id for row in lost["events"]))

        check("strict one-to-forty-two-day windows accept leap boundaries", admin.rpc("campaign_calendar_snapshot", {**args, "p_start": "2028-01-30", "p_end": "2028-03-11"}).execute().data["end_date"] == "2028-03-11")
        check("oversized and reversed windows fail closed", rpc_fails(admin, "campaign_calendar_snapshot", {**args, "p_start": "2028-01-29", "p_end": "2028-03-11"}) and rpc_fails(admin, "campaign_calendar_snapshot", {**args, "p_start": "2028-03-11", "p_end": "2028-03-10"}))
    finally:
        cleanup()

    failed = [label for label, passed in results if not passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} calendar checks passed")
    if failed:
        raise SystemExit("Failures: " + "; ".join(failed))


if __name__ == "__main__":
    main()
