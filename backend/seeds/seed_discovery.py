"""Task 8.1 — Discovery mock data seed.

Populates the dev Supabase project with realistic FICTIONAL Indian creators
and brands for the Discovery placeholder to browse. All social stats are
mock values stored on our own tables (no live social API calls). Idempotent:
re-running first deletes every previously-seeded user (matched by the
@seed.inflo.test email domain) before reseeding, so the dev DB never
accumulates duplicates.

Run:
    backend/.venv/bin/python backend/seeds/seed_discovery.py
"""

from __future__ import annotations

import os
import random
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SEED_DOMAIN = "seed.inflo.test"
SEED_PASSWORD = "Seed2026!Inflo"

RNG = random.Random(42)

NUM_CREATORS = 15
NUM_BRANDS = 10

CITIES = [
    "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai",
    "Pune", "Kolkata", "Jaipur", "Ahmedabad", "Kochi",
]

NICHES = [
    "fashion", "beauty", "fitness", "food", "tech", "travel",
    "finance", "gaming", "parenting", "comedy", "education", "lifestyle",
]

LANGUAGES = ["Hindi", "English", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali"]

PLATFORMS = [
    "instagram", "tiktok", "youtube", "linkedin",
    "x", "pinterest", "threads", "podcast",
]

CONTENT_FORMATS = [
    "reel", "static_post", "story", "carousel", "yt_video", "yt_short",
    "blog", "ugc_photo", "podcast_read", "x_thread", "linkedin_post", "pinterest_pin",
]

AFFILIATION_TYPES = ["show", "award", "press", "podcast"]

CREATOR_NAMES = [
    "Ananya Rao", "Vikram Malhotra", "Priya Nair", "Rohan Kapoor", "Sneha Iyer",
    "Aditya Bhatt", "Kavya Menon", "Arjun Sethi", "Ishita Chawla", "Karan Oberoi",
    "Meera Pillai", "Yash Trivedi", "Riya Dsouza", "Nikhil Bose", "Tanya Ghosh",
]

BRAND_DEFS = [
    ("Zephyra Naturals", "Beauty & Personal Care"),
    ("Vridhi Foods", "Food & Beverage"),
    ("Trailhaus Apparel", "Fashion & D2C"),
    ("PaisaPilot", "Fintech"),
    ("Lernova Edtech", "Education"),
    ("Wanderloop Travel", "Travel"),
    ("Baseline Fitness Co.", "Fitness & Wellness"),
    ("Ripplekart", "D2C Marketplace"),
    ("Momento Snacks", "Food & Beverage"),
    ("Northstar Skincare", "Beauty & Personal Care"),
]

AFFILIATION_NAMES = [
    "MTV Roadies", "Zee Comedy Awards", "The Better India Feature",
    "IndiaTalks Podcast", "Cosmopolitan India Feature",
]

BRAND_PARTNERSHIP_NAMES = [
    "Nykaa", "boAt", "Zomato", "Swiggy", "Mamaearth", "CRED",
    "Lenskart", "Sugar Cosmetics", "Bewakoof", "Meesho",
]

# (label, follower_range, engagement_range)
FOLLOWER_TIERS = [
    ("nano", (1_000, 10_000), (6.0, 10.0)),
    ("micro", (10_000, 50_000), (4.0, 7.0)),
    ("mid", (50_000, 200_000), (3.0, 5.0)),
    ("macro", (200_000, 1_000_000), (1.5, 3.0)),
    ("mega", (1_000_000, 5_000_000), (1.0, 2.0)),
]
# 15 creators: mostly nano/micro/mid, a couple macro, at most one mega.
TIER_DISTRIBUTION = (
    ["nano"] * 4 + ["micro"] * 5 + ["mid"] * 4 + ["macro"] * 1 + ["mega"] * 1
)

RATE_TIER_BASE = {
    "nano": (2_000, 8_000),
    "micro": (8_000, 25_000),
    "mid": (25_000, 70_000),
    "macro": (70_000, 200_000),
    "mega": (200_000, 600_000),
}
FORMAT_PRICE_MULTIPLIER = {
    "reel": 1.0, "static_post": 0.7, "story": 0.4, "carousel": 0.85,
    "yt_video": 1.3, "yt_short": 0.9, "blog": 0.6, "ugc_photo": 0.5,
    "podcast_read": 1.1, "x_thread": 0.5, "linkedin_post": 0.6, "pinterest_pin": 0.4,
}


def paginated_list_users(admin: Client) -> list:
    users = []
    page = 1
    per_page = 50
    while True:
        resp = admin.auth.admin.list_users(page=page, per_page=per_page)
        if not resp:
            break
        users.extend(resp)
        if len(resp) < per_page:
            break
        page += 1
    return users


def cleanup_seed_users(admin: Client) -> None:
    seed_users = [u for u in paginated_list_users(admin) if u.email and u.email.endswith(f"@{SEED_DOMAIN}")]
    if not seed_users:
        return
    print(f"Cleaning up {len(seed_users)} previously-seeded user(s)...")
    profile_ids = [u.id for u in seed_users]
    members_resp = admin.table("brand_members").select("brand_id").in_("profile_id", profile_ids).execute()
    brand_ids = {m["brand_id"] for m in members_resp.data}
    for bid in brand_ids:
        admin.table("brands").delete().eq("id", bid).execute()
    for u in seed_users:
        admin.auth.admin.delete_user(u.id)


def pick_tier(i: int) -> tuple[str, tuple[int, int], tuple[float, float]]:
    label = TIER_DISTRIBUTION[i % len(TIER_DISTRIBUTION)]
    return next(t for t in FOLLOWER_TIERS if t[0] == label)


def build_social_handles(tier_label: str, follower_range: tuple, engagement_range: tuple) -> list[dict]:
    n = RNG.randint(1, 3)
    platforms = RNG.sample(PLATFORMS, n)
    handles = []
    for idx, platform in enumerate(platforms):
        followers = int(RNG.uniform(*follower_range))
        engagement = round(RNG.uniform(*engagement_range), 2)
        weekly_reach = int(followers * RNG.uniform(0.15, 0.45))
        handles.append(
            {
                "platform": platform,
                "handle": f"@{platform[:2]}handle{RNG.randint(100, 999)}",
                "follower_count": followers,
                "engagement_rate": engagement,
                "weekly_reach": weekly_reach,
                "is_primary": idx == 0,
                "verification_status": "verified" if RNG.random() < 0.8 else "pending",
            }
        )
    return handles


def build_rate_card_items(tier_label: str) -> list[dict]:
    lo, hi = RATE_TIER_BASE[tier_label]
    n = RNG.randint(2, 4)
    formats = RNG.sample(CONTENT_FORMATS, n)
    items = []
    for fmt in formats:
        base = RNG.uniform(lo, hi) * FORMAT_PRICE_MULTIPLIER[fmt]
        items.append(
            {
                "platform": RNG.choice(PLATFORMS),
                "content_format": fmt,
                "base_price": round(base, -2),
                "currency": "INR",
                "title": f"{fmt.replace('_', ' ').title()} package",
                "description": f"Standard {fmt.replace('_', ' ')} deliverable.",
            }
        )
    return items


def build_affiliations() -> list[dict]:
    n = RNG.randint(0, 2)
    chosen = RNG.sample(AFFILIATION_NAMES, min(n, len(AFFILIATION_NAMES)))
    return [
        {
            "type": RNG.choice(AFFILIATION_TYPES),
            "name": name,
            "year": RNG.randint(2021, 2026),
            "description": f"Featured as part of {name}.",
        }
        for name in chosen
    ]


def build_brand_partnerships() -> list[dict]:
    n = RNG.randint(0, 3)
    chosen = RNG.sample(BRAND_PARTNERSHIP_NAMES, min(n, len(BRAND_PARTNERSHIP_NAMES)))
    return [
        {
            "brand_name": name,
            "platform": RNG.choice(PLATFORMS) if RNG.random() < 0.7 else None,
            "views_reach": int(RNG.uniform(5_000, 500_000)),
            "year": RNG.randint(2022, 2026),
            "description": f"Sponsored collaboration with {name}.",
        }
        for name in chosen
    ]


def seed_creators(admin: Client) -> dict:
    counts = {
        "creators": 0, "social_handles": 0,
        "rate_cards_enabled": 0, "rate_cards_disabled": 0,
        "rate_card_items": 0, "affiliations": 0, "brand_partnerships": 0,
    }
    for i, name in enumerate(CREATOR_NAMES):
        slug = name.lower().replace(" ", ".")
        email = f"{slug}{i}@{SEED_DOMAIN}"
        user_resp = admin.auth.admin.create_user(
            {"email": email, "password": SEED_PASSWORD, "email_confirm": True}
        )
        profile_id = user_resp.user.id

        niches = RNG.sample(NICHES, RNG.randint(1, 3))
        languages = RNG.sample(LANGUAGES, RNG.randint(1, 3))
        if "English" not in languages and RNG.random() < 0.5:
            languages.append("English")

        admin.table("profiles").insert(
            {
                "id": profile_id,
                "account_type": "creator",
                "display_name": name,
                "email": email,
                "city": RNG.choice(CITIES),
                "profile_completeness": RNG.randint(80, 100),
            }
        ).execute()

        cp_resp = (
            admin.table("creator_profiles")
            .insert(
                {
                    "profile_id": profile_id,
                    "niches": niches,
                    "content_category": niches[0],
                    "bio": (
                        f"{name.split()[0]} creates {niches[0]} content for a growing "
                        f"community across India. Honest reviews, real results."
                    ),
                    "content_languages": languages,
                    "inbound_enabled": True,
                    "outbound_enabled": RNG.random() < 0.7,
                    "trust_score": round(RNG.uniform(3.5, 5.0), 1),
                    "deal_completion_rate": round(RNG.uniform(0.7, 1.0), 2),
                    "response_time_hours": round(RNG.uniform(1, 48), 1),
                    "privacy_settings": {
                        "contact_visible": RNG.random() < 0.6,
                        "rate_card_visible": True,
                        "handles_visible": True,
                    },
                }
            )
            .execute()
        )
        creator_id = cp_resp.data[0]["id"]
        counts["creators"] += 1

        tier_label, follower_range, engagement_range = pick_tier(i)
        handles = build_social_handles(tier_label, follower_range, engagement_range)
        for h in handles:
            admin.table("social_handles").insert({**h, "creator_id": creator_id}).execute()
            counts["social_handles"] += 1

        is_enabled = RNG.random() < 0.67
        rc_resp = (
            admin.table("rate_cards")
            .insert({"creator_id": creator_id, "is_enabled": is_enabled})
            .execute()
        )
        rate_card_id = rc_resp.data[0]["id"]
        counts["rate_cards_enabled" if is_enabled else "rate_cards_disabled"] += 1

        for item in build_rate_card_items(tier_label):
            admin.table("rate_card_items").insert({**item, "rate_card_id": rate_card_id}).execute()
            counts["rate_card_items"] += 1

        for aff in build_affiliations():
            admin.table("affiliations").insert({**aff, "creator_id": creator_id}).execute()
            counts["affiliations"] += 1

        for bp in build_brand_partnerships():
            admin.table("brand_partnerships").insert({**bp, "creator_id": creator_id}).execute()
            counts["brand_partnerships"] += 1

        print(f"  seeded creator {i + 1}/{NUM_CREATORS}: {name} ({tier_label})")

    return counts


def seed_brands(admin: Client) -> dict:
    counts = {"brands": 0}
    for i, (company_name, industry) in enumerate(BRAND_DEFS):
        admin_name = f"{company_name.split()[0]} Admin"
        email = f"admin.{company_name.lower().replace(' ', '.').replace('&', 'and')}{i}@{SEED_DOMAIN}"
        user_resp = admin.auth.admin.create_user(
            {"email": email, "password": SEED_PASSWORD, "email_confirm": True}
        )
        profile_id = user_resp.user.id

        admin.table("profiles").insert(
            {
                "id": profile_id,
                "account_type": "brand",
                "display_name": admin_name,
                "email": email,
                "city": RNG.choice(CITIES),
                "profile_completeness": RNG.randint(80, 100),
            }
        ).execute()

        domain = company_name.lower().replace(" ", "").replace("&", "and") + ".in"
        brand_resp = (
            admin.table("brands")
            .insert(
                {
                    "company_name": company_name,
                    "industry": industry,
                    "domain": domain,
                    "verified": RNG.random() < 0.6,
                    "trust_rating": round(RNG.uniform(3.5, 5.0), 1),
                    "deal_completion_rate": round(RNG.uniform(0.7, 1.0), 2),
                    "profile_attributes": {
                        "employee_range": RNG.choice(["1-10", "11-50", "51-200", "201-500"]),
                        "founded_year": RNG.randint(2014, 2023),
                        "hq_city": RNG.choice(CITIES),
                    },
                }
            )
            .execute()
        )
        brand_id = brand_resp.data[0]["id"]
        counts["brands"] += 1

        admin.table("brand_members").insert(
            {"brand_id": brand_id, "profile_id": profile_id, "brand_role": "admin", "status": "active"}
        ).execute()

        print(f"  seeded brand {i + 1}/{NUM_BRANDS}: {company_name}")

    return counts


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    cleanup_seed_users(admin)

    print(f"Seeding {NUM_CREATORS} creators...")
    creator_counts = seed_creators(admin)

    print(f"Seeding {NUM_BRANDS} brands...")
    brand_counts = seed_brands(admin)

    print()
    print("=" * 60)
    print("SEED SUMMARY")
    print(f"  creators:                {creator_counts['creators']}")
    print(f"  brands:                  {brand_counts['brands']}")
    print(f"  social_handles:          {creator_counts['social_handles']}")
    print(
        f"  rate_cards:              {creator_counts['rate_cards_enabled'] + creator_counts['rate_cards_disabled']} "
        f"(enabled={creator_counts['rate_cards_enabled']}, disabled={creator_counts['rate_cards_disabled']})"
    )
    print(f"  rate_card_items:         {creator_counts['rate_card_items']}")
    print(f"  affiliations:            {creator_counts['affiliations']}")
    print(f"  brand_partnerships:      {creator_counts['brand_partnerships']}")


if __name__ == "__main__":
    main()
