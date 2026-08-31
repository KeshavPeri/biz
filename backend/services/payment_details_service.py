"""Participant-safe payment-detail reads and side-owned atomic writes."""

from __future__ import annotations

import unicodedata
from typing import Any, Literal, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role


_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "PAYMENT_DETAILS_DEAL_NOT_FOUND": (404, "This deal could not be found."),
    "PAYMENT_DETAILS_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "PAYMENT_DETAILS_CREATOR_ONLY": (403, "Only the named creator can update creator payment details."),
    "PAYMENT_DETAILS_BRAND_ONLY": (403, "Only an active brand admin or maker can update brand billing details."),
    "PAYMENT_DETAILS_WRONG_STAGE": (409, "Payment details can only be changed while the deal is in Posted."),
    "PAYMENT_DETAILS_INVALID_VERSION": (422, "The expected payment-detail version is not valid."),
    "PAYMENT_DETAILS_INVALID_FIELDS": (422, "Check the payment-detail fields and try again."),
    "PAYMENT_DETAILS_STALE_VERSION": (409, "These payment details changed. Refresh and try again."),
}

_READABLE_STAGES = {"posted", "payment", "closed"}
_CREATOR_KEYS = {
    "expected_version",
    "creator_legal_name",
    "creator_bank_or_upi",
    "creator_tax_id",
}
_BRAND_KEYS = {
    "expected_version",
    "brand_billing_name",
    "brand_billing_address",
    "brand_gst",
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The payment details could not be updated safely. Nothing was changed.") from exc


def _has_control(value: str) -> bool:
    return any(unicodedata.category(character) == "Cc" for character in value)


def _required_text(body: dict[str, Any], key: str, maximum: int, label: str) -> str:
    value = body.get(key)
    if not isinstance(value, str):
        raise DealError(422, f"Enter {label}.")
    value = value.strip()
    if not value:
        raise DealError(422, f"Enter {label}.")
    if len(value) > maximum or _has_control(value):
        raise DealError(422, f"Check {label} and try again.")
    return value


def _optional_text(body: dict[str, Any], key: str, maximum: int, label: str) -> str | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise DealError(422, f"Check {label} and try again.")
    value = value.strip()
    if not value:
        return None
    if len(value) > maximum or _has_control(value):
        raise DealError(422, f"Check {label} and try again.")
    return value


def _expected_version(body: dict[str, Any]) -> int:
    value = body.get("expected_version")
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise DealError(422, "The expected payment-detail version is not valid.")
    return value


def _authorize(
    client: Client,
    deal_id: str,
    user_id: str,
    *,
    write_side: Literal["creator", "brand"] | None = None,
) -> tuple[dict[str, Any], str, bool]:
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")

    active_brand_actor = False
    if role in {"brand_admin", "brand_maker"}:
        active_brand_actor = bool(
            client.table("brand_members")
            .select("profile_id")
            .eq("brand_id", deal["brand_id"])
            .eq("profile_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )

    if write_side == "creator" and (role != "creator" or deal["creator_id"] != user_id):
        raise DealError(403, "Only the named creator can update creator payment details.")
    if write_side == "brand" and (role not in {"brand_admin", "brand_maker"} or not active_brand_actor):
        raise DealError(403, "Only an active brand admin or maker can update brand billing details.")
    if write_side is not None and deal["stage"] != "posted":
        raise DealError(409, "Payment details can only be changed while the deal is in Posted.")
    return deal, role, active_brand_actor


def _state(
    client: Client,
    deal: dict[str, Any],
    role: str,
    user_id: str,
    active_brand_actor: bool,
) -> dict[str, Any]:
    rows = (
        client.table("deal_payment_details")
        .select(
            "creator_legal_name,creator_bank_or_upi,creator_tax_id,"
            "brand_billing_name,brand_billing_address,brand_gst,"
            "creator_version,brand_version,creator_updated_at,brand_updated_at"
        )
        .eq("deal_id", deal["id"])
        .limit(1)
        .execute()
        .data
    )
    row = rows[0] if rows else {}
    creator_version = int(row.get("creator_version") or 0)
    brand_version = int(row.get("brand_version") or 0)
    creator_complete = creator_version > 0
    brand_complete = brand_version > 0
    editable = deal["stage"] == "posted"
    return {
        "deal_id": deal["id"],
        "stage": deal["stage"],
        "creator_legal_name": row.get("creator_legal_name"),
        "creator_bank_or_upi": row.get("creator_bank_or_upi"),
        "creator_tax_id": row.get("creator_tax_id"),
        "brand_billing_name": row.get("brand_billing_name"),
        "brand_billing_address": row.get("brand_billing_address"),
        "brand_gst": row.get("brand_gst"),
        "creator_version": creator_version,
        "brand_version": brand_version,
        "creator_complete": creator_complete,
        "brand_complete": brand_complete,
        "creator_updated_at": row.get("creator_updated_at"),
        "brand_updated_at": row.get("brand_updated_at"),
        "allowed_actions": {
            "can_edit_creator": editable and role == "creator" and deal["creator_id"] == user_id,
            "can_edit_brand": editable and active_brand_actor,
            "can_confirm_posts": editable and active_brand_actor and creator_complete and brand_complete,
        },
    }


def get_payment_details(
    deal_id: str,
    user_id: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, role, active_brand_actor = _authorize(client, deal_id, user_id)
    if deal["stage"] not in _READABLE_STAGES:
        raise DealError(409, "Payment details are not available until the deal reaches Posted.")
    return _state(client, deal, role, user_id, active_brand_actor)


def update_creator_details(
    deal_id: str,
    user_id: str,
    body: dict[str, Any],
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, role, active_brand_actor = _authorize(client, deal_id, user_id, write_side="creator")
    if set(body) != _CREATOR_KEYS:
        raise DealError(422, "Send exactly the creator payment-detail fields shown in the form.")
    expected_version = _expected_version(body)
    legal_name = _required_text(body, "creator_legal_name", 200, "the creator legal name")
    instruction = _required_text(body, "creator_bank_or_upi", 500, "the payment instruction")
    tax_id = _optional_text(body, "creator_tax_id", 64, "the optional creator tax identifier")
    try:
        outcome = client.rpc(
            "update_creator_payment_details",
            {
                "p_deal_id": deal_id,
                "p_actor_id": user_id,
                "p_expected_version": expected_version,
                "p_creator_legal_name": legal_name,
                "p_creator_bank_or_upi": instruction,
                "p_creator_tax_id": tax_id,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    state = _state(client, deal, role, user_id, active_brand_actor)
    state["outcome"] = {key: outcome[key] for key in ("side", "version", "complete", "idempotent")}
    return state


def update_brand_details(
    deal_id: str,
    user_id: str,
    body: dict[str, Any],
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, role, active_brand_actor = _authorize(client, deal_id, user_id, write_side="brand")
    if set(body) != _BRAND_KEYS:
        raise DealError(422, "Send exactly the brand payment-detail fields shown in the form.")
    expected_version = _expected_version(body)
    billing_name = _required_text(body, "brand_billing_name", 200, "the brand billing name")
    billing_address = _required_text(body, "brand_billing_address", 1000, "the brand billing address")
    gst = _optional_text(body, "brand_gst", 64, "the optional brand tax identifier")
    try:
        outcome = client.rpc(
            "update_brand_payment_details",
            {
                "p_deal_id": deal_id,
                "p_actor_id": user_id,
                "p_expected_version": expected_version,
                "p_brand_billing_name": billing_name,
                "p_brand_billing_address": billing_address,
                "p_brand_gst": gst,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    state = _state(client, deal, role, user_id, active_brand_actor)
    state["outcome"] = {key: outcome[key] for key in ("side", "version", "complete", "idempotent")}
    return state
