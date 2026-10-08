"""Fictional development-Supabase acceptance checks for Workplan 12.1-A.

Run --prepare before applying migration 058, then run without arguments after it.
The prepared legacy row is compared byte-for-byte and all fixtures are removed.
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
from supabase import create_client

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", URL).group(1)
STATE = Path("/tmp/biz-notification-ledger-87.json")
admin = create_client(URL, SERVICE_KEY)
checks: list[tuple[str, bool]] = []


def check(label: str, ok: bool) -> None:
    checks.append((label, ok))
    print(f"{'PASS' if ok else 'FAIL'} - {label}")


def sql(query: str):
    response = httpx.post(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": query}, timeout=45,
    )
    response.raise_for_status()
    return response.json()


def denied(operation) -> bool:
    try:
        operation()
    except Exception as exc:
        # A revoked grant must produce a database permission error, not a quiet RLS no-op.
        return "permission denied" in str(exc).lower() or "42501" in str(exc)
    return False


def client(email: str, password: str):
    user = create_client(URL, ANON_KEY)
    session = user.auth.sign_in_with_password({"email": email, "password": password}).session
    return user, session.access_token


def rpc(token: str, notification_id: str) -> httpx.Response:
    return httpx.post(
        f"{URL}/rest/v1/rpc/mark_notification_read",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {token}"},
        json={"p_notification_id": notification_id}, timeout=30,
    )


def row(notification_id: str) -> dict:
    return admin.table("notifications").select("*").eq("id", notification_id).single().execute().data


def xmin(notification_id: str) -> str:
    return sql(f"SELECT xmin::text AS version FROM public.notifications WHERE id = '{notification_id}'::uuid")[0]["version"]


def cleanup(state: dict) -> None:
    for user_id in state.get("ids", {}).values():
        admin.table("notifications").delete().eq("profile_id", user_id).execute()
        admin.auth.admin.delete_user(user_id)


def prepare(*, pre_migration: bool = False) -> None:
    if STATE.exists():
        raise RuntimeError("Prepared fictional fixture already exists; run the main test or --cleanup")
    run_id = uuid4().hex[:12]
    state = {
        "emails": {key: f"ledger.{key.lower()}.{run_id}@inflo.test" for key in ("A", "B")},
        "password": f"Ledger-{run_id}-Fictional!",
        "ids": {},
        "pre_migration": pre_migration,
    }
    try:
        for key in ("A", "B"):
            created = admin.auth.admin.create_user({
                "email": state["emails"][key], "password": state["password"],
                "email_confirm": True,
            })
            state["ids"][key] = created.user.id
            admin.table("profiles").insert({
                "id": created.user.id, "email": state["emails"][key],
                "display_name": f"Fictional Ledger {key}",
                "account_type": "creator" if key == "A" else "brand",
            }).execute()
        legacy = admin.table("notifications").insert({
            "profile_id": state["ids"]["A"], "tier": "important",
            "title": "Fictional legacy alert", "body": "Existing content must survive migration",
        }).execute().data[0]
        state["legacy"] = legacy
        STATE.write_text(json.dumps(state))
        STATE.chmod(0o600)
        print("Prepared one fictional notification row; full row snapshot saved locally.")
    except BaseException:
        cleanup(state)
        raise


def run() -> None:
    if not STATE.exists():
        prepare()
    state = json.loads(STATE.read_text())
    a_id, b_id = state["ids"]["A"], state["ids"]["B"]
    created: list[str] = []
    try:
        label = ("legacy notification survives migration byte-for-byte" if state["pre_migration"]
                 else "existing fictional notification remains byte-for-byte unchanged")
        check(label, row(state["legacy"]["id"]) == state["legacy"])

        privileges = sql("""
            SELECT role_name,
                   has_table_privilege(role_name, 'public.notifications', 'SELECT') AS can_select,
                   has_table_privilege(role_name, 'public.notifications', 'INSERT') AS can_insert,
                   has_table_privilege(role_name, 'public.notifications', 'UPDATE') AS can_update,
                   has_table_privilege(role_name, 'public.notifications', 'DELETE') AS can_delete,
                   has_table_privilege(role_name, 'public.notifications', 'TRUNCATE') AS can_truncate
              FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
             ORDER BY role_name
        """)
        by_role = {entry["role_name"]: entry for entry in privileges}
        check("anonymous has no notification table authority", not any(by_role["anon"][k] for k in ("can_select", "can_insert", "can_update", "can_delete", "can_truncate")))
        check("authenticated has SELECT only", by_role["authenticated"]["can_select"] and not any(by_role["authenticated"][k] for k in ("can_insert", "can_update", "can_delete", "can_truncate")))
        check("service role retains read/write authority", all(by_role["service_role"][k] for k in ("can_select", "can_insert", "can_update", "can_delete")))
        policies = sql("SELECT policyname,cmd,roles FROM pg_policies WHERE schemaname='public' AND tablename='notifications'")
        check("recipient SELECT is the only client policy", policies == [{"policyname": "notifications_recipient_read", "cmd": "SELECT", "roles": "{authenticated}"}])
        routine = sql("""
            SELECT has_function_privilege('anon','public.mark_notification_read(uuid)','EXECUTE') AS anon_exec,
                   has_function_privilege('authenticated','public.mark_notification_read(uuid)','EXECUTE') AS auth_exec,
                   p.prosecdef AS definer, p.proconfig AS config
              FROM pg_proc p WHERE p.oid='public.mark_notification_read(uuid)'::regprocedure
        """)[0]
        check("RPC is authenticated-only with fixed search path", not routine["anon_exec"] and routine["auth_exec"] and routine["definer"] and "search_path=" in str(routine["config"]))
        publication = sql("SELECT count(*) AS n FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications'")
        check("Realtime publication has exactly one notification membership", publication == [{"n": 1}])
        identity = sql("SELECT relreplident FROM pg_class WHERE oid='public.notifications'::regclass")
        check("Realtime does not expose old full rows", identity == [{"relreplident": "d"}])
        indexes = {r["indexname"]: r["indexdef"] for r in sql("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='notifications'")}
        check("newest cursor and prior unread/retention indexes exist", "idx_notifications_recipient_newest" in indexes and "profile_id, created_at DESC, id DESC" in indexes["idx_notifications_recipient_newest"] and {"idx_notifications_unread", "idx_notifications_created_at"} <= indexes.keys())

        a, a_token = client(state["emails"]["A"], state["password"])
        b, b_token = client(state["emails"]["B"], state["password"])
        anon = create_client(URL, ANON_KEY)
        b_row = admin.table("notifications").insert({"profile_id": b_id, "tier": "critical", "title": "Fictional B", "body": "Private B"}).execute().data[0]
        created.append(b_row["id"])
        check("recipient sees legacy row but not another recipient's row", [r["id"] for r in a.table("notifications").select("id").execute().data] == [state["legacy"]["id"]])
        check("other recipient sees only their own row", [r["id"] for r in b.table("notifications").select("id").execute().data] == [b_row["id"]])
        check("anonymous SELECT is denied", denied(lambda: anon.table("notifications").select("id").execute()))

        before = row(state["legacy"]["id"])
        mutations = {
            "read": True, "title": "forged", "body": "forged", "tier": "critical",
            "profile_id": b_id, "deal_id": None, "dispute_id": None,
            "created_at": "2030-01-01T00:00:00Z",
        }
        check("all owned direct UPDATE columns are denied", all(
            denied(lambda field=field, value=value: a.table("notifications").update({field: value}).eq("id", before["id"]).execute())
            for field, value in mutations.items()
        ))
        check("direct authenticated and anonymous INSERT/DELETE are denied", all((
            denied(lambda: a.table("notifications").insert({"profile_id": a_id, "tier": "important", "title": "forged", "body": "forged"}).execute()),
            denied(lambda: anon.table("notifications").insert({"profile_id": a_id, "tier": "important", "title": "forged", "body": "forged"}).execute()),
            denied(lambda: a.table("notifications").delete().eq("id", before["id"]).execute()),
            denied(lambda: anon.table("notifications").delete().eq("id", before["id"]).execute()),
        )))
        check("failed direct writes leave legacy row unchanged", row(before["id"]) == before)

        check("anonymous and invalid tokens cannot acknowledge", all((
            rpc(ANON_KEY, before["id"]).status_code in (401, 403, 404),
            rpc("invalid.expired.token", before["id"]).status_code in (401, 403),
        )))
        unknown = str(uuid4())
        foreign = rpc(a_token, b_row["id"])
        missing = rpc(a_token, unknown)
        check("foreign and unknown IDs return identical non-disclosing false", foreign.status_code == missing.status_code == 200 and foreign.json() is False and missing.json() is False)
        check("foreign/unknown calls leave both rows unchanged", row(before["id"]) == before and row(b_row["id"]) == b_row)
        first = rpc(a_token, before["id"])
        once = row(before["id"])
        version = xmin(before["id"])
        second = rpc(a_token, before["id"])
        check("own unread and already-read calls both succeed", first.status_code == second.status_code == 200 and first.json() is True and second.json() is True)
        check("acknowledgement changes only read and repeat does not rewrite", once == {**before, "read": True} and row(before["id"]) == once and xmin(before["id"]) == version)

        concurrent_row = admin.table("notifications").insert({"profile_id": a_id, "tier": "informational", "title": "Fictional race", "body": "Race-safe content"}).execute().data[0]
        created.append(concurrent_row["id"])
        count_before = len(admin.table("notifications").select("id").in_("profile_id", [a_id, b_id]).execute().data)
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: rpc(a_token, concurrent_row["id"]), range(2)))
        check("concurrent acknowledgements converge successfully", all(r.status_code == 200 and r.json() is True for r in outcomes))
        count_after = len(admin.table("notifications").select("id").in_("profile_id", [a_id, b_id]).execute().data)
        check("concurrency preserves every other field and row count", row(concurrent_row["id"]) == {**concurrent_row, "read": True} and count_after == count_before)

        tied_at = "2028-01-02T03:04:05Z"
        tied = admin.table("notifications").insert([
            {"profile_id": a_id, "tier": "important", "title": f"Fictional tie {i}", "body": "Stable cursor", "created_at": tied_at}
            for i in range(3)
        ]).execute().data
        created.extend(r["id"] for r in tied)
        expected = sorted([r["id"] for r in tied], reverse=True)
        ordered = a.table("notifications").select("id,created_at").eq("created_at", tied[0]["created_at"]).order("created_at", desc=True).order("id", desc=True).execute().data
        check("created_at ties use stable newest-first UUID order", [r["id"] for r in ordered] == expected)
        cursor = expected[0]
        page = a.table("notifications").select("id").eq("created_at", tied[0]["created_at"]).lt("id", cursor).order("id", desc=True).execute().data
        check("keyset continuation has no duplicate or skipped tie", [r["id"] for r in page] == expected[1:])
        check("service-role inserts remain visible only to recipients", b.table("notifications").select("id").in_("id", created).execute().data == [{"id": b_row["id"]}])
    finally:
        cleanup(state)
        STATE.unlink(missing_ok=True)
        print("Fictional notification and auth fixtures cleaned up.")

    passed = sum(ok for _, ok in checks)
    print(f"RESULT: {passed}/{len(checks)} checks passed")
    if passed != len(checks):
        sys.exit(1)


if __name__ == "__main__":
    if sys.argv[1:] == ["--prepare"]:
        prepare(pre_migration=True)
    elif sys.argv[1:] == ["--cleanup"]:
        if STATE.exists():
            cleanup(json.loads(STATE.read_text()))
            STATE.unlink()
    elif not sys.argv[1:]:
        run()
    else:
        raise SystemExit("Usage: test_notification_ledger.py [--prepare|--cleanup]")
