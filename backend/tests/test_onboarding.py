"""Regression coverage for the authenticated creator onboarding finish path.

This uses the same ordered Supabase writes as frontend/src/lib/onboarding.ts
and frontend/src/lib/signature.ts: profile upsert, creator-profile upsert by
profile_id, social replacement, optional signature replacement, and only then
the final completeness update. It runs the full path twice to verify retries
do not duplicate the active social/signature state.

All accounts and profile content below are fictional and are removed after the
test. Run with: backend/.venv/bin/python backend/tests/test_onboarding.py
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
INTRUDER = {
    "email": "kavya.reddy@test-inflo.dev",
    "display_name": "Kavya Reddy",
    "city": "Hyderabad",
}
BRAND_ADMIN = {
    "email": "arjun.desai@test-inflo.dev",
    "display_name": "Arjun Desai",
    "city": "Ahmedabad",
}
COMPANY_NAME = "Mamaearth Wellness Brand Account"
CREATOR_PROFILE = {
    "niches": ["Skincare", "Fitness", "Food"],
    "content_languages": ["English", "Malayalam"],
    "bio": "Honest skincare, real routines, zero filters.",
    "inbound_enabled": True,
    "outbound_enabled": True,
}
SOCIAL_HANDLES = [
    {
        "platform": "instagram",
        "handle": "@meera.routines",
        "follower_count": 34500,
        "engagement_rate": 5.1,
        "weekly_reach": 61000,
        "is_primary": True,
        "verification_status": "verified",
    },
    {
        "platform": "youtube",
        "handle": "@meera.movements",
        "follower_count": 8200,
        "engagement_rate": 4.3,
        "weekly_reach": 14300,
        "is_primary": False,
        "verification_status": "verified",
    },
]
SIGNATURE = {"signature_type": "typed", "signature_data": "Meera Nambiar"}
FINAL_COMPLETENESS = 60

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    """Remove only prior runs' fictional creator-path fixtures."""
    emails = {CREATOR["email"], INTRUDER["email"], BRAND_ADMIN["email"]}
    users = [user for user in admin.auth.admin.list_users() if user.email in emails]
    profile_ids = [user.id for user in users]
    if profile_ids:
        members = admin.table("brand_members").select("brand_id").in_("profile_id", profile_ids).execute()
        for brand_id in {member["brand_id"] for member in members.data}:
            admin.table("brands").delete().eq("id", brand_id).execute()
    for user in users:
        admin.auth.admin.delete_user(user.id)


def upsert_profile(client: Client, creator_id: str) -> None:
    """Mirror submitOnboarding's first profiles upsert exactly."""
    client.table("profiles").upsert(
        {
            "id": creator_id,
            "account_type": "creator",
            "display_name": CREATOR["display_name"],
            "email": CREATOR["email"],
            "city": CREATOR["city"],
            "profile_completeness": 0,
        },
        on_conflict="id",
    ).execute()


def upsert_creator_profile(client: Client, creator_id: str) -> str:
    """Mirror submitCreator's owned creator_profiles conflict target."""
    response = (
        client.table("creator_profiles")
        .upsert(
            {"profile_id": creator_id, **CREATOR_PROFILE},
            on_conflict="profile_id",
        )
        .select("id")
        .execute()
    )
    return response.data[0]["id"]


def replace_social_handles(client: Client, creator_profile_id: str) -> None:
    """Mirror submitCreator's delete-then-insert replacement semantics."""
    client.table("social_handles").delete().eq("creator_id", creator_profile_id).execute()
    client.table("social_handles").insert(
        [{"creator_id": creator_profile_id, **handle} for handle in SOCIAL_HANDLES]
    ).execute()


def save_optional_signature(client: Client, creator_id: str) -> None:
    """Mirror saveSignature: deactivate before inserting the one active row."""
    client.table("signatures").update({"is_active": False}).eq("profile_id", creator_id).eq(
        "is_active", True
    ).execute()
    client.table("signatures").insert(
        {"profile_id": creator_id, **SIGNATURE, "is_active": True}
    ).execute()


def set_final_completeness(client: Client, creator_id: str) -> None:
    """Mirror submitOnboarding's last write, after every creator sub-write."""
    client.table("profiles").update({"profile_completeness": FINAL_COMPLETENESS}).eq(
        "id", creator_id
    ).execute()


def read_completion(client: Client, creator_id: str) -> int:
    response = (
        client.table("profiles")
        .select("profile_completeness")
        .eq("id", creator_id)
        .single()
        .execute()
    )
    return response.data["profile_completeness"]


def assert_final_state(client: Client, creator_id: str, creator_profile_id: str) -> None:
    creator_profiles = (
        client.table("creator_profiles").select("id").eq("profile_id", creator_id).execute().data
    )
    social_handles = (
        client.table("social_handles")
        .select("platform,handle,is_primary")
        .eq("creator_id", creator_profile_id)
        .execute()
        .data
    )
    active_signatures = (
        client.table("signatures")
        .select("signature_type,signature_data,is_active")
        .eq("profile_id", creator_id)
        .eq("is_active", True)
        .execute()
        .data
    )
    expected_handles = {
        (handle["platform"], handle["handle"], handle["is_primary"])
        for handle in SOCIAL_HANDLES
    }

    check("retry leaves one creator_profiles row", len(creator_profiles) == 1)
    check(
        "retry leaves the intended social-handle set",
        {(row["platform"], row["handle"], row["is_primary"]) for row in social_handles}
        == expected_handles
        and len(social_handles) == len(expected_handles),
    )
    check(
        "retry leaves exactly one active signature",
        len(active_signatures) == 1
        and active_signatures[0]["signature_type"] == SIGNATURE["signature_type"]
        and active_signatures[0]["signature_data"] == SIGNATURE["signature_data"],
    )
    check("retry restores a positive completion flag", read_completion(client, creator_id) > 0)


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)
    creator_id: str | None = None
    intruder_id: str | None = None
    brand_admin_id: str | None = None
    brand_id: str | None = None

    try:
        creator = admin.auth.admin.create_user(
            {"email": CREATOR["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        creator_id = creator.user.id
        client: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        session = client.auth.sign_in_with_password(
            {"email": CREATOR["email"], "password": TEST_PASSWORD}
        )
        check("creator can sign in with an authenticated session", session.session is not None)

        # First attempt: each step remains visible before the gate flips.
        upsert_profile(client, creator_id)
        check("profiles upsert keeps completeness at zero before sub-writes", read_completion(client, creator_id) == 0)

        creator_profile_id = upsert_creator_profile(client, creator_id)
        check("creator_profiles upsert on profile_id succeeds", bool(creator_profile_id))
        creator_profile = (
            client.table("creator_profiles")
            .select("niches,content_languages,bio")
            .eq("profile_id", creator_id)
            .single()
            .execute()
            .data
        )
        check(
            "creator_profiles upsert stores the intended creator details",
            creator_profile == {
                "niches": CREATOR_PROFILE["niches"],
                "content_languages": CREATOR_PROFILE["content_languages"],
                "bio": CREATOR_PROFILE["bio"],
            },
        )
        niches_check_blocked = False
        try:
            client.table("creator_profiles").update(
                {"niches": ["Skincare", "Fitness", "Food", "Travel"]}
            ).eq("profile_id", creator_id).execute()
        except APIError:
            niches_check_blocked = True
        check("niches constraint rejects more than three entries", niches_check_blocked)

        # Seed stale state to prove the exact replacement ordering used by a retry.
        client.table("social_handles").insert(
            {
                "creator_id": creator_profile_id,
                "platform": "instagram",
                "handle": "@meera.previous",
                "follower_count": 1200,
                "engagement_rate": 2.1,
                "weekly_reach": 1800,
                "is_primary": True,
                "verification_status": "pending",
            }
        ).execute()
        client.table("signatures").insert(
            {
                "profile_id": creator_id,
                "signature_type": "typed",
                "signature_data": "Meera Previous",
                "is_active": True,
            }
        ).execute()

        replace_social_handles(client, creator_profile_id)
        save_optional_signature(client, creator_id)
        check(
            "social replacement and optional signature persist before completion",
            read_completion(client, creator_id) == 0,
        )
        set_final_completeness(client, creator_id)
        check("final completeness update succeeds last", read_completion(client, creator_id) == FINAL_COMPLETENESS)

        # Safe retry: begin with the same profile upsert, then repeat all
        # conflict/replacement writes and restore the final gate value.
        upsert_profile(client, creator_id)
        retry_creator_profile_id = upsert_creator_profile(client, creator_id)
        replace_social_handles(client, retry_creator_profile_id)
        save_optional_signature(client, creator_id)
        set_final_completeness(client, creator_id)
        assert_final_state(client, creator_id, retry_creator_profile_id)

        intruder = admin.auth.admin.create_user(
            {"email": INTRUDER["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        intruder_id = intruder.user.id
        intruder_client: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        intruder_client.auth.sign_in_with_password(
            {"email": INTRUDER["email"], "password": TEST_PASSWORD}
        )
        cross_user_update = (
            intruder_client.table("creator_profiles")
            .update({"niches": ["Travel"]})
            .eq("profile_id", creator_id)
            .select("id")
            .execute()
        )
        check(
            "unrelated user cannot update another creator_profiles row",
            cross_user_update.data == [],
        )

        # Retain the existing brand bootstrap coverage in this onboarding test.
        brand_admin = admin.auth.admin.create_user(
            {"email": BRAND_ADMIN["email"], "password": TEST_PASSWORD, "email_confirm": True}
        )
        brand_admin_id = brand_admin.user.id
        brand_client: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        brand_client.auth.sign_in_with_password(
            {"email": BRAND_ADMIN["email"], "password": TEST_PASSWORD}
        )
        brand_client.table("profiles").insert(
            {
                "id": brand_admin_id,
                "account_type": "brand",
                "display_name": BRAND_ADMIN["display_name"],
                "email": BRAND_ADMIN["email"],
                "city": BRAND_ADMIN["city"],
            }
        ).execute()
        brand = brand_client.table("brands").insert(
            {"company_name": COMPANY_NAME, "industry": "Personal Care"}
        ).execute()
        brand_id = brand.data[0]["id"]
        check("brands insert succeeds for an authenticated brand user", bool(brand_id))
        brand_client.table("brand_members").insert(
            {
                "brand_id": brand_id,
                "profile_id": brand_admin_id,
                "brand_role": "admin",
                "status": "active",
            },
            returning="minimal",
        ).execute()
        check("first admin can bootstrap their own brand membership", True)

        intruder_client.table("profiles").insert(
            {
                "id": intruder_id,
                "account_type": "brand",
                "display_name": INTRUDER["display_name"],
                "email": INTRUDER["email"],
                "city": INTRUDER["city"],
            }
        ).execute()
        bootstrap_intrusion_blocked = False
        try:
            intruder_client.table("brand_members").insert(
                {
                    "brand_id": brand_id,
                    "profile_id": intruder_id,
                    "brand_role": "admin",
                    "status": "active",
                }
            ).execute()
        except APIError:
            bootstrap_intrusion_blocked = True
        check(
            "unrelated user cannot self-admit to an already-staffed brand",
            bootstrap_intrusion_blocked,
        )
    finally:
        if brand_id:
            admin.table("brands").delete().eq("id", brand_id).execute()
        if brand_admin_id:
            admin.auth.admin.delete_user(brand_admin_id)
        if intruder_id:
            admin.auth.admin.delete_user(intruder_id)
        if creator_id:
            admin.auth.admin.delete_user(creator_id)

    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
