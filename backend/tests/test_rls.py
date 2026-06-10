"""Phase 5.8 — RLS smoke test.

Creates three throwaway users with the service_role client, wires up a deal
between two of them, then signs in as the anon client to confirm
deal_participants-based visibility on `deals` and `messages`. Cleans up
everything it created, including the auth users.

Run: python backend/tests/test_rls.py
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

TEST_PASSWORD = "Diwali2026!Biz"

TEST_USERS = {
    "A": {"email": "priya.sharma@test-biz.dev", "display_name": "Priya Sharma", "account_type": "creator", "city": "Mumbai"},
    "B": {"email": "rahul.mehta@test-biz.dev", "display_name": "Rahul Mehta", "account_type": "brand", "city": "Bengaluru"},
    "C": {"email": "sneha.kapoor@test-biz.dev", "display_name": "Sneha Kapoor", "account_type": "creator", "city": "Delhi"},
}
BRAND_NAME = "Zomato Brand Account"

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    """Remove data from a previous failed run, identified by the fixed test emails."""
    emails = {u["email"] for u in TEST_USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Found {len(leftover)} leftover test user(s) from a previous run — cleaning up first...")
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

    user_ids: dict[str, str] = {}
    deal_id = None
    brand_id = None

    try:
        # 1. Create three auth users
        for key, info in TEST_USERS.items():
            resp = admin.auth.admin.create_user(
                {
                    "email": info["email"],
                    "password": TEST_PASSWORD,
                    "email_confirm": True,
                    "user_metadata": {"display_name": info["display_name"]},
                }
            )
            user_ids[key] = resp.user.id
            print(f"Created user {key}: {info['display_name']} ({info['email']}) -> {resp.user.id}")

        # 2. Brand for User B
        brand_resp = admin.table("brands").insert({"company_name": BRAND_NAME, "industry": "Food Delivery"}).execute()
        brand_id = brand_resp.data[0]["id"]
        print(f"Created brand: {BRAND_NAME} -> {brand_id}")

        # 3. Profiles for all three users
        admin.table("profiles").insert(
            [
                {
                    "id": user_ids[key],
                    "account_type": info["account_type"],
                    "display_name": info["display_name"],
                    "email": info["email"],
                    "city": info["city"],
                }
                for key, info in TEST_USERS.items()
            ]
        ).execute()
        print("Created profiles for A, B, C")

        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()
        print("Linked User B to brand as admin")

        # 4. Deal between User A (creator) and User B's brand
        deal_resp = admin.table("deals").insert(
            {
                "creator_id": user_ids["A"],
                "brand_id": brand_id,
                "deal_name": "Diwali Festive Reels Campaign",
                "deal_type": "campaign",
                "direction": "inbound",
                "created_by": user_ids["A"],
            }
        ).execute()
        deal_id = deal_resp.data[0]["id"]
        print(f"Created deal: Diwali Festive Reels Campaign -> {deal_id}")

        admin.table("deal_participants").insert(
            [
                {"deal_id": deal_id, "profile_id": user_ids["A"], "participant_role": "creator"},
                {"deal_id": deal_id, "profile_id": user_ids["B"], "participant_role": "brand_admin"},
            ]
        ).execute()
        print("Added User A and User B as deal participants")

        # 5. Message on the deal
        admin.table("messages").insert(
            {
                "deal_id": deal_id,
                "sender_id": user_ids["A"],
                "body": "Hi Rahul, looking forward to the Diwali campaign brief!",
            }
        ).execute()
        print("Posted a message from User A on the deal")
        print()

        # 6. Sign in as User A (participant) and check visibility
        client_a = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        auth_a = client_a.auth.sign_in_with_password({"email": TEST_USERS["A"]["email"], "password": TEST_PASSWORD})
        print(f"Signed in as User A (Priya) -> auth.uid() = {auth_a.user.id}")

        deals_a = client_a.table("deals").select("*").eq("id", deal_id).execute()
        check("User A (creator/participant) CAN see the deal (1 row)", len(deals_a.data) == 1)

        messages_a = client_a.table("messages").select("*").eq("deal_id", deal_id).execute()
        check("User A (creator/participant) CAN see the message (1 row)", len(messages_a.data) == 1)

        # 7. Sign in as User C (unrelated) and check visibility
        client_c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        auth_c = client_c.auth.sign_in_with_password({"email": TEST_USERS["C"]["email"], "password": TEST_PASSWORD})
        print(f"Signed in as User C (Sneha) -> auth.uid() = {auth_c.user.id}")

        deals_c = client_c.table("deals").select("*").eq("id", deal_id).execute()
        check("User C (unrelated) CANNOT see the deal (0 rows)", len(deals_c.data) == 0)

        messages_c = client_c.table("messages").select("*").eq("deal_id", deal_id).execute()
        check("User C (unrelated) CANNOT see the message (0 rows)", len(messages_c.data) == 0)

    finally:
        print()
        print("Cleaning up test data...")
        if deal_id:
            admin.table("deals").delete().eq("id", deal_id).execute()
            print(f"  Deleted deal {deal_id} (cascades participants + messages)")
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
            print(f"  Deleted brand {brand_id} (cascades brand_members)")
        for key, uid in user_ids.items():
            admin.auth.admin.delete_user(uid)
            print(f"  Deleted user {key} ({uid}) (cascades profile)")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
