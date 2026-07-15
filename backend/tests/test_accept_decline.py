"""Phase 9 Cluster 1 — task 9.5: Pending accept / decline transitions.

Drives POST /deals/{id}/accept and /decline END-TO-END through the real FastAPI
TestClient with real Supabase JWTs (fictional users sign in), so auth + the
recipient/pending/72h guards + the transition log + audit all run for real. The
service_role admin sets up the brands/creators/deals and inspects the result.

Covers (deal-engine.md §1 + Guard conditions):
  • recipient accepts        → pending→chatting, transition logged, audited
  • recipient declines       → pending→declined, transition logged
  • INITIATOR can't accept    (403 — only the recipient responds)
  • non-participant blocked   (403)
  • accept when NOT pending   (409 — illegal transition, blocked server-side)
  • expired (>72h) accept     (410)
  • exclusivity at accept     (warn-only: requires_ack, then acknowledged accept)

Run: python backend/tests/test_accept_decline.py
"""

import os
import re
import sys
from datetime import datetime, timedelta, timezone
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

TEST_PASSWORD = "Chaturthi2026!Inflo"

USERS = {
    "B": {"email": "b.admin@accept-inflo.test", "display_name": "Bela Admin", "account_type": "brand"},
    "C": {"email": "c.creator@accept-inflo.test", "display_name": "Chandni Roy", "account_type": "creator"},
    "C2": {"email": "c2.creator@accept-inflo.test", "display_name": "Charu Excl", "account_type": "creator"},
    "U": {"email": "u.unrelated@accept-inflo.test", "display_name": "Uma Unrelated", "account_type": "creator"},
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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


def token_for(email: str) -> str:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD}).session.access_token


def accept(token: str, deal_id: str, acknowledge: bool = False):
    return api.post(
        f"/deals/{deal_id}/accept",
        json={"acknowledge_exclusivity": acknowledge},
        headers={"Authorization": f"Bearer {token}"},
    )


def decline(token: str, deal_id: str):
    return api.post(f"/deals/{deal_id}/decline", headers={"Authorization": f"Bearer {token}"})


def make_pending_deal(creator_id: str, brand_id: str, created_by: str, brand_admin_id: str, expires_hours: int) -> str:
    """Seed a Pending deal + its two participants directly (service_role), so each
    test case gets an independent deal with a controlled expiry."""
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).isoformat()
    deal_id = (
        admin.table("deals")
        .insert(
            {
                "creator_id": creator_id,
                "brand_id": brand_id,
                "deal_name": "Accept/Decline test deal",
                "deal_type": "campaign",
                "stage": "pending",
                "direction": "inbound",
                "currency": "INR",
                "created_by": created_by,
                "expires_at": expires_at,
            }
        )
        .execute()
        .data[0]["id"]
    )
    admin.table("deal_participants").insert(
        [
            {"deal_id": deal_id, "profile_id": creator_id, "participant_role": "creator"},
            {"deal_id": deal_id, "profile_id": brand_admin_id, "participant_role": "brand_admin"},
        ]
    ).execute()
    return deal_id


def cleanup(ids: dict[str, str]) -> None:
    """Remove leftover test users + everything they touch. audit_log is immutable
    AND actor_id is ON DELETE RESTRICT, so its rows are cleared via a postgres
    session that bypasses the trigger (the app-level protection is untouched)."""
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    uids = [u.id for u in leftover]
    if not uids:
        return
    quoted = ",".join(f"'{u}'" for u in uids)
    bare = ",".join(uids)
    mgmt_sql(
        "SET session_replication_role = replica; "
        f"DELETE FROM audit_log WHERE actor_id IN ({quoted}); "
        "SET session_replication_role = origin;"
    )
    deals = (
        admin.table("deals")
        .select("id, brand_id")
        .or_(f"created_by.in.({bare}),creator_id.in.({bare})")
        .execute()
    )
    brand_ids = set()
    for d in deals.data:
        admin.table("deals").delete().eq("id", d["id"]).execute()
        if d.get("brand_id"):
            brand_ids.add(d["brand_id"])
    members = admin.table("brand_members").select("brand_id").in_("profile_id", uids).execute()
    brand_ids.update(m["brand_id"] for m in members.data)
    for b in brand_ids:
        admin.table("brands").delete().eq("id", b).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def main() -> None:
    cleanup({})  # clear any leftovers from a prior aborted run

    ids: dict[str, str] = {}
    try:
        for key, info in USERS.items():
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {"id": ids[k], "account_type": v["account_type"], "display_name": v["display_name"], "email": v["email"]}
                for k, v in USERS.items()
            ]
        ).execute()

        brand_id = admin.table("brands").insert({"company_name": "Aster Labs", "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()

        # C2 carries an ACTIVE exclusivity via a prior closed deal (different brand),
        # so accepting a fresh deal fires the warn-only notice.
        brand2_id = admin.table("brands").insert({"company_name": "Rival Co", "industry": "Beauty"}).execute().data[0]["id"]
        prior = admin.table("deals").insert(
            {"creator_id": ids["C2"], "brand_id": brand2_id, "deal_name": "Prior", "direction": "inbound", "created_by": ids["C2"], "stage": "closed"}
        ).execute().data[0]["id"]
        admin.table("exclusivity_clauses").insert(
            {"deal_id": prior, "has_exclusivity": True, "category": "skincare", "end_date": None}
        ).execute()

        token_b = token_for(USERS["B"]["email"])
        token_c = token_for(USERS["C"]["email"])
        token_c2 = token_for(USERS["C2"]["email"])
        token_u = token_for(USERS["U"]["email"])

        # One independent Pending deal per case.
        d_accept = make_pending_deal(ids["C"], brand_id, ids["B"], ids["B"], 72)
        d_decline = make_pending_deal(ids["C"], brand_id, ids["B"], ids["B"], 72)
        d_initiator = make_pending_deal(ids["C"], brand_id, ids["B"], ids["B"], 72)
        d_nonpart = make_pending_deal(ids["C"], brand_id, ids["B"], ids["B"], 72)
        d_expired = make_pending_deal(ids["C"], brand_id, ids["B"], ids["B"], -1)
        d_excl = make_pending_deal(ids["C2"], brand_id, ids["B"], ids["B"], 72)

        # ── 1. Recipient accepts → Chatting ──────────────────────────────────────
        r1 = accept(token_c, d_accept)
        b1 = r1.json()
        check("accept: 200", r1.status_code == 200)
        check("accept: transitioned=true, stage=chatting", b1.get("transitioned") is True and b1.get("stage") == "chatting")
        deal1 = admin.table("deals").select("stage, expires_at").eq("id", d_accept).execute().data[0]
        check("accept: deals.stage='chatting' and expires_at cleared", deal1["stage"] == "chatting" and deal1["expires_at"] is None)
        t1 = admin.table("deal_stage_transitions").select("from_stage, to_stage, transition_type, triggered_by").eq("deal_id", d_accept).eq("to_stage", "chatting").execute().data
        check(
            "accept: pending→chatting 'gated' transition logged by caller",
            len(t1) == 1 and t1[0]["from_stage"] == "pending" and t1[0]["transition_type"] == "gated" and t1[0]["triggered_by"] == ids["C"],
        )
        a1 = admin.table("audit_log").select("action").eq("entity_id", d_accept).eq("action", "deal_accept").execute().data
        check("accept: audit_log 'deal_accept' row written", len(a1) == 1)

        # ── 2. Recipient declines → Declined ─────────────────────────────────────
        r2 = decline(token_c, d_decline)
        check("decline: 200", r2.status_code == 200)
        deal2 = admin.table("deals").select("stage").eq("id", d_decline).execute().data[0]
        check("decline: deals.stage='declined'", deal2["stage"] == "declined")
        t2 = admin.table("deal_stage_transitions").select("from_stage, to_stage, transition_type").eq("deal_id", d_decline).eq("to_stage", "declined").execute().data
        check("decline: pending→declined 'gated' transition logged", len(t2) == 1 and t2[0]["from_stage"] == "pending" and t2[0]["transition_type"] == "gated")

        # ── 3. Initiator cannot accept their own request ─────────────────────────
        r3 = accept(token_b, d_initiator)
        check("initiator (created_by) cannot accept (403)", r3.status_code == 403)
        check("initiator's deal still pending", admin.table("deals").select("stage").eq("id", d_initiator).execute().data[0]["stage"] == "pending")

        # ── 4. Non-participant blocked ───────────────────────────────────────────
        r4 = accept(token_u, d_nonpart)
        check("non-participant cannot accept (403)", r4.status_code == 403)

        # ── 5. Accepting a NON-pending deal is rejected ──────────────────────────
        r5 = accept(token_c, d_accept)  # already chatting from case 1
        check("accept on non-pending deal rejected (409)", r5.status_code == 409)

        # ── 6. Expired (>72h) accept rejected ────────────────────────────────────
        r6 = accept(token_c, d_expired)
        check("expired connection accept rejected (410)", r6.status_code == 410)
        check("expired deal NOT advanced (still pending)", admin.table("deals").select("stage").eq("id", d_expired).execute().data[0]["stage"] == "pending")

        # ── 7. Exclusivity at accept — warn only, then acknowledged ──────────────
        r7 = accept(token_c2, d_excl, acknowledge=False)
        b7 = r7.json()
        check("exclusivity: 200 with requires_acknowledgement (no transition)", r7.status_code == 200 and b7.get("requires_acknowledgement") is True and b7.get("transitioned") is False)
        check("exclusivity: warning names the category", "skincare" in (b7.get("exclusivity_warning") or ""))
        check("exclusivity: deal NOT advanced before ack (still pending)", admin.table("deals").select("stage").eq("id", d_excl).execute().data[0]["stage"] == "pending")
        r7b = accept(token_c2, d_excl, acknowledge=True)
        b7b = r7b.json()
        check("exclusivity: acknowledged accept transitions to chatting", r7b.status_code == 200 and b7b.get("transitioned") is True and b7b.get("stage") == "chatting")

    finally:
        print()
        print("Cleaning up test data...")
        cleanup(ids)
        print("  done")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
