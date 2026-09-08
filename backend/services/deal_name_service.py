"""Authenticated, audited deal-name boundary for B3-005."""

from __future__ import annotations

import unicodedata
from typing import Any

from postgrest.exceptions import APIError

from core.supabase_client import get_supabase
from services.stage_engine import DealError


_BIDI_FORMATTING = frozenset(
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
)

_ERRORS: tuple[tuple[str, int, str], ...] = (
    ("DEAL_NAME_NOT_FOUND", 404, "Deal not found."),
    ("DEAL_NAME_FORBIDDEN", 403, "You're not part of this deal."),
    ("DEAL_NAME_TERMINAL", 409, "This deal is read-only and can't be renamed."),
    ("DEAL_NAME_INVALID", 422, "Use a name between 1 and 160 characters without control formatting."),
    ("DEAL_NAME_STALE", 409, "Someone else renamed this deal. Review the latest name before saving again."),
)


def normalize_deal_name(value: str) -> str:
    """Return bounded plain display text, or a stable friendly validation error."""
    normalized = unicodedata.normalize("NFKC", value)
    if any(unicodedata.category(char) == "Cc" or char in _BIDI_FORMATTING for char in normalized):
        raise DealError(422, "Use a name without control or bidirectional formatting characters.")
    normalized = " ".join(normalized.split())
    if not 1 <= len(normalized) <= 160:
        raise DealError(422, "Use a name between 1 and 160 characters.")
    return normalized


def _rpc_error(exc: APIError) -> DealError:
    message = str(exc)
    for marker, status, detail in _ERRORS:
        if marker in message:
            return DealError(status, detail)
    return DealError(409, "This deal changed. Refresh and try again.")


def rename_deal(
    deal_id: str,
    actor_id: str,
    expected_version: int,
    deal_name: str,
    ip_address: str,
) -> dict[str, Any]:
    canonical_name = normalize_deal_name(deal_name)
    try:
        result = get_supabase().rpc(
            "apply_deal_name_rename",
            {
                "p_deal_id": deal_id,
                "p_actor_id": actor_id,
                "p_expected_version": expected_version,
                "p_deal_name": canonical_name,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except APIError as exc:
        raise _rpc_error(exc) from exc
    if not isinstance(result, dict):
        raise DealError(409, "This deal changed. Refresh and try again.")
    return {
        "deal_name": str(result["deal_name"]),
        "deal_name_version": int(result["deal_name_version"]),
        "idempotent": bool(result["idempotent"]),
    }
