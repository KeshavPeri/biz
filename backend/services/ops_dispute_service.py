"""Authenticated platform-operations reads and dispute resume resolution."""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, NoReturn
from uuid import UUID

from supabase import Client

from core.supabase_client import get_supabase
from services.dispute_service import _public_text, safe_dispute_projection
from services.stage_engine import DealError


_DISPUTE_COLUMNS = (
    "id,deal_id,raised_by,description,evidence,status,created_at,resolved_at,"
    "resolution_note,raiser_role,raiser_side,resolved_by,request_fingerprint,prior_payment_state"
)
_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "PLATFORM_OPS_FORBIDDEN": (403, "Platform operations access is required."),
    "PLATFORM_OPS_DISPUTE_NOT_FOUND": (404, "This dispute could not be found."),
    "PLATFORM_OPS_DISPUTE_INVALID_REQUEST": (422, "Send a valid dispute resolution."),
    "PLATFORM_OPS_DISPUTE_STATE_INCONSISTENT": (
        409,
        "The dispute state is inconsistent. Nothing was changed.",
    ),
    "PLATFORM_OPS_DISPUTE_RESOLUTION_CONFLICT": (
        409,
        "This dispute resolution conflicts with an existing result.",
    ),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The dispute could not be resolved safely. Nothing was changed.") from exc


def require_active_ops(user_id: str, *, _client: Client | None = None) -> Client:
    """Return the service client only for an explicitly active ops member."""
    client = _client or get_supabase()
    rows = (
        client.table("platform_ops_members")
        .select("profile_id")
        .eq("profile_id", user_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(403, "Platform operations access is required.")
    return client


def _uuid(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise DealError(404, "This dispute could not be found.") from exc


def _encode_cursor(row: dict[str, Any]) -> str:
    payload = json.dumps(
        {"created_at": row["created_at"], "id": row["id"]},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True))
        if not isinstance(data, dict) or set(data) != {"created_at", "id"}:
            raise ValueError
        created_at = data["created_at"]
        if not isinstance(created_at, str) or len(created_at) > 64:
            raise ValueError
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        created_at = parsed.isoformat()
        dispute_id = str(UUID(data["id"]))
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DealError(422, "Send a valid queue cursor.") from exc
    return created_at, dispute_id


def _load_deals(client: Client, deal_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not deal_ids:
        return {}
    rows = (
        client.table("deals")
        .select("id,deal_name,stage,creator_id,is_disputed")
        .in_("id", list(deal_ids))
        .is_("deleted_at", "null")
        .execute()
        .data
    )
    return {row["id"]: row for row in rows}


def _load_names(client: Client, actor_ids: set[str]) -> dict[str, str]:
    if not actor_ids:
        return {}
    rows = client.table("profiles").select("id,display_name").in_("id", list(actor_ids)).execute().data
    return {row["id"]: row.get("display_name") for row in rows}


def _load_payment_states(client: Client, deal_ids: set[str]) -> dict[str, str]:
    if not deal_ids:
        return {}
    rows = (
        client.table("payments")
        .select("deal_id,state")
        .in_("deal_id", list(deal_ids))
        .not_.is_("source_summary_id", "null")
        .execute()
        .data
    )
    states: dict[str, str] = {}
    duplicates: set[str] = set()
    for row in rows:
        if row["deal_id"] in states:
            duplicates.add(row["deal_id"])
        states[row["deal_id"]] = row["state"]
    for deal_id in duplicates:
        states.pop(deal_id, None)
    return states


def _project(
    client: Client,
    row: dict[str, Any],
    deal: dict[str, Any],
    display_name: str | None,
    payment_state: str | None,
) -> dict[str, Any]:
    can_resolve = bool(
        row["status"] == "open"
        and row.get("request_fingerprint")
        and row.get("prior_payment_state")
        and deal["stage"] == "payment"
        and deal["is_disputed"]
        and payment_state == "disputed"
    )
    projection = safe_dispute_projection(
        client,
        deal,
        row,
        display_name=display_name,
        can_resolve=can_resolve,
        include_allowed_actions=True,
    )
    projection["deal"] = {
        "id": deal["id"],
        "display_name": _public_text(deal.get("deal_name"), "Deal", 160),
    }
    projection["stage"] = deal["stage"]
    return projection


def list_ops_disputes(
    user_id: str,
    *,
    status: str = "open",
    limit: int = 20,
    cursor: str | None = None,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = require_active_ops(user_id, _client=_client)
    if status != "open" or not 1 <= limit <= 50:
        raise DealError(422, "Request an open-dispute page between 1 and 50 items.")
    query = (
        client.table("disputes")
        .select(_DISPUTE_COLUMNS)
        .eq("status", "open")
        .order("created_at", desc=True)
        .order("id", desc=True)
    )
    if cursor is not None:
        created_at, dispute_id = _decode_cursor(cursor)
        query = query.or_(
            f"created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{dispute_id})"
        )
    rows = query.limit(limit + 1).execute().data
    page_rows = rows[:limit]
    deals = _load_deals(client, {row["deal_id"] for row in page_rows})
    if len(deals) != len({row["deal_id"] for row in page_rows}):
        raise DealError(409, "The dispute queue cannot be displayed safely.")
    names = _load_names(client, {row["raised_by"] for row in page_rows})
    payment_states = _load_payment_states(client, set(deals))
    return {
        "status": "open",
        "limit": limit,
        "disputes": [
            _project(
                client,
                row,
                deals[row["deal_id"]],
                names.get(row["raised_by"]),
                payment_states.get(row["deal_id"]),
            )
            for row in page_rows
        ],
        "next_cursor": _encode_cursor(page_rows[-1]) if len(rows) > limit else None,
    }


def get_ops_dispute(
    dispute_id: str,
    user_id: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = require_active_ops(user_id, _client=_client)
    normalized_id = _uuid(dispute_id)
    rows = (
        client.table("disputes")
        .select(_DISPUTE_COLUMNS)
        .eq("id", normalized_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(404, "This dispute could not be found.")
    row = rows[0]
    deals = _load_deals(client, {row["deal_id"]})
    if row["deal_id"] not in deals:
        raise DealError(404, "This dispute could not be found.")
    names = _load_names(client, {row["raised_by"]})
    payment_states = _load_payment_states(client, {row["deal_id"]})
    return _project(
        client,
        row,
        deals[row["deal_id"]],
        names.get(row["raised_by"]),
        payment_states.get(row["deal_id"]),
    )


def resolve_ops_dispute(
    dispute_id: str,
    user_id: str,
    outcome: str,
    resolution_note: str,
    request_id: str,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = require_active_ops(user_id, _client=_client)
    normalized_id = _uuid(dispute_id)
    try:
        result = client.rpc(
            "resolve_payment_dispute",
            {
                "p_dispute_id": normalized_id,
                "p_actor_id": user_id,
                "p_outcome": outcome,
                "p_resolution_note": resolution_note,
                "p_request_id": request_id,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    projection = get_ops_dispute(normalized_id, user_id, _client=client)
    return {
        "outcome": result["outcome"],
        "idempotent": bool(result["idempotent"]),
        "dispute": projection,
    }
