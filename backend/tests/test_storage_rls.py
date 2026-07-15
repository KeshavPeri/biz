"""Phase 8 Discovery — profile-photos Storage RLS test (B2-031).

Proves migration 016's owner-scoped write + public read behave as designed, using
raw bytes (no RN file handling needed):

  • Creator A CAN upload to `${A_id}/x.png` (owner-write, folder = auth.uid()).
  • Creator A CANNOT upload to `${B_id}/x.png` (016 owner-write policy blocks it).
  • The object is publicly readable (download returns bytes) — the public-read policy.

Mirrors test_media_kit_rls.py's service_role-setup / anon-operate pattern. Cleans
up the auth users AND the uploaded storage objects (objects aren't FK-cascaded).

Requires migration 016 applied. If the object doesn't upload even for the owner,
016 isn't applied — the test fails loudly rather than faking a pass.

Run: python backend/tests/test_storage_rls.py
"""

import base64
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
BUCKET = "profile-photos"

USERS = {
    "A": {"email": "asha.menon@storage-inflo.test", "display_name": "Asha Menon"},
    "B": {"email": "bio.kapoor@storage-inflo.test", "display_name": "Bir Kapoor"},
}

# A 1×1 transparent PNG — smallest valid image payload.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

results: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    results.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def cleanup_leftovers(admin: Client) -> None:
    emails = {u["email"] for u in USERS.values()}
    leftover = [u for u in admin.auth.admin.list_users() if u.email in emails]
    for u in leftover:
        # Remove any objects under the user's folder, then the user.
        try:
            existing = admin.storage.from_(BUCKET).list(u.id)
            if existing:
                admin.storage.from_(BUCKET).remove([f"{u.id}/{obj['name']}" for obj in existing])
        except Exception:
            pass
        admin.auth.admin.delete_user(u.id)
    if leftover:
        print(f"Cleaned up {len(leftover)} leftover test user(s).")


def signed_in(email: str) -> Client:
    c = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    c.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
    return c


def main() -> None:
    admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    cleanup_leftovers(admin)

    user_ids: dict[str, str] = {}
    uploaded_paths: list[str] = []

    try:
        for key, info in USERS.items():
            resp = admin.auth.admin.create_user(
                {"email": info["email"], "password": TEST_PASSWORD, "email_confirm": True}
            )
            user_ids[key] = resp.user.id
        admin.table("profiles").insert(
            [
                {
                    "id": user_ids[key],
                    "account_type": "creator",
                    "display_name": info["display_name"],
                    "email": info["email"],
                }
                for key, info in USERS.items()
            ]
        ).execute()

        client_a = signed_in(USERS["A"]["email"])
        client_b = signed_in(USERS["B"]["email"])

        a_id, b_id = user_ids["A"], user_ids["B"]
        own_path = f"{a_id}/own.png"
        intruder_path = f"{b_id}/from_a.png"

        # 1. A uploads into its OWN folder → allowed.
        own_ok = False
        try:
            client_a.storage.from_(BUCKET).upload(
                own_path, PNG_BYTES, {"content-type": "image/png"}
            )
            uploaded_paths.append(own_path)
            own_ok = True
        except Exception as e:  # noqa: BLE001 — surface the reason if 016 isn't applied
            print(f"  (owner upload failed — is migration 016 applied?) {e}")
        check("Creator A CAN upload to its own folder (owner-write)", own_ok)

        # 2. A uploads into B's folder → blocked by owner-write RLS.
        intruder_blocked = False
        try:
            client_a.storage.from_(BUCKET).upload(
                intruder_path, PNG_BYTES, {"content-type": "image/png"}
            )
            uploaded_paths.append(intruder_path)  # track for cleanup if it wrongly succeeded
        except Exception:
            intruder_blocked = True
        check("Creator A CANNOT upload to B's folder (016 blocks it)", intruder_blocked)

        # 3. Public read — a different signed-in user downloads A's object.
        public_read_ok = False
        if own_ok:
            try:
                downloaded = client_b.storage.from_(BUCKET).download(own_path)
                public_read_ok = isinstance(downloaded, (bytes, bytearray)) and len(downloaded) > 0
            except Exception as e:  # noqa: BLE001
                print(f"  (public read failed) {e}")
        check("A's object is publicly readable (download returns bytes)", public_read_ok)

    finally:
        print()
        print("Cleaning up test data...")
        for p in uploaded_paths:
            try:
                admin.storage.from_(BUCKET).remove([p])
            except Exception:
                pass
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
