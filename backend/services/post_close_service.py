"""Participant-safe post-close ratings, shared comments, and private notes."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from datetime import datetime
from typing import Any, Literal, NoReturn
from uuid import UUID

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _participant_role


_CONTROL_OR_MARKUP = re.compile(r"[\x00-\x1f\x7f<>]")
_UNSAFE_ENTRY_CONTROL_OR_MARKUP = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]")
_URL_LIKE = re.compile(r"(?:https?://|www\.|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:/|$))", re.I)
_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "POST_CLOSE_NOT_FOUND": (404, "This deal could not be found."),
    "POST_CLOSE_NOT_AUTHORIZED": (404, "This deal could not be found."),
    "POST_CLOSE_NOT_AVAILABLE": (409, "Post-deal actions are available only after this deal closes."),
    "POST_CLOSE_INVALID_RATING": (422, "Choose 1–5 stars and use a plain-text review of up to 1,000 characters."),
    "POST_CLOSE_INVALID_ENTRY": (422, "Enter plain text between 1 and 2,000 characters."),
    "POST_CLOSE_ALREADY_RATED": (409, "Your side has already submitted its final rating."),
    "POST_CLOSE_REQUEST_CONFLICT": (409, "That request identifier was already used for different content."),
    "POST_CLOSE_TRUST_TARGET_MISSING": (409, "The rating target could not be verified safely. Nothing was changed."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The post-deal request could not be applied safely. Nothing was changed.") from exc


def _fingerprint(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _request_uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise DealError(422, "Send a valid request identifier.")
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise DealError(422, "Send a valid request identifier.") from exc


def _deal_and_side(client: Client, deal_id: str, user_id: str) -> tuple[dict[str, Any], str]:
    rows = (
        client.table("deals")
        .select("id,stage,creator_id,brand_id,deal_name")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(404, "This deal could not be found.")
    deal = rows[0]
    deal_name = deal.get("deal_name")
    deal["deal_name"] = deal_name[:160] if isinstance(deal_name, str) else ""
    role = _participant_role(client, deal_id, user_id)
    if client.table("platform_ops_members").select("profile_id").eq(
        "profile_id", user_id
    ).eq("is_active", True).limit(1).execute().data:
        raise DealError(404, "This deal could not be found.")
    if role == "creator" and deal["creator_id"] == user_id:
        return deal, "creator"
    if role in {"brand_admin", "brand_maker", "brand_checker"} and client.table(
        "brand_members"
    ).select("profile_id").eq("brand_id", deal["brand_id"]).eq(
        "profile_id", user_id
    ).eq("status", "active").limit(1).execute().data:
        return deal, "brand"
    raise DealError(404, "This deal could not be found.")


def _require_closed(deal: dict[str, Any]) -> None:
    if deal.get("stage") != "closed":
        raise DealError(409, "Post-deal actions are available only after this deal closes.")


def _rating_projection(client: Client, deal: dict[str, Any], side: str) -> dict[str, Any]:
    rows = (
        client.table("ratings")
        .select("side,score,review,created_at")
        .eq("deal_id", deal["id"])
        .not_.is_("request_id", "null")
        .order("created_at")
        .limit(3)
        .execute()
        .data
    )
    safe_rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        row_side = row.get("side")
        if row_side not in {"creator", "brand"} or row_side in seen:
            raise DealError(409, "Rating status could not be verified safely.")
        score = row.get("score")
        review = row.get("review")
        created_at = row.get("created_at")
        if not isinstance(score, int) or not 1 <= score <= 5 or not isinstance(created_at, str):
            raise DealError(409, "Rating status could not be verified safely.")
        if review is not None and (not isinstance(review, str) or len(review) > 1000):
            raise DealError(409, "Rating status could not be verified safely.")
        seen.add(row_side)
        safe_rows.append({
            "side": row_side,
            "score": score,
            "review": review,
            "display_label": "Creator rated brand" if row_side == "creator" else "Brand rated creator",
            "created_at": created_at,
        })
    return {
        "deal_id": deal["id"],
        "ratings": safe_rows,
        "status": {"creator": "creator" in seen, "brand": "brand" in seen},
        "allowed_actions": {"can_rate": deal.get("stage") == "closed" and side not in seen},
    }


def get_ratings(deal_id: str, user_id: str, *, _client: Client | None = None) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, side = _deal_and_side(client, deal_id, user_id)
    _require_closed(deal)
    return _rating_projection(client, deal, side)


def submit_rating(
    deal_id: str,
    user_id: str,
    body: Any,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    _require_closed(deal)
    if not isinstance(body, dict) or set(body) != {"score", "review", "request_id"}:
        raise DealError(422, "Send exactly a score, optional review, and request identifier.")
    score = body.get("score")
    review = body.get("review")
    if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
        raise DealError(422, "Choose a rating from 1 to 5 stars.")
    if review is not None:
        if not isinstance(review, str):
            raise DealError(422, "The optional review must be plain text.")
        review = review.strip()
        if not review:
            review = None
        elif len(review) > 1000 or _CONTROL_OR_MARKUP.search(review) or _URL_LIKE.search(review):
            raise DealError(422, "Use plain text without links or markup, up to 1,000 characters.")
    request_id = _request_uuid(body.get("request_id"))
    payload = {"deal_id": deal_id, "actor_id": user_id, "score": score, "review": review}
    try:
        client.rpc("submit_deal_rating", {
            "p_deal_id": deal_id,
            "p_actor_id": user_id,
            "p_request_id": request_id,
            "p_request_fingerprint": _fingerprint(payload),
            "p_score": score,
            "p_review": review,
            "p_ip_address": ip_address,
        }).execute()
    except Exception as exc:
        _raise_rpc_error(exc)
    return _rating_projection(client, deal, _deal_and_side(client, deal_id, user_id)[1])


def _encode_cursor(created_at: str, entry_id: str) -> str:
    raw = json.dumps([created_at, entry_id], separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(value: str | None) -> tuple[str, str] | None:
    if value is None:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        if not isinstance(decoded, list) or len(decoded) != 2:
            raise ValueError
        timestamp = datetime.fromisoformat(str(decoded[0]).replace("Z", "+00:00"))
        entry_id = UUID(str(decoded[1]))
        return timestamp.isoformat(), str(entry_id)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as exc:
        raise DealError(422, "That page cursor is invalid. Refresh the feed and try again.") from exc


def get_entries(
    deal_id: str,
    user_id: str,
    visibility: Literal["shared", "private"],
    limit: int,
    cursor: str | None,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    _require_closed(deal)
    if visibility not in {"shared", "private"} or not 1 <= limit <= 50:
        raise DealError(422, "Choose a valid post-deal feed and page size.")
    query = (
        client.table("deal_comments")
        .select("id,author_id,body,visibility,created_at")
        .eq("deal_id", deal_id)
        .eq("visibility", visibility)
        .not_.is_("request_id", "null")
    )
    if visibility == "private":
        query = query.eq("author_id", user_id)
    decoded = _decode_cursor(cursor)
    if decoded:
        created_at, entry_id = decoded
        query = query.or_(f"created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{entry_id})")
    rows = query.order("created_at", desc=True).order("id", desc=True).limit(limit + 1).execute().data
    page = rows[:limit]
    author_ids = list({row["author_id"] for row in page if visibility == "shared"})
    profiles = client.table("profiles").select("id,display_name").in_("id", author_ids).execute().data if author_ids else []
    labels = {row["id"]: str(row.get("display_name") or "Participant")[:160] for row in profiles}
    entries = [{
        "id": row["id"],
        "body": row["body"],
        "visibility": visibility,
        "author_label": "You" if visibility == "private" or row["author_id"] == user_id else labels.get(row["author_id"], "Participant"),
        "created_at": row["created_at"],
    } for row in page]
    next_cursor = None
    if len(rows) > limit and page:
        next_cursor = _encode_cursor(page[-1]["created_at"], page[-1]["id"])
    return {"deal_id": deal_id, "visibility": visibility, "entries": entries, "next_cursor": next_cursor}


def append_entry(
    deal_id: str,
    user_id: str,
    body: Any,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, _ = _deal_and_side(client, deal_id, user_id)
    _require_closed(deal)
    if not isinstance(body, dict) or set(body) != {"visibility", "body", "request_id"}:
        raise DealError(422, "Send exactly a visibility, body, and request identifier.")
    visibility = body.get("visibility")
    text = body.get("body")
    if visibility not in {"shared", "private"} or not isinstance(text, str):
        raise DealError(422, "Choose shared comment or private note and enter plain text.")
    text = text.strip()
    if not 1 <= len(text) <= 2000 or _UNSAFE_ENTRY_CONTROL_OR_MARKUP.search(text):
        raise DealError(422, "Enter plain text between 1 and 2,000 characters.")
    request_id = _request_uuid(body.get("request_id"))
    payload = {"deal_id": deal_id, "actor_id": user_id, "visibility": visibility, "body": text}
    try:
        client.rpc("append_deal_post_close_entry", {
            "p_deal_id": deal_id,
            "p_actor_id": user_id,
            "p_request_id": request_id,
            "p_request_fingerprint": _fingerprint(payload),
            "p_visibility": visibility,
            "p_body": text,
        }).execute()
    except Exception as exc:
        _raise_rpc_error(exc)
    return get_entries(deal_id, user_id, visibility, 20, None, _client=client)
