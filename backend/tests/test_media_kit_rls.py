"""Phase 8 Discovery — media-kit RLS test.

Proves the rate-card visibility policies from 012_rls.sql behave exactly as the
media kit's client-side preview assumes — the REAL boundary, not the simulation:

  • A BRAND can read a creator's rate_cards + items ONLY when is_enabled = true.
  • The OWNER creator can read their own rate card (enabled OR disabled).
  • A DIFFERENT creator can read NEITHER (rate cards are brand-only).

Plus one owned-record check: a user cannot UPDATE another creator's
creator_profiles row (creator_profiles_update_own).

Realistic fictional data; mirrors the service_role-setup / anon-operate pattern
from test_rls.py. Cleans up every user/row it creates.

Run: python backend/tests/test_media_kit_rls.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TEST_PASSWORD = "Monsoon2026!Inflo"

# O1 = creator with an ENABLED rate card; O2 = creator with a DISABLED one.
# B = brand (the intended rate-card audience); X = unrelated creator.
USERS = {
    "O1": {"email": "aditi.rao@mediakit-inflo.test", "display_name": "Aditi Rao", "account_type": "creator", "city": "Mumbai"},
    "O2": {"email": "farah.khan@mediakit-inflo.test", "display_name": "Farah Khan", "account_type": "creator", "city": "Delhi"},
    "B": {"email": "rohit.verma@mediakit-inflo.test", "display_name": "Rohit Verma", "account_type": "brand", "city": "Bengaluru"},
    "X": {"email": "dev.pillai@mediakit-inflo.test", "display_name": "Dev Pillai", "account_type": "creator", "city": "Chennai"},
}
BRAND_NAME = "Glowdrop Skincare Brand Account"

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Cleaning up {len(leftover)} leftover test user(s) from a previous run...")
    profile_ids = [u.id for u in leftover]
    members = admin.table("brand_members").select("brand_id").in_("profile_id", profile_ids).execute()
    for bid in {m["brand_id"] for m in members.data}:
        admin.table("brands").delete().eq("id", bid).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def make_creator_with_rate_card(admin: Client, user_id: str, enabled: bool) -> str:
    """Create creator_profiles + a rate_card (enabled/disabled) + one item. Returns rate_card id."""
    cp = admin.table("creator_profiles").insert(
        {"profile_id": user_id, "niches": ["beauty"], "content_languages": ["English"], "bio": "Test creator."}
    ).execute()
    creator_id = cp.data[0]["id"]
    rc = admin.table("rate_cards").insert({"creator_id": creator_id, "is_enabled": enabled}).execute()
    rate_card_id = rc.data[0]["id"]
    admin.table("rate_card_items").insert(
        {
            "rate_card_id": rate_card_id,
            "platform": "instagram",
            "content_format": "reel",
            "base_price": 35000,
            "currency": "INR",
            "title": "Instagram Reel",
        }
    ).execute()
    return rate_card_id


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    user_ids: dict[str, str] = {}
    brand_id = None

    try:
        # 1. Auth users + profiles.
        for key, info in USERS.items():
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            user_ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {
                    "id": user_ids[key],
                    "account_type": info["account_type"],
                    "display_name": info["display_name"],
                    "email": info["email"],
                    "city": info["city"],
                }
                for key, info in USERS.items()
            ]
        ).execute()

        # 2. Brand for B.
        brand_id = admin.table("brands").insert({"company_name": BRAND_NAME, "industry": "Beauty"}).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()

        # 3. O1 (enabled) + O2 (disabled) rate cards.
        make_creator_with_rate_card(admin, user_ids["O1"], enabled=True)
        make_creator_with_rate_card(admin, user_ids["O2"], enabled=False)
        print("Set up O1 (enabled card), O2 (disabled card), brand B, creator X.\n")

        # Sign-in helper.
        def client_for(key: str) -> Client:
            c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
            c.auth.sign_in_with_password({"email": USERS[key]["email"], "password": TEST_PASSWORD})
            return c

        def read_cards(c: Client, owner_key: str) -> int:
            # Read via the owner's creator_profiles → rate_cards join, counting visible rows.
            cp = c.table("creator_profiles").select("id").eq("profile_id", user_ids[owner_key]).execute()
            if not cp.data:
                return 0
            creator_id = cp.data[0]["id"]
            return len(c.table("rate_cards").select("id, is_enabled").eq("creator_id", creator_id).execute().data)

        def read_items(c: Client, owner_key: str) -> int:
            cp = c.table("creator_profiles").select("id").eq("profile_id", user_ids[owner_key]).execute()
            if not cp.data:
                return 0
            creator_id = cp.data[0]["id"]
            cards = c.table("rate_cards").select("id").eq("creator_id", creator_id).execute().data
            if not cards:
                return 0
            card_ids = [r["id"] for r in cards]
            return len(c.table("rate_card_items").select("id").in_("rate_card_id", card_ids).execute().data)

        client_b = client_for("B")
        client_o1 = client_for("O1")
        client_o2 = client_for("O2")
        client_x = client_for("X")

        # 4. BRAND visibility.
        check("Brand CAN read O1's ENABLED rate card", read_cards(client_b, "O1") == 1)
        check("Brand CAN read O1's ENABLED rate-card items", read_items(client_b, "O1") == 1)
        check("Brand CANNOT read O2's DISABLED rate card (0 rows)", read_cards(client_b, "O2") == 0)
        check("Brand CANNOT read O2's DISABLED rate-card items (0 rows)", read_items(client_b, "O2") == 0)

        # 5. OWNER always sees own card.
        check("Owner O1 CAN read own (enabled) rate card", read_cards(client_o1, "O1") == 1)
        check("Owner O2 CAN read own (disabled) rate card", read_cards(client_o2, "O2") == 1)
        check("Owner O2 CAN read own (disabled) rate-card items", read_items(client_o2, "O2") == 1)

        # 6. OTHER creator sees neither (rate cards are brand-only).
        check("Creator X CANNOT read O1's rate card (brand-only, 0 rows)", read_cards(client_x, "O1") == 0)
        check("Creator X CANNOT read O1's rate-card items (0 rows)", read_items(client_x, "O1") == 0)

        # 7. Owned-record: X cannot UPDATE O1's creator_profiles row.
        cp_o1 = admin.table("creator_profiles").select("id").eq("profile_id", user_ids["O1"]).execute().data[0]["id"]
        blocked = False
        try:
            upd = (
                client_x.table("creator_profiles")
                .update({"bio": "hacked by X"})
                .eq("id", cp_o1)
                .execute()
            )
            # RLS makes the row invisible to the UPDATE → 0 rows affected (no error raised).
            blocked = len(upd.data) == 0
        except APIError:
            blocked = True
        # Confirm O1's bio is untouched.
        after = admin.table("creator_profiles").select("bio").eq("id", cp_o1).execute().data[0]["bio"]
        check("Creator X CANNOT update O1's creator_profiles row", blocked and after != "hacked by X")

    finally:
        print()
        print("Cleaning up test data...")
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
            print(f"  Deleted brand {brand_id} (cascades brand_members)")
        for key, uid in user_ids.items():
            admin.auth.admin.delete_user(uid)
            print(f"  Deleted user {key} ({uid}) (cascades profile + creator sub-tables)")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
