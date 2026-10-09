"""Fictional development-Supabase acceptance checks for B3-005."""

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

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f"Deal-name-{RUN_ID}-Fictional!"
USERS = {
    "C": (f"deal.name.creator.{RUN_ID}@inflo.test", "Fictional Creator", "creator"),
    "B": (f"deal.name.admin.{RUN_ID}@inflo.test", "Fictional Brand Admin", "brand"),
    "M": (f"deal.name.maker.{RUN_ID}@inflo.test", "Fictional Brand Maker", "brand"),
    "K": (f"deal.name.checker.{RUN_ID}@inflo.test", "Fictional Brand Checker", "brand"),
    "X": (f"deal.name.outsider.{RUN_ID}@inflo.test", "Fictional Outsider", "creator"),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": sql},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def apply_migration(*, fail_between: bool = False) -> None:
    historical = (BACKEND_DIR / "migrations/045_deal_name_rename.sql").read_text()
    current = (BACKEND_DIR / "migrations/060_deal_name_notification.sql").read_text()
    fault = (
        "DO $$ BEGIN RAISE EXCEPTION 'FICTIONAL_FORCED_MIGRATION_FAILURE'; END $$;"
        if fail_between else ""
    )
    # One management call and one explicit transaction: a failed current
    # migration cannot leave the historical 045 function installed.
    management_sql(f"BEGIN;\n{historical}\n{fault}\n{current}\nCOMMIT;")


def notices(deal_id: str) -> list[dict]:
    return admin.table("notifications").select(
        "id,profile_id,tier,title,body,deal_id,read,created_at"
    ).eq("deal_id", deal_id).execute().data


def denied(operation) -> bool:
    try:
        operation()
    except Exception as exc:
        return "permission denied" in str(exc).lower() or "42501" in str(exc)
    return False


def token_for(email: str) -> str:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY).auth.sign_in_with_password(
        {"email": email, "password": PASSWORD}
    ).session.access_token


def auth_client(email: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.auth.sign_in_with_password({"email": email, "password": PASSWORD})
    return client


def call(deal_id: str, token: str, deal_name: str, expected_version: int):
    return api.put(
        f"/deals/{deal_id}/name",
        json={"deal_name": deal_name, "expected_version": expected_version},
        headers={"Authorization": f"Bearer {token}"},
    )


def cleanup() -> None:
    management_sql(
        "DROP TRIGGER IF EXISTS test_fail_deal_name_audit ON audit_log; "
        "DROP FUNCTION IF EXISTS test_fail_deal_name_audit(); "
        "DROP TRIGGER IF EXISTS test_fail_deal_name_notice ON notifications; "
        "DROP FUNCTION IF EXISTS test_fail_deal_name_notice();"
    )
    users = [u for u in admin.auth.admin.list_users() if u.email in {row[0] for row in USERS.values()}]
    ids = [u.id for u in users]
    if not ids:
        return
    quoted = ",".join(f"'{value}'" for value in ids)
    admin.table("notifications").delete().in_("profile_id", ids).execute()
    management_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    deals = admin.table("deals").select("id").in_("created_by", ids).execute().data
    for deal in deals:
        admin.table("deals").delete().eq("id", deal["id"]).execute()
    memberships = admin.table("brand_members").select("brand_id").in_("profile_id", ids).execute().data
    for brand_id in {row["brand_id"] for row in memberships}:
        admin.table("brands").delete().eq("id", brand_id).execute()
    for user in users:
        admin.auth.admin.delete_user(user.id)


def create_deal(ids: dict[str, str], brand_id: str, stage: str, label: str) -> str:
    deal_id = admin.table("deals").insert({
        "creator_id": ids["C"],
        "brand_id": brand_id,
        "deal_name": f"Fictional {label} {RUN_ID}",
        "direction": "inbound",
        "created_by": ids["B"],
        "stage": stage,
    }).execute().data[0]["id"]
    admin.table("deal_participants").insert([
        {"deal_id": deal_id, "profile_id": ids["C"], "participant_role": "creator"},
        {"deal_id": deal_id, "profile_id": ids["B"], "participant_role": "brand_admin"},
        {"deal_id": deal_id, "profile_id": ids["M"], "participant_role": "brand_maker"},
        {"deal_id": deal_id, "profile_id": ids["K"], "participant_role": "brand_checker"},
    ]).execute()
    return deal_id


def main() -> None:
    cleanup()
    ids: dict[str, str] = {}
    try:
        apply_migration()
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {"email": email, "password": PASSWORD, "email_confirm": True}
            ).user.id
            admin.table("profiles").insert({
                "id": ids[key], "email": email, "display_name": name, "account_type": account_type,
            }).execute()

        brand_id = admin.table("brands").insert({
            "company_name": f"Fictional Deal Name Brand {RUN_ID}", "industry": "Media",
        }).execute().data[0]["id"]
        admin.table("brand_members").insert([
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["M"], "brand_role": "member", "status": "active"},
            {"brand_id": brand_id, "profile_id": ids["K"], "brand_role": "member", "status": "active"},
        ]).execute()
        tokens = {key: token_for(value[0]) for key, value in USERS.items()}

        primary = create_deal(ids, brand_id, "chatting", "primary")
        before_reapply = admin.table("deals").select(
            "deal_name,deal_name_version,stage,updated_at"
        ).eq("id", primary).single().execute().data
        apply_migration()
        after_reapply = admin.table("deals").select(
            "deal_name,deal_name_version,stage,updated_at"
        ).eq("id", primary).single().execute().data
        check(
            "migration backfills version zero without changing existing deal data and reapplies safely",
            before_reapply == after_reapply and after_reapply["deal_name_version"] == 0,
        )
        rpc_definition = management_sql("""
            SELECT pg_get_functiondef('public.apply_deal_name_rename(uuid,uuid,integer,text,text)'::regprocedure) AS definition
        """)[0]["definition"]
        check(
            "reapplied helper leaves atomic notice function installed",
            "INSERT INTO public.notifications" in rpc_definition
            and rpc_definition.index("INSERT INTO audit_log") < rpc_definition.index("INSERT INTO public.notifications")
            and "FOR UPDATE" in rpc_definition
            and "DEAL_NAME_STALE" in rpc_definition
            and "'idempotent', true" in rpc_definition,
        )
        failed_between = False
        try:
            apply_migration(fail_between=True)
        except httpx.HTTPStatusError as exc:
            failed_between = "FICTIONAL_FORCED_MIGRATION_FAILURE" in exc.response.text
        retained_definition = management_sql("""
            SELECT pg_get_functiondef('public.apply_deal_name_rename(uuid,uuid,integer,text,text)'::regprocedure) AS definition
        """)[0]["definition"]
        retained_row = admin.table("deals").select(
            "deal_name,deal_name_version,stage,updated_at"
        ).eq("id", primary).single().execute().data
        check(
            "fault between 045 and 060 rolls back the whole reapply",
            failed_between and retained_definition == rpc_definition
            and retained_row == before_reapply,
        )

        grants = management_sql("""
            SELECT
              NOT has_table_privilege('authenticated', 'public.deals', 'UPDATE') AS direct_update_denied,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(p.proacl)
                 WHERE grantee = 0 AND privilege_type = 'EXECUTE'
              ) AS public_rpc_denied,
              NOT has_function_privilege('anon', 'public.apply_deal_name_rename(uuid,uuid,integer,text,text)', 'EXECUTE') AS anon_rpc_denied,
              NOT has_function_privilege(
                'authenticated',
                'public.apply_deal_name_rename(uuid,uuid,integer,text,text)',
                'EXECUTE'
              ) AS authenticated_rpc_denied,
              has_function_privilege(
                'service_role',
                'public.apply_deal_name_rename(uuid,uuid,integer,text,text)',
                'EXECUTE'
              ) AS service_rpc_allowed
              FROM pg_proc p
             WHERE p.oid = 'public.apply_deal_name_rename(uuid,uuid,integer,text,text)'::regprocedure;
        """)[0]
        check("direct deal update remains revoked and rename RPC is service-role-only", all(grants.values()))

        direct = auth_client(USERS["C"][0])
        direct_update_denied = direct_rpc_denied = False
        try:
            direct.table("deals").update({"deal_name": "Forbidden direct rename"}).eq("id", primary).execute()
        except Exception:
            direct_update_denied = True
        try:
            direct.rpc("apply_deal_name_rename", {
                "p_deal_id": primary, "p_actor_id": ids["C"], "p_expected_version": 0,
                "p_deal_name": "Forbidden RPC rename", "p_ip_address": "fictional-direct",
            }).execute()
        except Exception:
            direct_rpc_denied = True
        check("authenticated client cannot update deals or execute rename RPC", direct_update_denied and direct_rpc_denied)

        database_guarded = False
        try:
            admin.rpc("apply_deal_name_rename", {
                "p_deal_id": primary, "p_actor_id": ids["C"], "p_expected_version": 0,
                "p_deal_name": " ", "p_ip_address": "fictional-service-guard",
            }).execute()
        except Exception as exc:
            database_guarded = "DEAL_NAME_INVALID" in str(exc)
        check(
            "database function independently rejects invalid service input",
            database_guarded
            and admin.table("deals").select("deal_name_version").eq("id", primary).single().execute().data["deal_name_version"] == 0,
        )

        current_version = 0
        for role in ("C", "B", "M", "K"):
            response = call(primary, tokens[role], f"Fictional rename by {role} {RUN_ID}", current_version)
            current_version += 1
            check(
                f"current participant role {role} can rename",
                response.status_code == 200
                and response.json()["deal_name_version"] == current_version
                and response.json()["idempotent"] is False,
            )
            role_notices = notices(primary)
            previous_actors = ("C", "B", "M", "K")[:current_version]
            expected_counts = {
                ids[key]: sum(previous_actor != key for previous_actor in previous_actors)
                for key in ("C", "B", "M", "K")
            }
            check(
                f"role {role} rename alerts each other participant once",
                len(role_notices) == 3 * current_version
                and all(sum(row["profile_id"] == recipient for row in role_notices) == count
                        for recipient, count in expected_counts.items()),
            )

        outsider = call(primary, tokens["X"], "Outsider rename", current_version)
        outsider_state = admin.table("deals").select("deal_name_version").eq("id", primary).single().execute().data
        outsider_audits = admin.table("audit_log").select("id").eq("entity_id", primary).eq(
            "action", "deal_name_changed"
        ).execute().data
        check(
            "outsider receives 403 with no mutation or audit",
            outsider.status_code == 403
            and outsider_state["deal_name_version"] == current_version
            and len(outsider_audits) == current_version
            and len(notices(primary)) == 3 * current_version,
        )

        normalized_input = "  Ｆｉｃｔｉｏｎａｌ\u3000नाम   अभियान！  "
        old_row = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
            "id", primary
        ).single().execute().data
        normalized = call(primary, tokens["C"], normalized_input, current_version)
        current_version += 1
        new_row = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
            "id", primary
        ).single().execute().data
        latest_audit = admin.table("audit_log").select("metadata").eq("entity_id", primary).eq(
            "action", "deal_name_changed"
        ).order("created_at", desc=True).limit(1).single().execute().data["metadata"]
        check(
            "NFKC and whitespace normalization preserve multilingual punctuation",
            normalized.status_code == 200
            and normalized.json()["deal_name"] == "Fictional नाम अभियान!"
            and new_row["deal_name"] == "Fictional नाम अभियान!",
        )
        check(
            "successful rename increments once, advances timestamp and stores metadata-only audit",
            new_row["deal_name_version"] == old_row["deal_name_version"] + 1
            and new_row["updated_at"] > old_row["updated_at"]
            and set(latest_audit) == {
                "previous_version", "new_version", "previous_character_count", "new_character_count"
            }
            and normalized_input not in json.dumps(latest_audit, ensure_ascii=False)
            and new_row["deal_name"] not in json.dumps(latest_audit, ensure_ascii=False),
        )
        notice_rows = notices(primary)
        check(
            "notices use generic informational content, deal link, unread default and database time",
            len(notice_rows) == 3 * current_version
            and all(row["tier"] == "informational" and row["title"] == "Deal renamed"
                    and row["body"] == "A deal you participate in was renamed."
                    and row["deal_id"] == primary and row["read"] is False
                    and row["created_at"] for row in notice_rows)
            and all(value not in json.dumps(notice_rows, ensure_ascii=False)
                    for value in (normalized_input, new_row["deal_name"], USERS["C"][0], "Fictional Creator")),
        )
        recipient = auth_client(USERS["B"][0])
        actor = auth_client(USERS["C"][0])
        outsider_client = auth_client(USERS["X"][0])
        recipient_row = next(row for row in notice_rows if row["profile_id"] == ids["B"])
        check(
            "recipient RLS sees only own notices and outsider sees none",
            len(recipient.table("notifications").select("id").eq("deal_id", primary).execute().data)
            == sum(row["profile_id"] == ids["B"] for row in notice_rows)
            and all(row["profile_id"] == ids["B"] for row in recipient.table("notifications").select("profile_id").eq("deal_id", primary).execute().data)
            and outsider_client.table("notifications").select("id").eq("deal_id", primary).execute().data == [],
        )
        check(
            "actor cannot see another recipient notice or acknowledge it",
            actor.table("notifications").select("id").eq("id", recipient_row["id"]).execute().data == []
            and actor.rpc("mark_notification_read", {"p_notification_id": recipient_row["id"]}).execute().data is False
            and recipient.rpc("mark_notification_read", {"p_notification_id": recipient_row["id"]}).execute().data is True
            and admin.table("notifications").select("read").eq("id", recipient_row["id"]).single().execute().data["read"] is True,
        )
        check(
            "authenticated direct notification insert and update remain denied",
            denied(lambda: recipient.table("notifications").insert({
                "profile_id": ids["B"], "tier": "informational", "title": "forged", "body": "forged",
            }).execute())
            and denied(lambda: recipient.table("notifications").update({"title": "forged"}).eq("id", recipient_row["id"]).execute()),
        )

        audit_count = len(admin.table("audit_log").select("id").eq("entity_id", primary).eq(
            "action", "deal_name_changed"
        ).execute().data)
        retry = call(primary, tokens["C"], normalized_input, current_version - 1)
        retry_row = admin.table("deals").select("deal_name_version").eq("id", primary).single().execute().data
        retry_audits = admin.table("audit_log").select("id").eq("entity_id", primary).eq(
            "action", "deal_name_changed"
        ).execute().data
        check(
            "exact normalized stale retry is idempotent without another version or audit",
            retry.status_code == 200 and retry.json()["idempotent"] is True
            and retry_row["deal_name_version"] == current_version
            and len(retry_audits) == audit_count
            and len(notices(primary)) == 3 * current_version,
        )
        distinct = call(primary, tokens["B"], f"Fictional later rename {RUN_ID}", current_version)
        current_version += 1
        audit_count += 1
        check(
            "later distinct rename creates a fresh recipient set",
            distinct.status_code == 200 and distinct.json()["deal_name_version"] == current_version
            and distinct.json()["idempotent"] is False
            and len(notices(primary)) == 3 * current_version
            and len(admin.table("audit_log").select("id").eq("entity_id", primary).eq(
                "action", "deal_name_changed"
            ).execute().data) == audit_count,
        )

        stale = call(primary, tokens["B"], "Distinct stale rename", current_version - 1)
        check(
            "distinct stale edit returns friendly 409 without mutation or audit",
            stale.status_code == 409
            and "Someone else renamed" in stale.json()["detail"]
            and admin.table("deals").select("deal_name_version").eq("id", primary).single().execute().data["deal_name_version"] == current_version
            and len(admin.table("audit_log").select("id").eq("entity_id", primary).eq("action", "deal_name_changed").execute().data) == audit_count
            and len(notices(primary)) == 3 * current_version,
        )

        for label, invalid_name in (
            ("blank", " \u3000 "),
            ("overlong", "名" * 161),
            ("control", "Fictional\nname"),
            ("bidirectional", "Fictional\u202ename"),
        ):
            invalid = call(primary, tokens["C"], invalid_name, current_version)
            check(f"{label} name is rejected with friendly validation", invalid.status_code == 422)
        check(
            "invalid inputs produce no mutation or audit",
            admin.table("deals").select("deal_name_version").eq("id", primary).single().execute().data["deal_name_version"] == current_version
            and len(admin.table("audit_log").select("id").eq("entity_id", primary).eq("action", "deal_name_changed").execute().data) == audit_count
            and len(notices(primary)) == 3 * current_version,
        )

        for stage in ("pending", "approval", "creating", "posted", "payment"):
            deal_id = create_deal(ids, brand_id, stage, f"eligible {stage}")
            response = call(deal_id, tokens["C"], f"Renamed in {stage} {RUN_ID}", 0)
            check(f"{stage} deal remains renameable", response.status_code == 200
                  and response.json()["deal_name_version"] == 1 and len(notices(deal_id)) == 3)

        solo_id = create_deal(ids, brand_id, "chatting", "solo participant")
        admin.table("deal_participants").delete().eq("deal_id", solo_id).neq("profile_id", ids["C"]).execute()
        solo = call(solo_id, tokens["C"], "Fictional solo rename", 0)
        check("rename with no other participant succeeds without a phantom notice",
              solo.status_code == 200 and solo.json()["deal_name_version"] == 1
              and notices(solo_id) == [])

        for stage in ("closed", "declined", "cancelled"):
            deal_id = create_deal(ids, brand_id, stage, f"terminal {stage}")
            before = admin.table("deals").select("deal_name,deal_name_version").eq("id", deal_id).single().execute().data
            response = call(deal_id, tokens["C"], f"Forbidden {stage} rename", 0)
            after = admin.table("deals").select("deal_name,deal_name_version").eq("id", deal_id).single().execute().data
            check(f"{stage} deal is read-only", response.status_code == 409
                  and before == after and notices(deal_id) == [])

        deleted_id = create_deal(ids, brand_id, "chatting", "deleted")
        admin.table("deals").update({"deleted_at": "2026-09-09T00:00:00Z"}).eq("id", deleted_id).execute()
        deleted = call(deleted_id, tokens["C"], "Forbidden deleted rename", 0)
        check("soft-deleted deal is denied without mutation", deleted.status_code == 404
              and notices(deleted_id) == [])

        atomic_id = create_deal(ids, brand_id, "chatting", "atomic rollback")
        atomic_before = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
            "id", atomic_id
        ).single().execute().data
        management_sql(f"""
            CREATE OR REPLACE FUNCTION test_fail_deal_name_audit() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
            BEGIN
              IF NEW.action = 'deal_name_changed' AND NEW.entity_id = '{atomic_id}'::uuid THEN
                RAISE EXCEPTION 'FICTIONAL_FORCED_AUDIT_FAILURE';
              END IF;
              RETURN NEW;
            END;
            $$;
            CREATE TRIGGER test_fail_deal_name_audit BEFORE INSERT ON audit_log
            FOR EACH ROW EXECUTE FUNCTION test_fail_deal_name_audit();
        """)
        failed = call(atomic_id, tokens["C"], "Must roll back", 0)
        atomic_after = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
            "id", atomic_id
        ).single().execute().data
        atomic_audits = admin.table("audit_log").select("id").eq("entity_id", atomic_id).eq(
            "action", "deal_name_changed"
        ).execute().data
        check("forced audit failure rolls back name, version, timestamp and notices",
              failed.status_code == 409 and atomic_before == atomic_after
              and not atomic_audits and notices(atomic_id) == [])
        management_sql(
            "DROP TRIGGER test_fail_deal_name_audit ON audit_log; "
            "DROP FUNCTION test_fail_deal_name_audit();"
        )

        notice_failure_id = create_deal(ids, brand_id, "chatting", "notice rollback")
        notice_before = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
            "id", notice_failure_id
        ).single().execute().data
        try:
            management_sql(f"""
                CREATE OR REPLACE FUNCTION test_fail_deal_name_notice() RETURNS trigger
                LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
                BEGIN
                  IF NEW.deal_id = '{notice_failure_id}'::uuid THEN
                    RAISE EXCEPTION 'FICTIONAL_FORCED_NOTICE_FAILURE';
                  END IF;
                  RETURN NEW;
                END;
                $$;
                CREATE TRIGGER test_fail_deal_name_notice BEFORE INSERT ON notifications
                FOR EACH ROW EXECUTE FUNCTION test_fail_deal_name_notice();
            """)
            notice_failed = call(notice_failure_id, tokens["C"], "Must roll back notice", 0)
            notice_after = admin.table("deals").select("deal_name,deal_name_version,updated_at").eq(
                "id", notice_failure_id
            ).single().execute().data
            check(
                "notice write failure returns friendly error and rolls back name, audit and notices",
                notice_failed.status_code == 409
                and notice_failed.json()["detail"] == "This deal changed. Refresh and try again."
                and notice_before == notice_after
                and admin.table("audit_log").select("id").eq("entity_id", notice_failure_id).eq(
                    "action", "deal_name_changed"
                ).execute().data == []
                and notices(notice_failure_id) == [],
            )
        finally:
            management_sql(
                "DROP TRIGGER IF EXISTS test_fail_deal_name_notice ON notifications; "
                "DROP FUNCTION IF EXISTS test_fail_deal_name_notice();"
            )

        race_id = create_deal(ids, brand_id, "chatting", "concurrency")
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(
                lambda args: call(race_id, args[0], args[1], 0),
                ((tokens["C"], "Fictional race alpha"), (tokens["B"], "Fictional race beta")),
            ))
        race_row = admin.table("deals").select("deal_name,deal_name_version").eq("id", race_id).single().execute().data
        race_audits = admin.table("audit_log").select("id").eq("entity_id", race_id).eq(
            "action", "deal_name_changed"
        ).execute().data
        check(
            "two distinct concurrent edits commit exactly one winner and one stale loser",
            sorted(response.status_code for response in responses) == [200, 409]
            and race_row["deal_name"] in {"Fictional race alpha", "Fictional race beta"}
            and race_row["deal_name_version"] == 1 and len(race_audits) == 1
            and sorted(row["profile_id"] for row in notices(race_id))
            == sorted(ids[key] for key in ("C", "B", "M", "K")
                      if key != ("C" if race_row["deal_name"] == "Fictional race alpha" else "B")),
        )

        missing = call(str(uuid4()), tokens["C"], "Missing deal rename", 0)
        extra = api.put(
            f"/deals/{primary}/name",
            json={"deal_name": "Extra", "expected_version": current_version, "unexpected": True},
            headers={"Authorization": f"Bearer {tokens['C']}"},
        )
        check("missing deal is friendly 404 and strict request rejects extra fields",
              missing.status_code == 404 and extra.status_code == 422
              and len(notices(primary)) == 3 * current_version)
    finally:
        cleanup()

    failed_labels = [label for label, passed in checks if not passed]
    print(f"\n{len(checks) - len(failed_labels)}/{len(checks)} checks passed")
    if failed_labels:
        raise AssertionError("Failed checks: " + "; ".join(failed_labels))


if __name__ == "__main__":
    main()
