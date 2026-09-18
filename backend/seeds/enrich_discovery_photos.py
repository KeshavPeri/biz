"""Opt-in development enrichment for the existing fictional Discovery creators.

Unlike seed_discovery.py, this never creates or deletes users. It only targets the
15 exact @seed.inflo.test creator records named in the checked-in photo manifest.

Run a safe validation first:
    APP_ENV=development backend/.venv/bin/python backend/seeds/enrich_discovery_photos.py --environment development --dry-run

Apply only after the dry-run has identified the intended development project:
    APP_ENV=development backend/.venv/bin/python backend/seeds/enrich_discovery_photos.py --environment development --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path(__file__).resolve().parent / "assets"
MANIFEST_PATH = ASSETS / "creator-photo-manifest.json"
BUCKET = "profile-photos"
SEED_DOMAIN = "seed.inflo.test"

load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class PhotoTarget:
    name: str
    email: str
    local_path: Path
    sha256: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add licensed photos to existing fictional Discovery creators.")
    parser.add_argument("--environment", choices=["development"], required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    return parser.parse_args()


def require_development_environment() -> tuple[str, str]:
    # Both the explicit CLI flag and checked-in environment gate must say development.
    # This is intentionally not a generic seeding entrypoint.
    if os.getenv("APP_ENV") != "development":
        raise RuntimeError("Refusing to run: APP_ENV must be exactly 'development'.")
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required from the development environment.")
    return url, service_key


def load_targets() -> list[PhotoTarget]:
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    targets: list[PhotoTarget] = []
    for index, item in enumerate(raw.get("photos", [])):
        name = item.get("seed_name")
        filename = item.get("file")
        digest = item.get("sha256")
        if not isinstance(name, str) or not isinstance(filename, str) or not isinstance(digest, str):
            raise RuntimeError(f"Manifest entry {index} is incomplete.")
        slug = name.lower().replace(" ", ".")
        targets.append(PhotoTarget(name, f"{slug}{index}@{SEED_DOMAIN}", ASSETS / filename, digest))
    if len(targets) != 15 or len({target.email for target in targets}) != 15:
        raise RuntimeError("Manifest must contain the 15 unique fictional creator targets.")
    return targets


def verify_local_assets(targets: list[PhotoTarget]) -> None:
    for target in targets:
        if not target.local_path.is_file():
            raise RuntimeError(f"Missing local photo: {target.local_path.name}")
        digest = hashlib.sha256(target.local_path.read_bytes()).hexdigest()
        if digest != target.sha256:
            raise RuntimeError(f"Checksum mismatch for {target.local_path.name}; download a reviewed asset again.")


def find_exact_seed_creators(admin: Client, targets: list[PhotoTarget]) -> dict[str, dict]:
    response = (
        admin.table("profiles")
        .select("id, email, display_name, account_type")
        .in_("email", [target.email for target in targets])
        .execute()
    )
    rows = response.data or []
    by_email = {row["email"]: row for row in rows}
    if len(by_email) != len(targets):
        missing = sorted(set(target.email for target in targets) - set(by_email))
        raise RuntimeError(f"Refusing partial enrichment: expected 15 exact sample creators; missing {', '.join(missing)}.")
    for target in targets:
        row = by_email[target.email]
        if row.get("account_type") != "creator" or row.get("display_name") != target.name:
            raise RuntimeError(f"Refusing unexpected account at {target.email}.")
    return by_email


def apply_target(admin: Client, target: PhotoTarget, profile: dict) -> str:
    profile_id = profile["id"]
    object_path = f"{profile_id}/discovery-primary.jpg"
    with target.local_path.open("rb") as image_file:
        admin.storage.from_(BUCKET).upload(
            object_path,
            image_file.read(),
            file_options={"content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"},
        )
    creator = admin.table("creator_profiles").update({"photo_carousel": [object_path]}).eq("profile_id", profile_id).execute()
    if not creator.data or creator.data[0].get("photo_carousel") != [object_path]:
        raise RuntimeError(f"No creator profile found for {target.email}; uploaded object remains safely profile-scoped.")
    updated_profile = admin.table("profiles").update({"avatar_url": object_path}).eq("id", profile_id).execute()
    if not updated_profile.data or updated_profile.data[0].get("avatar_url") != object_path:
        raise RuntimeError(f"Profile update failed for {target.email}.")
    return object_path


def main() -> int:
    args = parse_args()
    if args.environment != "development":  # Kept explicit if future choices are added.
        raise RuntimeError("Only development is permitted.")
    url, service_key = require_development_environment()
    targets = load_targets()
    verify_local_assets(targets)
    admin = create_client(url, service_key)
    profiles = find_exact_seed_creators(admin, targets)

    mode = "DRY RUN" if args.dry_run else "APPLY"
    print(f"{mode}: verified {len(targets)} exact fictional creator accounts in development.")
    for target in targets:
        profile = profiles[target.email]
        planned_path = f"{profile['id']}/discovery-primary.jpg"
        if args.dry_run:
            print(f"  would upload {target.local_path.name} -> {planned_path} ({target.email})")
        else:
            print(f"  uploaded {apply_target(admin, target, profile)} ({target.email})")
    print("Done. No users were created, deleted, or queried outside the 15 manifest accounts.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
