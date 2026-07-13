"""Phase 7 — auth + session RLS test.

Exercises the real Supabase Auth flow this cluster depends on, with realistic
fictional users (golden rule #4 — no placeholder behaviour):

  1. Create a verified user via the service_role admin (stands in for sign-up +
     OTP verify, which can't be received headlessly — and the anon /signup
     endpoint's email validator rejects reserved test domains). This mirrors the
     proven approach in test_rls.py.
  2. Sign in with the anon client to get a REAL authenticated session — the 7.4 path.
  3. From that authenticated session, INSERT the user's own `profiles` row
     (id = auth.uid()) — the path the app uses at role selection (7.5). This
     proves the `profiles_insert_own` RLS policy works from the client, not just
     service_role.
  4. Assert RLS still holds: the same client CANNOT insert a profile for someone
     else's id, and CANNOT see a deal it isn't a participant on.

Cleans up every user + row it creates. Run: python backend/tests/test_auth_session.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TEST_PASSWORD = "Diwali2026!Inflo"

# User A signs up through the app flow; User B is an unrelated creator whose deal
# A must not be able to see.
USER_A = {"email": "aanya.iyer@test-inflo.dev", "display_name": "Aanya Iyer", "city": "Pune"}
USER_B = {"email": "vikram.rao@test-inflo.dev", "display_name": "Vikram Rao", "city": "Chennai"}
BRAND_NAME = "Boat Lifestyle Brand Account"

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    """Remove data from a previous failed run, keyed on the fixed test emails."""
    emails = {USER_A["email"], USER_B["email"]}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Cleaning up {len(leftover)} leftover test user(s) from a previous run...")
    profile_ids = [u.id for u in leftover]
    deals_resp = admin.table("deals").select("id, brand_id").in_("created_by", profile_ids).execute()
    brand_ids = set()
    for d in deals_resp.data:
        admin.table("deals").delete().eq("id", d["id"]).execute()
        if d.get("brand_id"):
            brand_ids.add(d["brand_id"])
    for bid in brand_ids:
        admin.table("brands").delete().eq("id", bid).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    a_id: str | None = None
    b_id: str | None = None
    brand_id: str | None = None
    deal_id: str | None = None

    try:
        # 1. Create a verified User A (stands in for sign-up + OTP verify).
        a_resp = admin.auth.admin.create_user(
            {"email": USER_A["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        a_id = a_resp.user.id
        check("verified auth user is created", bool(a_id))
        print(f"Created verified User A (Aanya) -> {a_id}")

        # 2. Sign in with the anon client for a REAL authenticated session (7.4 path).
        client_a: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        auth_a = client_a.auth.sign_in_with_password(
            {"email": USER_A["email"], "password": TEST_PASSWORD}
        )
        check("verified user can sign in (real session)", auth_a.session is not None)
        print(f"Signed in as User A -> auth.uid() = {auth_a.user.id}")

        # 3. Insert A's OWN profile from the authenticated client (the 7.5 path).
        client_a.table("profiles").insert(
            {
                "id": a_id,
                "account_type": "creator",
                "display_name": USER_A["display_name"],
                "email": USER_A["email"],
                "city": USER_A["city"],
            }
        ).execute()
        own = client_a.table("profiles").select("*").eq("id", a_id).execute()
        check("authenticated client CAN insert + read its own profile", len(own.data) == 1)

        # 4a. RLS negative: A must NOT be able to insert a profile for another id.
        other_id = "00000000-0000-0000-0000-0000000000ff"
        insert_blocked = False
        try:
            client_a.table("profiles").insert(
                {
                    "id": other_id,
                    "account_type": "creator",
                    "display_name": "Not Allowed",
                    "email": "nope@test-inflo.dev",
                }
            ).execute()
        except Exception:
            # RLS WITH CHECK (id = auth.uid()) rejects it — supabase-py raises.
            insert_blocked = True
        check("RLS blocks inserting a profile for someone else's id", insert_blocked)

        # 4b. RLS scoping: build a deal for unrelated User B, assert A can't see it.
        b_resp = admin.auth.admin.create_user(
            {"email": USER_B["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        b_id = b_resp.user.id
        admin.table("profiles").insert(
            {
                "id": b_id,
                "account_type": "creator",
                "display_name": USER_B["display_name"],
                "email": USER_B["email"],
                "city": USER_B["city"],
            }
        ).execute()
        brand_id = admin.table("brands").insert(
            {"company_name": BRAND_NAME, "industry": "Consumer Electronics"}
        ).execute().data[0]["id"]
        deal_id = admin.table("deals").insert(
            {
                "creator_id": b_id,
                "brand_id": brand_id,
                "deal_name": "New Year Audio Gear Reels",
                "deal_type": "campaign",
                "direction": "inbound",
                "created_by": b_id,
            }
        ).execute().data[0]["id"]
        admin.table("deal_participants").insert(
            {"deal_id": deal_id, "profile_id": b_id, "participant_role": "creator"}
        ).execute()
        print(f"Created unrelated User B + deal {deal_id} (B is the only participant)")

        deals_seen_by_a = client_a.table("deals").select("*").eq("id", deal_id).execute()
        check("User A CANNOT see User B's deal (RLS scoped, 0 rows)", len(deals_seen_by_a.data) == 0)

    finally:
        print()
        print("Cleaning up test data...")
        if deal_id:
            admin.table("deals").delete().eq("id", deal_id).execute()
            print(f"  Deleted deal {deal_id} (cascades participants)")
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
            print(f"  Deleted brand {brand_id}")
        for uid in (a_id, b_id):
            if uid:
                admin.auth.admin.delete_user(uid)
                print(f"  Deleted user {uid} (cascades profile)")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
