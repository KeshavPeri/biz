"""Phase 8 Discovery — Cluster B browse + detail RLS test.

Proves the Discovery reads behave under RLS exactly as the UI assumes:

  BROWSE
   • a BRAND can read creator_profiles + social_handles (creators are browsable).
   • a CREATOR can read brands (brands are browsable).

  DETAIL (fetch-creator-by-id, the embed used by fetchCreatorMediaKitById)
   • as a BRAND → the creator's public fields AND the enabled rate card + items.
   • as a DIFFERENT CREATOR → the same public fields but NO rate card (brand-only).

Confirms 8.3 relies on RLS, not client gating. Mirrors test_media_kit_rls.py's
self-contained fixture pattern; cleans up everything it creates.

Run: python backend/tests/test_discovery_rls.py
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

TEST_PASSWORD = "Monsoon2026!Inflo"

USERS = {
    "C1": {"email": "leela.rao@discovery-inflo.test", "display_name": "Leela Rao", "account_type": "creator", "city": "Mumbai"},
    "B": {"email": "sameer.jain@discovery-inflo.test", "display_name": "Sameer Jain", "account_type": "brand", "city": "Bengaluru"},
    "X": {"email": "otto.dsa@discovery-inflo.test", "display_name": "Otto Dsa", "account_type": "creator", "city": "Chennai"},
}
BRAND_NAME = "Lumen Wellness Brand Account"
DETAIL_SELECT = (
    "id, niches, profiles(display_name, city), "
    "social_handles(platform, follower_count), "
    "rate_cards(id, is_enabled, rate_card_items(id, base_price))"
)

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Cleaning up {len(leftover)} leftover test user(s)...")
    ids = [u.id for u in leftover]
    members = admin.table("brand_members").select("brand_id").in_("profile_id", ids).execute()
    for bid in {m["brand_id"] for m in members.data}:
        admin.table("brands").delete().eq("id", bid).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def signed_in(email: str) -> Client:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
    return c


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    user_ids: dict[str, str] = {}
    brand_id = None
    c1_creator_id = None

    try:
        for key, info in USERS.items():
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            user_ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {
                    "id": user_ids[k],
                    "account_type": v["account_type"],
                    "display_name": v["display_name"],
                    "email": v["email"],
                    "city": v["city"],
                }
                for k, v in USERS.items()
            ]
        ).execute()

        # Brand for B.
        brand_id = admin.table("brands").insert(
            {"company_name": BRAND_NAME, "industry": "Wellness", "verified": True, "trust_rating": 4.6}
        ).execute().data[0]["id"]
        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": user_ids["B"], "brand_role": "admin", "status": "active"}
        ).execute()

        # C1 creator: profile + enabled rate card + item + a social handle.
        c1_creator_id = admin.table("creator_profiles").insert(
            {"profile_id": user_ids["C1"], "niches": ["beauty"], "content_languages": ["English"], "bio": "Test."}
        ).execute().data[0]["id"]
        admin.table("social_handles").insert(
            {"creator_id": c1_creator_id, "platform": "instagram", "handle": "@leela", "follower_count": 48000, "is_primary": True, "verification_status": "verified"}
        ).execute()
        rc_id = admin.table("rate_cards").insert(
            {"creator_id": c1_creator_id, "is_enabled": True}
        ).execute().data[0]["id"]
        admin.table("rate_card_items").insert(
            {"rate_card_id": rc_id, "platform": "instagram", "content_format": "reel", "base_price": 35000, "currency": "INR", "title": "Reel"}
        ).execute()
        print("Set up C1 (creator + enabled rate card + handle), brand B, creator X.\n")

        client_b = signed_in(USERS["B"]["email"])
        client_x = signed_in(USERS["X"]["email"])

        # ── BROWSE ────────────────────────────────────────────────────────────
        b_creators = client_b.table("creator_profiles").select("id").eq("id", c1_creator_id).execute()
        check("Brand CAN browse creator_profiles (C1 visible)", len(b_creators.data) == 1)

        b_handles = client_b.table("social_handles").select("id").eq("creator_id", c1_creator_id).execute()
        check("Brand CAN read C1's social_handles", len(b_handles.data) >= 1)

        x_brands = client_x.table("brands").select("id").eq("id", brand_id).execute()
        check("Creator CAN browse brands (B's brand visible)", len(x_brands.data) == 1)

        # ── DETAIL (by-id embed, the fetchCreatorMediaKitById path) ────────────
        b_detail = client_b.table("creator_profiles").select(DETAIL_SELECT).eq("id", c1_creator_id).maybe_single().execute()
        b_row = b_detail.data or {}
        check("Detail as BRAND: creator public fields present", bool(b_row.get("id")) and len(b_row.get("social_handles", [])) >= 1)
        check("Detail as BRAND: enabled rate card + items returned", len(b_row.get("rate_cards", [])) == 1 and len(b_row["rate_cards"][0].get("rate_card_items", [])) == 1)

        x_detail = client_x.table("creator_profiles").select(DETAIL_SELECT).eq("id", c1_creator_id).maybe_single().execute()
        x_row = x_detail.data or {}
        check("Detail as OTHER CREATOR: creator public fields present", bool(x_row.get("id")) and len(x_row.get("social_handles", [])) >= 1)
        check("Detail as OTHER CREATOR: NO rate card (brand-only, RLS)", len(x_row.get("rate_cards", [])) == 0)

    finally:
        print()
        print("Cleaning up test data...")
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
        for key, uid in user_ids.items():
            admin.auth.admin.delete_user(uid)
            print(f"  Deleted user {key} ({uid})")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
