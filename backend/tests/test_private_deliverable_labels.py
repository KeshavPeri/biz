"""Development-Supabase acceptance checks for creator-private deliverable labels.

Uses run-unique fictional identities, real JWT/RLS/RPC boundaries, concurrent
authenticated clients, and safe cleanup. Migration 034 must be applied first.
"""

from __future__ import annotations

import os
import re
import sys
import time
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
from services.term_extraction import SCHEMA_VERSION, TermsExtraction  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
MANAGEMENT_CREDENTIAL = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Private-Labels-{RUN_ID}-Fictional!"
USERS = {
    "C1": (f"labels.creator.one.{RUN_ID}@inflo.test", "Fictional Label Creator One", "creator"),
    "C2": (f"labels.creator.two.{RUN_ID}@inflo.test", "Fictional Label Creator Two", "creator"),
    "A": (f"labels.brand.admin.{RUN_ID}@inflo.test", "Fictional Label Admin", "brand"),
    "M": (f"labels.brand.maker.{RUN_ID}@inflo.test", "Fictional Label Maker", "brand"),
    "K": (f"labels.brand.checker.{RUN_ID}@inflo.test", "Fictional Label Checker", "brand"),
    "O": (f"labels.outsider.{RUN_ID}@inflo.test", "Fictional Label Outsider", "creator"),
}
LOCKED_LABELS = ("Idea", "In Progress", "Filmed", "Approved", "Scheduled")
LOCK_NAMESPACE = 913
LOCK_SEED = int(RUN_ID[:7], 16) % 1_000_000_000

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
checks: list[tuple[str, bool]] = []
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
clients: dict[str, Client] = {}
deal_ids: list[str] = []
brand_id: str | None = None


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


def management_denied(sql: str) -> bool:
    try:
        management_sql(sql)
        return False
    except RuntimeError:
        return True


def wait_for_advisory_lock(lock_key: int) -> None:
    for _ in range(50):
        held = management_sql(
            "SELECT EXISTS ("
            "SELECT 1 FROM pg_locks "
            "WHERE locktype = 'advisory' AND granted "
            f"AND classid = {LOCK_NAMESPACE} AND objid = {lock_key}"
            ") AS held"
        )[0]["held"]
        if held:
            return
        time.sleep(0.05)
    raise RuntimeError(f"Delete transaction did not reach lifecycle lock {lock_key}")


def set_during_paused_delete(delete_sql: str, deliverable_id: str, lock_key: int) -> bool:
    # The advisory lock is acquired only after DELETE and its AFTER triggers have
    # completed. That makes the vulnerable interleaving deterministic: the RPC
    # begins while target deletion is uncommitted and cleanup has already run.
    transaction_sql = (
        "BEGIN; "
        f"{delete_sql}; "
        f"SELECT pg_advisory_xact_lock({LOCK_NAMESPACE}, {lock_key}); "
        "SELECT pg_sleep(3); "
        "COMMIT;"
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        deleting = pool.submit(management_sql, transaction_sql)
        wait_for_advisory_lock(lock_key)
        denied = rpc_denied("C1", deliverable_id, "Scheduled")
        deleting.result()
    return denied


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": USERS[actor][0], "password": PASSWORD})
    return client


def found(value: object) -> dict:
    return {
        "status": "found",
        "value": value,
        "evidence": [{"message_id": "fictional-message", "quote": "fictional agreed term"}],
    }


def not_discussed() -> dict:
    return {"status": "not_discussed", "value": None, "evidence": []}


def terms() -> dict:
    value = {
        "payment_amount": found({"amount": 42000, "currency": "INR"}),
        "payment_terms_type": found("on_posting"),
        "payment_terms_from_date": not_discussed(),
        "exclusivity": found(False),
        "exclusivity_duration_days": not_discussed(),
        "exclusivity_category": not_discussed(),
        "usage_rights": found(False),
        "usage_rights_duration": not_discussed(),
        "usage_rights_channels": not_discussed(),
        "whitelisting": found(False),
        "blackout_window": found(False),
        "blackout_duration_timing": not_discussed(),
        "revision_rounds_max": found(2),
        "creative_guidance": found({"kind": "creator_discretion", "text": "Fictional private-label shoot"}),
        "content_format_per_deliverable": found([{"deliverable_index": 1, "content_format": "Reel"}]),
        "platform_per_deliverable": found([{"deliverable_index": 1, "platform": "Instagram"}]),
        "posting_window_per_deliverable": found([{
            "deliverable_index": 1,
            "posting_date": "2026-10-15",
            "window_start": None,
            "window_end": None,
        }]),
        "sponsored_content_disclosure": found({"required": True, "platform_rules": ["Use #ad"]}),
        "content_ownership": found("creator"),
        "deliverable_count": found(1),
        "location_per_deliverable": found([{"deliverable_index": 1, "location": "Fictional studio"}]),
        "milestone_schedule": not_discussed(),
    }
    TermsExtraction.model_validate(value)
    return value


def make_deal(creator: str, label: str, participant_roles: list[tuple[str, str]]) -> str:
    deal_id = admin.table("deals").insert({
        "creator_id": ids[creator],
        "brand_id": brand_id,
        "deal_name": f"Fictional private labels {label} {RUN_ID}",
        "direction": "inbound",
        "created_by": ids["A"],
        "stage": "creating",
    }).execute().data[0]["id"]
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids[actor], "participant_role": role}
        for actor, role in participant_roles
    ]).execute()
    admin.table("ai_summaries").insert({
        "deal_id": deal_id,
        "raw_output": {"source": "fictional private-label fixture"},
        "structured_terms": terms(),
        "status": "approved",
        "schema_version": SCHEMA_VERSION,
    }).execute()
    deal_ids.append(deal_id)
    return deal_id


def call_deliverables(deal_id: str, actor: str):
    return api.get(
        f"/deals/{deal_id}/deliverables",
        headers={"Authorization": f"Bearer {tokens[actor]}"},
    )


def rpc(actor: str, deliverable_id: str, label: str | None):
    return clients[actor].rpc("set_private_deliverable_label", {
        "p_deliverable_id": deliverable_id,
        "p_label": label,
    }).execute().data


def rpc_denied(actor: str, deliverable_id: str, label: str | None) -> bool:
    try:
        rpc(actor, deliverable_id, label)
        return False
    except Exception:
        return True


def concurrent_set(deliverable_id: str, label: str):
    client = auth_client("C1")
    return client.rpc("set_private_deliverable_label", {
        "p_deliverable_id": deliverable_id,
        "p_label": label,
    }).execute().data


def row(deliverable_id: str) -> list[dict]:
    return admin.table("private_annotations").select("*").eq(
        "entity_type", "deliverable"
    ).eq("entity_id", deliverable_id).execute().data


def direct_mutations_denied(actor: str, deliverable_id: str, annotation_id: str) -> bool:
    client = clients[actor]
    insert_denied = False
    try:
        client.table("private_annotations").insert({
            "profile_id": ids[actor],
            "entity_type": "deliverable",
            "entity_id": deliverable_id,
            "label": "Idea",
        }).execute()
    except Exception:
        insert_denied = True

    update = client.table("private_annotations").update({"label": "Scheduled"}).eq(
        "id", annotation_id
    ).execute().data
    delete = client.table("private_annotations").delete().eq("id", annotation_id).execute().data
    return insert_denied and update == [] and delete == []


def cleanup() -> None:
    print("\nCleaning up fictional private-label data...")
    user_ids = list(ids.values())
    if user_ids:
        quoted = ",".join(f"'{user_id}'" for user_id in user_ids)
        management_sql(
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


def main() -> None:
    global brand_id
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user({
                "email": email,
                "password": PASSWORD,
                "email_confirm": True,
            }).user.id
            admin.table("profiles").insert({
                "id": ids[key],
                "email": email,
                "display_name": name,
                "account_type": account_type,
            }).execute()
            clients[key] = auth_client(key)
            tokens[key] = clients[key].auth.get_session().access_token

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Label Studio {RUN_ID}",
            "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["A"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
        ]).execute()

        primary_deal = make_deal("C1", "primary", [
            ("C1", "creator"),
            ("A", "brand_admin"),
            ("M", "brand_maker"),
            ("K", "brand_checker"),
        ])
        other_deal = make_deal("C2", "other creator", [
            ("C2", "creator"),
            ("A", "brand_admin"),
        ])
        primary_response = call_deliverables(primary_deal, "C1")
        other_response = call_deliverables(other_deal, "C2")
        primary_deliverable = primary_response.json()["deliverables"][0]["id"]
        other_deliverable = other_response.json()["deliverables"][0]["id"]
        check(
            "fictional canonical deliverables are available through the shared API",
            primary_response.status_code == 200 and other_response.status_code == 200,
        )

        canonical_before = admin.table("deliverables").select("*").eq(
            "id", primary_deliverable
        ).single().execute().data
        deal_before = admin.table("deals").select("stage,is_disputed").eq(
            "id", primary_deal
        ).single().execute().data
        audit_before = len(admin.table("audit_log").select("id").eq(
            "entity_id", primary_deal
        ).execute().data)
        notifications_before = len(admin.table("notifications").select("id").in_(
            "profile_id", list(ids.values())
        ).execute().data)

        accepted = all(rpc("C1", primary_deliverable, label) == label for label in LOCKED_LABELS)
        check("the named creator can set each of the five exact locked values", accepted)
        current = row(primary_deliverable)
        check(
            "set and change keep exactly one owner-target row",
            len(current) == 1
            and current[0]["profile_id"] == ids["C1"]
            and current[0]["label"] == "Scheduled",
        )
        annotation_id = current[0]["id"]
        check(
            "selecting the current value is idempotent and preserves row identity",
            rpc("C1", primary_deliverable, "Scheduled") == "Scheduled"
            and row(primary_deliverable)[0]["id"] == annotation_id,
        )

        invalid_values = ("idea", "", "Priority", "In progress", "Approved ")
        check(
            "values outside the exact locked set fail without changing the row",
            all(rpc_denied("C1", primary_deliverable, value) for value in invalid_values)
            and row(primary_deliverable)[0]["label"] == "Scheduled",
        )
        check(
            "clear and repeated clear are atomic and idempotent",
            rpc("C1", primary_deliverable, None) is None
            and row(primary_deliverable) == []
            and rpc("C1", primary_deliverable, None) is None
            and row(primary_deliverable) == [],
        )
        rpc("C1", primary_deliverable, "Scheduled")
        check(
            "missing and another creator's targets fail with no created row",
            rpc_denied("C1", str(uuid4()), "Idea")
            and rpc_denied("C1", other_deliverable, "Idea")
            and rpc_denied("C2", primary_deliverable, "Idea")
            and len(row(primary_deliverable)) == 1
            and row(other_deliverable) == [],
        )

        with ThreadPoolExecutor(max_workers=2) as pool:
            race = list(pool.map(
                lambda label: concurrent_set(primary_deliverable, label),
                ("Approved", "Filmed"),
            ))
        raced_rows = row(primary_deliverable)
        check(
            "concurrent authenticated changes converge on one locked row",
            set(race) == {"Approved", "Filmed"}
            and len(raced_rows) == 1
            and raced_rows[0]["label"] in {"Approved", "Filmed"},
        )
        annotation_id = raced_rows[0]["id"]

        private_readers = ("A", "M", "K", "C2", "O")
        check(
            "admin, maker, checker, another creator, and outsider cannot SELECT the label",
            all(clients[actor].table("private_annotations").select("id,label").eq(
                "id", annotation_id
            ).execute().data == [] for actor in private_readers),
        )
        check(
            "all non-owner authenticated roles cannot INSERT, UPDATE, or DELETE the label",
            all(direct_mutations_denied(actor, primary_deliverable, annotation_id) for actor in private_readers)
            and len(row(primary_deliverable)) == 1,
        )
        check(
            "all non-owner roles are denied atomic set and clear operations",
            all(
                rpc_denied(actor, primary_deliverable, label)
                for actor in private_readers
                for label in ("Idea", None)
            ),
        )

        anon = create_client(SUPABASE_URL, ANON_KEY)
        anon_rpc_denied = False
        try:
            anon.rpc("set_private_deliverable_label", {
                "p_deliverable_id": primary_deliverable,
                "p_label": "Idea",
            }).execute()
        except Exception:
            anon_rpc_denied = True
        check(
            "anonymous callers receive no row and cannot execute the mutation RPC",
            anon.table("private_annotations").select("id,label").eq(
                "id", annotation_id
            ).execute().data == []
            and anon_rpc_denied,
        )

        shared = [call_deliverables(primary_deal, actor) for actor in ("C1", "A", "M", "K")]
        shared_text = str([response.json() for response in shared]).lower()
        check(
            "shared creator and brand deliverable responses disclose no private-label field or value",
            all(response.status_code == 200 for response in shared)
            and "private_annotations" not in shared_text
            and "private_label" not in shared_text
            and "filmed" not in shared_text
            and "scheduled" not in shared_text,
        )
        canonical_after_labels = admin.table("deliverables").select("*").eq(
            "id", primary_deliverable
        ).single().execute().data
        deal_after_labels = admin.table("deals").select("stage,is_disputed").eq(
            "id", primary_deal
        ).single().execute().data
        audit_after_labels = len(admin.table("audit_log").select("id").eq(
            "entity_id", primary_deal
        ).execute().data)
        notifications_after_labels = len(admin.table("notifications").select("id").in_(
            "profile_id", list(ids.values())
        ).execute().data)
        check(
            "label changes do not mutate lifecycle, audit, stage, or notifications",
            canonical_after_labels == canonical_before
            and deal_after_labels == deal_before
            and audit_after_labels == audit_before
            and notifications_after_labels == notifications_before,
        )

        direct_race_deal = make_deal("C1", "direct delete race", [
            ("C1", "creator"),
            ("A", "brand_admin"),
        ])
        direct_race_response = call_deliverables(direct_race_deal, "C1")
        direct_race_deliverable = direct_race_response.json()["deliverables"][0]["id"]
        rpc("C1", direct_race_deliverable, "Idea")
        direct_race_denied = set_during_paused_delete(
            f"DELETE FROM public.deliverables WHERE id = '{direct_race_deliverable}'",
            direct_race_deliverable,
            LOCK_SEED + 1,
        )
        check(
            "concurrent set versus completed direct-delete triggers cannot leave an orphan",
            direct_race_denied
            and admin.table("deliverables").select("id").eq(
                "id", direct_race_deliverable
            ).execute().data == []
            and row(direct_race_deliverable) == [],
        )

        cascade_race_deal = make_deal("C1", "parent cascade race", [
            ("C1", "creator"),
            ("A", "brand_admin"),
        ])
        cascade_race_response = call_deliverables(cascade_race_deal, "C1")
        cascade_race_deliverable = cascade_race_response.json()["deliverables"][0]["id"]
        rpc("C1", cascade_race_deliverable, "Idea")
        cascade_race_denied = set_during_paused_delete(
            f"DELETE FROM public.deals WHERE id = '{cascade_race_deal}'",
            cascade_race_deliverable,
            LOCK_SEED + 2,
        )
        check(
            "concurrent set versus completed parent-cascade triggers cannot leave an orphan",
            cascade_race_denied
            and admin.table("deals").select("id").eq(
                "id", cascade_race_deal
            ).execute().data == []
            and admin.table("deliverables").select("id").eq(
                "id", cascade_race_deliverable
            ).execute().data == []
            and row(cascade_race_deliverable) == [],
        )

        check(
            "deliverable identity pivots remain blocked even for privileged direct SQL",
            management_denied(
                f"UPDATE public.private_annotations SET profile_id = '{ids['C2']}' WHERE id = '{annotation_id}'"
            )
            and management_denied(
                f"UPDATE public.private_annotations SET entity_id = '{other_deliverable}' WHERE id = '{annotation_id}'"
            )
            and management_denied(
                f"UPDATE public.private_annotations SET entity_type = 'deal' WHERE id = '{annotation_id}'"
            )
            and row(primary_deliverable)[0]["profile_id"] == ids["C1"],
        )

        deal_annotation = clients["C1"].table("private_annotations").insert({
            "profile_id": ids["C1"],
            "entity_type": "deal",
            "entity_id": primary_deal,
            "label": "Priority campaign",
        }).execute().data[0]
        updated_deal_annotation = clients["C1"].table("private_annotations").update({
            "label": "Freeform campaign note",
        }).eq("id", deal_annotation["id"]).execute().data
        check(
            "deal-level freeform annotation insert and update remain compatible",
            len(updated_deal_annotation) == 1
            and updated_deal_annotation[0]["label"] == "Freeform campaign note",
        )

        management_sql(f"DELETE FROM public.deliverables WHERE id = '{primary_deliverable}'")
        check(
            "direct target deletion removes only its deliverable label",
            row(primary_deliverable) == []
            and len(admin.table("private_annotations").select("id").eq(
                "id", deal_annotation["id"]
            ).execute().data) == 1,
        )

        rpc("C2", other_deliverable, "Idea")
        other_deal_annotation = clients["C2"].table("private_annotations").insert({
            "profile_id": ids["C2"],
            "entity_type": "deal",
            "entity_id": other_deal,
            "label": "Keep after cascade",
        }).execute().data[0]
        admin.table("deals").delete().eq("id", other_deal).execute()
        check(
            "parent-deal cascade removes the target label without touching deal annotations",
            row(other_deliverable) == []
            and len(admin.table("private_annotations").select("id").eq(
                "id", other_deal_annotation["id"]
            ).execute().data) == 1,
        )

        clients["C1"].table("private_annotations").delete().eq("id", deal_annotation["id"]).execute()
        clients["C2"].table("private_annotations").delete().eq("id", other_deal_annotation["id"]).execute()
        check(
            "deal-level freeform annotation delete remains compatible",
            admin.table("private_annotations").select("id").in_(
                "id", [deal_annotation["id"], other_deal_annotation["id"]]
            ).execute().data == [],
        )

    finally:
        cleanup()

    failures = [label for label, ok in checks if not ok]
    print(f"\n{len(checks) - len(failures)}/{len(checks)} private-deliverable-label checks passed")
    if failures:
        raise SystemExit("Failed: " + "; ".join(failures))


if __name__ == "__main__":
    main()
