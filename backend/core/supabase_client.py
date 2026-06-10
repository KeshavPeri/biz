"""Backend Supabase client — service_role key only. Bypasses RLS, so every
caller is responsible for enforcing its own access rules (see docs/api-architecture.md).
"""

from functools import lru_cache

from supabase import Client, create_client

from core.config import settings


@lru_cache
def get_supabase() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
