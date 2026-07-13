"""Phase 7 Cluster B — onboarding RLS test.

Exercises the real writes the onboarding wizard depends on, with realistic
fictional users (golden rule #4 — no placeholder behaviour). Mirrors the
service_role-setup / anon-client-operates pattern from test_auth_session.py.

Requires migration 014_onboarding.sql to already be applied to the dev project
(creator_profiles.niches text[] + the CHECK <=3, and the brand_members
bootstrap RLS policy). Run: python backend/tests/test_onboarding.py

CREATOR PATH:
  1. Create + sign in a verified creator user (real anon session).
  2. Insert their own profiles row.
  3. Insert creator_profiles with niches (text[]) + content_languages + bio ->
     assert it succeeds and reads back correctly.
  4. Assert the niches <=3 CHECK constraint rejects a 4-element update.
  5. Insert a social_handles row with mock stats -> succeeds.

BRAND BOOTSTRAP PATH:
  6. Create + sign in verified brand User A. Insert a brand (brands_insert_
     authenticated), then insert their OWN brand_members admin row -> the
     bootstrap policy must ALLOW this (brand has no members yet).
  7. Create + sign in verified User B. B must NOT be able to insert an admin
     brand_members row into A's brand (brand now has a member, so the bootstrap
     policy no longer applies, and B isn't already an admin, so the normal
     admin-only policy blocks it too).

Cleans up every user/row/brand it creates.
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

TEST_PASSWORD = "Diwali2026!Inflo"

CREATOR = {
    "email": "meera.nambiar@test-inflo.dev",
    "display_name": "Meera Nambiar",
    "city": "Kochi",
}
BRAND_ADMIN_A = {
    "email": "arjun.desai@test-inflo.dev",
    "display_name": "Arjun Desai",
    "city": "Ahmedabad",
}
INTRUDER_B = {
    "email": "kavya.reddy@test-inflo.dev",
    "display_name": "Kavya Reddy",
    "city": "Hyderabad",
}
COMPANY_NAME = "Mamaearth Wellness Brand Account"

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    """Remove data from a previous failed run, keyed on the fixed test emails."""
    emails = {CREATOR["email"], BRAND_ADMIN_A["email"], INTRUDER_B["email"]}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    if not leftover:
        return
    print(f"Cleaning up {len(leftover)} leftover test user(s) from a previous run...")
    profile_ids = [u.id for u in leftover]
    members_resp = admin.table("brand_members").select("brand_id").in_("profile_id", profile_ids).execute()
    brand_ids = {m["brand_id"] for m in members_resp.data}
    for bid in brand_ids:
        admin.table("brands").delete().eq("id", bid).execute()
    for u in leftover:
        admin.auth.admin.delete_user(u.id)


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    creator_id: str | None = None
    admin_a_id: str | None = None
    intruder_b_id: str | None = None
    brand_id: str | None = None

    try:
        # ── CREATOR PATH ────────────────────────────────────────────────────
        creator_resp = admin.auth.admin.create_user(
            {"email": CREATOR["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        creator_id = creator_resp.user.id
        print(f"Created verified creator (Meera) -> {creator_id}")

        client_creator: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        auth_creator = client_creator.auth.sign_in_with_password(
            {"email": CREATOR["email"], "password": TEST_PASSWORD}
        )
        check("creator can sign in (real session)", auth_creator.session is not None)

        client_creator.table("profiles").insert(
            {
                "id": creator_id,
                "account_type": "creator",
                "display_name": CREATOR["display_name"],
                "email": CREATOR["email"],
                "city": CREATOR["city"],
            }
        ).execute()

        cp_resp = (
            client_creator.table("creator_profiles")
            .insert(
                {
                    "profile_id": creator_id,
                    "niches": ["Skincare", "Fitness", "Food"],
                    "content_languages": ["English", "Malayalam"],
                    "bio": "Honest skincare, real routines, zero filters.",
                    "inbound_enabled": True,
                    "outbound_enabled": True,
                }
            )
            .execute()
        )
        creator_profile_id = cp_resp.data[0]["id"] if cp_resp.data else None
        check("creator_profiles insert succeeds", bool(creator_profile_id))

        cp_read = (
            client_creator.table("creator_profiles")
            .select("niches, content_languages, bio")
            .eq("profile_id", creator_id)
            .single()
            .execute()
        )
        check(
            "creator_profiles reads back niches/languages/bio correctly",
            cp_read.data is not None
            and cp_read.data["niches"] == ["Skincare", "Fitness", "Food"]
            and cp_read.data["content_languages"] == ["English", "Malayalam"]
            and cp_read.data["bio"] == "Honest skincare, real routines, zero filters.",
        )

        # niches <= 3 CHECK constraint: a 4-element update must be rejected.
        niches_check_blocked = False
        try:
            client_creator.table("creator_profiles").update(
                {"niches": ["Skincare", "Fitness", "Food", "Travel"]}
            ).eq("profile_id", creator_id).execute()
        except APIError:
            niches_check_blocked = True
        check("niches <=3 CHECK constraint rejects a 4-element array", niches_check_blocked)

        sh_resp = (
            client_creator.table("social_handles")
            .insert(
                {
                    "creator_id": creator_profile_id,
                    "platform": "instagram",
                    "handle": "@meera.skincare",
                    "follower_count": 34500,
                    "engagement_rate": 5.1,
                    "weekly_reach": 61000,
                    "is_primary": True,
                    "verification_status": "verified",
                }
            )
            .execute()
        )
        check("social_handles insert with mock stats succeeds", len(sh_resp.data) == 1)

        # ── BRAND BOOTSTRAP PATH ────────────────────────────────────────────
        admin_a_resp = admin.auth.admin.create_user(
            {"email": BRAND_ADMIN_A["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        admin_a_id = admin_a_resp.user.id
        print(f"Created verified brand admin (Arjun) -> {admin_a_id}")

        client_a: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        client_a.auth.sign_in_with_password({"email": BRAND_ADMIN_A["email"], "password": TEST_PASSWORD})

        client_a.table("profiles").insert(
            {
                "id": admin_a_id,
                "account_type": "brand",
                "display_name": BRAND_ADMIN_A["display_name"],
                "email": BRAND_ADMIN_A["email"],
                "city": BRAND_ADMIN_A["city"],
            }
        ).execute()

        brand_resp = (
            client_a.table("brands")
            .insert({"company_name": COMPANY_NAME, "industry": "Personal Care"})
            .execute()
        )
        brand_id = brand_resp.data[0]["id"] if brand_resp.data else None
        check("brands insert (brands_insert_authenticated) succeeds", bool(brand_id))

        # NOTE: returning="minimal" (no RETURNING clause) is required here — the
        # inserting user doesn't satisfy brand_members_read_same_brand's SELECT
        # policy until AFTER this row exists, and requesting the default
        # representation (RETURNING *) makes Postgres evaluate that SELECT policy
        # against the new row as part of the same statement, which raises 42501
        # even though the INSERT's own WITH CHECK legitimately passes. The real
        # app code (lib/onboarding.ts) never chains .select() after this insert,
        # so supabase-js already defaults to return=minimal and is unaffected —
        # this is a supabase-py .execute() default-representation quirk.
        bootstrap_ok = False
        try:
            client_a.table("brand_members").insert(
                {"brand_id": brand_id, "profile_id": admin_a_id, "brand_role": "admin", "status": "active"},
                returning="minimal",
            ).execute()
            bootstrap_ok = True
        except APIError as e:
            print(f"  (unexpected) bootstrap insert failed: {e}")
        check("first admin CAN bootstrap their own brand_members row (memberless brand)", bootstrap_ok)

        # ── INTRUDER PATH ───────────────────────────────────────────────────
        intruder_resp = admin.auth.admin.create_user(
            {"email": INTRUDER_B["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        intruder_b_id = intruder_resp.user.id
        print(f"Created verified intruder (Kavya) -> {intruder_b_id}")

        client_b: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        client_b.auth.sign_in_with_password({"email": INTRUDER_B["email"], "password": TEST_PASSWORD})
        client_b.table("profiles").insert(
            {
                "id": intruder_b_id,
                "account_type": "brand",
                "display_name": INTRUDER_B["display_name"],
                "email": INTRUDER_B["email"],
                "city": INTRUDER_B["city"],
            }
        ).execute()

        intruder_blocked = False
        try:
            client_b.table("brand_members").insert(
                {"brand_id": brand_id, "profile_id": intruder_b_id, "brand_role": "admin", "status": "active"}
            ).execute()
        except APIError:
            intruder_blocked = True
        check(
            "unrelated user CANNOT self-admit as admin into an already-staffed brand",
            intruder_blocked,
        )

    finally:
        print()
        print("Cleaning up test data...")
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
            print(f"  Deleted brand {brand_id} (cascades brand_members)")
        for uid in (creator_id, admin_a_id, intruder_b_id):
            if uid:
                admin.auth.admin.delete_user(uid)
                print(f"  Deleted user {uid} (cascades profile/creator_profiles/social_handles)")

    print()
    print("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
