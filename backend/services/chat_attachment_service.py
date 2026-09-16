"""Backend-only five-minute signer for bound deal-chat attachments."""

from __future__ import annotations

from typing import Any

from core.supabase_client import get_supabase
from services.stage_engine import DealError

BUCKET = "deal-files"
SIGNED_URL_TTL_SECONDS = 300


def attachment_signed_url(
    deal_id: str,
    message_id: str,
    attachment_id: str,
    user_id: str,
) -> dict[str, Any]:
    """Issue one bounded URL after revalidating the complete current-access chain."""
    client = get_supabase()
    deal = (
        client.table("deals")
        .select("id")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .execute()
        .data
    )
    if not deal:
        raise DealError(404, "This attachment is unavailable.")
    participant = (
        client.table("deal_participants")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("profile_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not participant:
        raise DealError(403, "You no longer have access to this attachment.")
    message = (
        client.table("messages")
        .select("id")
        .eq("id", message_id)
        .eq("deal_id", deal_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    if not message:
        raise DealError(404, "This attachment is unavailable.")
    attachment = (
        client.table("message_attachments")
        .select("id,storage_path")
        .eq("id", attachment_id)
        .eq("message_id", message_id)
        .limit(1)
        .execute()
        .data
    )
    if not attachment:
        raise DealError(404, "This attachment is unavailable.")
    result = client.storage.from_(BUCKET).create_signed_url(
        attachment[0]["storage_path"],
        SIGNED_URL_TTL_SECONDS,
    )
    url = result.get("signedURL") or result.get("signedUrl")
    if not url:
        raise DealError(500, "A secure attachment link could not be created. Please try again.")
    return {"url": url, "expires_in": SIGNED_URL_TTL_SECONDS}
