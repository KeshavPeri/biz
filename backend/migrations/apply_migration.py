"""One-off helper: apply a single migration file to the dev database via the
Supabase Management API (SUPABASE_ACCESS_TOKEN), since direct Postgres
connections via DATABASE_URL aren't reachable from this environment.

Usage: python _apply_migration.py 013_grants.sql
"""

import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[2]
load_dotenv(root / ".env")

supabase_url = os.environ["SUPABASE_URL"]
access_token = os.environ["SUPABASE_ACCESS_TOKEN"]
project_ref = re.search(r"https://([a-z0-9]+)\.supabase\.co", supabase_url).group(1)

migration_file = Path(__file__).resolve().parent / sys.argv[1]
sql = migration_file.read_text()

resp = httpx.post(
    f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
    headers={"Authorization": f"Bearer {access_token}"},
    json={"query": sql},
    timeout=60,
)
print(resp.status_code)
print(resp.text)
resp.raise_for_status()
print(f"Applied {migration_file.name}")
