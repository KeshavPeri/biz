"""Smoke test: verify the backend can reach Supabase with the service_role key.

Run: python -m tests.test_connection   (from backend/)
"""

from core.supabase_client import get_supabase


def main() -> None:
    client = get_supabase()
    resp = client.table("profiles").select("id").limit(1).execute()
    print(f"PASS - connected to Supabase, profiles query returned {len(resp.data)} row(s)")


if __name__ == "__main__":
    main()
