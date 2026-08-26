"""Phase 7 Cluster C — maker-checker + signature RLS test.

Proves the segregation-of-duties mechanism END-TO-END through the real FastAPI
endpoints, with realistic fictional data (golden rule #4). Fictional users sign in
to get REAL Supabase JWTs; the FastAPI in-process TestClient calls the endpoints
with those tokens, so auth + RBAC + audit all run for real.

Setup uses the service_role admin to create a brand, two members (a maker and a
checker), a creator counterparty, a deal, per-deal participant roles, and config.

Requires migration 015 applied. Run: python backend/tests/test_maker_checker.py
"""

import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))  # so `from main import app` resolves

load_dotenv(BACKEND_DIR.parent / ".env")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = re.search(r"https://([a-z0-9]+)\.supabase\.co", SUPABASE_URL).group(1)

TEST_PASSWORD = "Diwali2026!Inflo"
MAKER = {"email": "rohan.maker@test-inflo.dev", "display_name": "Rohan Maker", "account_type": "brand"}
CHECKER = {"email": "isha.checker@test-inflo.dev", "display_name": "Isha Checker", "account_type": "brand"}
CREATOR = {"email": "tara.creator@test-inflo.dev", "display_name": "Tara Creator", "account_type": "creator"}
BRAND_NAME = "Sleepy Owl Coffee Brand Account"

client = TestClient(app)
results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def mgmt_sql(sql: str) -> None:
    """Run SQL as postgres via the Management API (test-teardown only)."""
    r = httpx.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        json={"query": sql},
        timeout=30,
    )
    r.raise_for_status()


def sign_in(email: str) -> str:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    auth = c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
    return auth.session.access_token


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def cleanup(admin: Client, ids: dict[str, str | None]) -> None:
    print("\nCleaning up test data...")
    user_ids = [ids[k] for k in ("maker", "checker", "creator") if ids.get(k)]
    # audit_log is immutable (trigger) AND its actor_id is ON DELETE RESTRICT, so
    # profiles can't be deleted while audit rows reference them. Remove the test's
    # audit rows via a postgres session that bypasses the immutability trigger —
    # the app-level protection stays intact for everyone else.
    if user_ids:
        id_list = ",".join(f"'{u}'" for u in user_ids)
        mgmt_sql(
            "SET session_replication_role = replica; "
            f"DELETE FROM audit_log WHERE actor_id IN ({id_list}); "
            "SET session_replication_role = origin;"
        )
    if ids.get("deal"):
        admin.table("deals").delete().eq("id", ids["deal"]).execute()  # cascades participants + requests
    if ids.get("brand"):
        admin.table("brands").delete().eq("id", ids["brand"]).execute()  # cascades brand_members + config
    for u in user_ids:
        admin.auth.admin.delete_user(u)  # cascades profile + signatures
    print("  done")


def cleanup_leftovers(admin: Client) -> None:
    emails = {MAKER["email"], CHECKER["email"], CREATOR["email"]}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Removing {len(leftover)} leftover test user(s)...")
    ids = [u.id for u in leftover]
    id_list = ",".join(f"'{i}'" for i in ids)
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({id_list}); "
        "SET session_replication_role = origin;"
    )
    deals = admin.table("deals").select("id, brand_id").in_("created_by", ids).execute()
    brand_ids = set()
    for d in deals.data:
        admin.table("deals").delete().eq("id", d["id"]).execute()
        if d.get("brand_id"):
            brand_ids.add(d["brand_id"])
    # also brands where a leftover user is a member
    members = admin.table("brand_members").select("brand_id").in_("profile_id", ids).execute()
    brand_ids.update(m["brand_id"] for m in members.data)
    for b in brand_ids:
        admin.table("brands").delete().eq("id", b).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    ids: dict[str, str | None] = {"maker": None, "checker": None, "creator": None, "brand": None, "deal": None}

    try:
        # ── Setup ────────────────────────────────────────────────────────────
        for key, info in (("maker", MAKER), ("checker", CHECKER), ("creator", CREATOR)):
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {"id": ids["maker"], "account_type": "brand", "display_name": MAKER["display_name"], "email": MAKER["email"]},
                {"id": ids["checker"], "account_type": "brand", "display_name": CHECKER["display_name"], "email": CHECKER["email"]},
                {"id": ids["creator"], "account_type": "creator", "display_name": CREATOR["display_name"], "email": CREATOR["email"]},
            ]
        ).execute()

        ids["brand"] = admin.table("brands").insert(
            {"company_name": BRAND_NAME, "industry": "F&B"}
        ).execute().data[0]["id"]
        admin.table("brand_members").insert(
            [
                {"brand_id": ids["brand"], "profile_id": ids["maker"], "brand_role": "admin", "status": "active"},
                {"brand_id": ids["brand"], "profile_id": ids["checker"], "brand_role": "member", "status": "active"},
            ]
        ).execute()

        ids["deal"] = admin.table("deals").insert(
            {
                "creator_id": ids["creator"],
                "brand_id": ids["brand"],
                "deal_name": "Cold Brew Winter Campaign",
                "deal_type": "campaign",
                "direction": "inbound",
                "created_by": ids["maker"],
            }
        ).execute().data[0]["id"]
        admin.table("deal_participants").insert(
            [
                {"deal_id": ids["deal"], "profile_id": ids["creator"], "participant_role": "creator"},
                {"deal_id": ids["deal"], "profile_id": ids["maker"], "participant_role": "brand_maker"},
                {"deal_id": ids["deal"], "profile_id": ids["checker"], "participant_role": "brand_checker"},
            ]
        ).execute()

        maker_token = sign_in(MAKER["email"])
        checker_token = sign_in(CHECKER["email"])
        creator_token = sign_in(CREATOR["email"])
        print("Setup complete (brand, maker, checker, creator, deal).\n")

        # ── 1. Config gating: no checker required → executes directly ─────────
        admin.table("maker_checker_config").insert(
            {"brand_id": ids["brand"], "action_type": "payment_release", "requires_checker": False}
        ).execute()
        r = client.post(
            "/maker-checker/initiate",
            json={"deal_id": ids["deal"], "action_type": "payment_release"},
            headers=auth_header(maker_token),
        )
        check("no checker required → initiate executes directly", r.status_code == 200 and r.json()["status"] == "executed")

        # ── 2. Config gating: checker required → held (pending request) ───────
        admin.table("maker_checker_config").insert(
            {"brand_id": ids["brand"], "action_type": "content_approval", "requires_checker": True}
        ).execute()
        r = client.post(
            "/maker-checker/initiate",
            json={"deal_id": ids["deal"], "action_type": "content_approval"},
            headers=auth_header(maker_token),
        )
        held = r.json()
        request_id = held.get("request_id")
        check(
            "checker required → initiate holds (pending request created)",
            r.status_code == 200 and held["status"] == "held" and bool(request_id) and held["checker_id"] == ids["checker"],
        )

        # ── 3. Maker CANNOT approve their own request (the core rule) ─────────
        r = client.post(
            f"/maker-checker/requests/{request_id}/decide",
            json={"decision": "approve"},
            headers=auth_header(maker_token),
        )
        check("maker CANNOT approve their own request (403)", r.status_code == 403)

        # ── 4. Non-checker CANNOT approve ─────────────────────────────────────
        r = client.post(
            f"/maker-checker/requests/{request_id}/decide",
            json={"decision": "approve"},
            headers=auth_header(creator_token),
        )
        check("non-checker CANNOT approve (403)", r.status_code == 403)

        # request must still be pending after the two rejected attempts
        still = admin.table("maker_checker_requests").select("status").eq("id", request_id).single().execute()
        check("request stays pending after refused approvals", still.data["status"] == "pending")

        # ── 5. Assigned checker CAN approve ───────────────────────────────────
        r = client.post(
            f"/maker-checker/requests/{request_id}/decide",
            json={"decision": "approve", "comment": "Looks good."},
            headers=auth_header(checker_token),
        )
        approved = admin.table("maker_checker_requests").select("status, decided_at").eq("id", request_id).single().execute()
        check(
            "assigned checker CAN approve → approved + decided_at set",
            r.status_code == 200 and approved.data["status"] == "approved" and approved.data["decided_at"] is not None,
        )

        # ── 5b. Audit trail written (request_created + approved) ──────────────
        audit = admin.table("audit_log").select("action").eq("entity_id", request_id).execute()
        actions = {row["action"] for row in audit.data}
        check(
            "audit_log recorded request_created + approved",
            "maker_checker.request_created" in actions and "maker_checker.approved" in actions,
        )

        # ── 6. Config RLS: only a brand ADMIN may write config ────────────────
        anon_checker = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        anon_checker.auth.sign_in_with_password({"email": CHECKER["email"], "password": TEST_PASSWORD})
        member_blocked = False
        try:
            anon_checker.table("maker_checker_config").insert(
                {"brand_id": ids["brand"], "action_type": "contract_signing", "requires_checker": True}
            ).execute()
        except Exception:
            member_blocked = True
        check("RLS blocks a non-admin member from writing config", member_blocked)

        anon_admin = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        anon_admin.auth.sign_in_with_password({"email": MAKER["email"], "password": TEST_PASSWORD})
        admin_ok = True
        try:
            anon_admin.table("maker_checker_config").upsert(
                {"brand_id": ids["brand"], "action_type": "contract_signing", "requires_checker": True},
                on_conflict="brand_id,action_type",
            ).execute()
        except Exception as e:
            admin_ok = False
            print(f"  (unexpected) admin config write failed: {e}")
        check("RLS allows a brand admin to write config", admin_ok)

        # ── 7. Signature RLS: a user reads only their own signature ───────────
        admin.table("signatures").insert(
            {"profile_id": ids["maker"], "signature_type": "typed", "signature_data": "Rohan Maker", "is_active": True}
        ).execute()
        maker_reads = anon_admin.table("signatures").select("*").eq("profile_id", ids["maker"]).execute()
        checker_reads = anon_checker.table("signatures").select("*").eq("profile_id", ids["maker"]).execute()
        check(
            "signature RLS: owner reads own (1), other reads none (0)",
            len(maker_reads.data) == 1 and len(checker_reads.data) == 0,
        )

    finally:
        cleanup(admin, ids)

    print("\n" + "=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
