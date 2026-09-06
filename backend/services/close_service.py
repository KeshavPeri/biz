"""Atomic mutual-close confirmation and participant-safe close status."""

from __future__ import annotations

from typing import Any, NoReturn
from uuid import UUID

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, GuardContext, _participant_role


_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "DEAL_CLOSE_DEAL_NOT_FOUND": (404, "This deal could not be found."),
    "DEAL_CLOSE_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "DEAL_CLOSE_NOT_AUTHORIZED": (403, "Your role can't confirm close for this deal."),
    "DEAL_CLOSE_NOT_AVAILABLE": (409, "Close confirmation is not available for this deal yet."),
    "DEAL_CLOSE_INVALID_REQUEST": (422, "Send exactly one valid close request identifier."),
    "DEAL_CLOSE_REQUEST_CONFLICT": (409, "That close request conflicts with an earlier confirmation. Refresh and review the current status."),
    "DEAL_CLOSE_PAYMENT_INCOMPLETE": (409, "Payment must be fully recorded and receipt-confirmed before closing."),
    "DEAL_CLOSE_DISPUTED": (409, "This deal can't close while a payment dispute is active."),
    "DEAL_CLOSE_CONFIRMATIONS_INCOMPLETE": (409, "Both sides must confirm before this deal can close."),
    "DEAL_CLOSE_CONCURRENT_CHANGE": (409, "This deal was just updated. Refresh and review its close status."),
    "DEAL_CLOSE_STATE_INCONSISTENT": (409, "Close status could not be verified safely. Nothing was changed."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The close request could not be applied safely. Nothing was changed.") from exc


def _load_deal(client: Client, deal_id: str) -> dict[str, Any]:
    rows = (
        client.table("deals")
        .select("id,stage,creator_id,brand_id,is_disputed")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(404, "This deal could not be found.")
    return rows[0]


def _active_brand_actor(client: Client, deal: dict[str, Any], user_id: str, role: str | None) -> bool:
    if role not in {"brand_admin", "brand_maker"}:
        return False
    return bool(
        client.table("brand_members")
        .select("profile_id")
        .eq("brand_id", deal["brand_id"])
        .eq("profile_id", user_id)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )


def _actor_side(
    client: Client,
    deal: dict[str, Any],
    user_id: str,
    role: str | None,
) -> str | None:
    if client.table("platform_ops_members").select("profile_id").eq(
        "profile_id", user_id
    ).eq("is_active", True).limit(1).execute().data:
        return None
    if role == "creator" and deal["creator_id"] == user_id:
        return "creator"
    if _active_brand_actor(client, deal, user_id, role):
        return "brand"
    return None


def _status_code(client: Client, deal_id: str) -> str:
    try:
        value = client.rpc("get_deal_close_status_code", {"p_deal_id": deal_id}).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    if not isinstance(value, str) or value not in {
        "ready",
        "payment_incomplete",
        "disputed_complete",
        "disputed_incomplete",
        "deal_not_found",
        "state_inconsistent",
    }:
        raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
    return value


def _confirmation_projection(client: Client, deal: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = (
        client.table("deal_close_confirmations")
        .select("side,actor_id,confirmed_at")
        .eq("deal_id", deal["id"])
        .order("confirmed_at")
        .limit(3)
        .execute()
        .data
    )
    if len(rows) > 2 or len({row.get("side") for row in rows}) != len(rows):
        raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
    actor_ids = [row.get("actor_id") for row in rows if isinstance(row.get("actor_id"), str)]
    profiles = []
    if actor_ids:
        profiles = client.table("profiles").select("id,display_name").in_("id", actor_ids).execute().data
    labels = {
        row["id"]: row.get("display_name")
        for row in profiles
        if isinstance(row.get("id"), str) and isinstance(row.get("display_name"), str)
    }
    projection: dict[str, dict[str, Any]] = {
        "creator": {"confirmed": False, "display_label": None, "confirmed_at": None},
        "brand": {"confirmed": False, "display_label": None, "confirmed_at": None},
    }
    for row in rows:
        side = row.get("side")
        actor_id = row.get("actor_id")
        confirmed_at = row.get("confirmed_at")
        if side not in projection or not isinstance(actor_id, str) or not isinstance(confirmed_at, str):
            raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
        if side == "creator" and actor_id != deal["creator_id"]:
            raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
        fallback = "Creator" if side == "creator" else "Brand representative"
        label = labels.get(actor_id) or fallback
        projection[side] = {
            "confirmed": True,
            "display_label": label[:160],
            "confirmed_at": confirmed_at,
        }
    return projection


def get_close_status(
    deal_id: str,
    user_id: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal = _load_deal(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    current_participant = role == "creator" and deal["creator_id"] == user_id
    if role in {"brand_admin", "brand_maker", "brand_checker"}:
        current_participant = bool(
            client.table("brand_members")
            .select("profile_id")
            .eq("brand_id", deal["brand_id"])
            .eq("profile_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )
    if not current_participant:
        raise DealError(404, "This deal could not be found.")

    empty_confirmations = {
        "creator": {"confirmed": False, "display_label": None, "confirmed_at": None},
        "brand": {"confirmed": False, "display_label": None, "confirmed_at": None},
    }
    if deal["stage"] not in {"payment", "closed"}:
        return {
            "available": False,
            "deal_id": deal["id"],
            "stage": deal["stage"],
            "reason": "not_yet_available",
            "payment_complete": False,
            "dispute_blocked": False,
            "confirmations": empty_confirmations,
            "allowed_actions": {"can_confirm": False},
        }

    status_code = _status_code(client, deal_id)
    if status_code in {"deal_not_found", "state_inconsistent"}:
        raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
    confirmations = _confirmation_projection(client, deal)
    confirmation_count = sum(1 for item in confirmations.values() if item["confirmed"])
    if (deal["stage"] == "closed" and confirmation_count != 2) or (
        deal["stage"] == "payment" and confirmation_count == 2
    ):
        raise DealError(409, "Close status could not be verified safely. Nothing was changed.")
    actor_side = _actor_side(client, deal, user_id, role)
    can_confirm = bool(
        deal["stage"] == "payment"
        and status_code == "ready"
        and actor_side is not None
        and not confirmations[actor_side]["confirmed"]
    )
    return {
        "available": True,
        "deal_id": deal["id"],
        "stage": deal["stage"],
        "payment_complete": status_code in {"ready", "disputed_complete"},
        "dispute_blocked": status_code in {"disputed_complete", "disputed_incomplete"},
        "confirmations": confirmations,
        "allowed_actions": {"can_confirm": can_confirm},
    }


def confirm_close(ctx: GuardContext) -> dict[str, Any]:
    if _actor_side(ctx.client, ctx.deal, ctx.user_id, ctx.role) is None:
        if ctx.client.table("platform_ops_members").select("profile_id").eq(
            "profile_id", ctx.user_id
        ).eq("is_active", True).limit(1).execute().data:
            raise DealError(403, "Your role can't confirm close for this deal.")
        if ctx.role in {"brand_admin", "brand_maker"}:
            raise DealError(404, "This deal could not be found.")
        raise DealError(403, "Your role can't confirm close for this deal.")
    body = ctx.params.get("close_body")
    if (
        not isinstance(body, dict)
        or set(body) != {"request_id"}
        or not isinstance(body.get("request_id"), str)
        or set(ctx.params) != {"close_body", "ip_address"}
    ):
        raise DealError(422, "Send exactly one valid close request identifier.")
    request_id = body["request_id"]
    try:
        request_id = str(UUID(request_id))
    except ValueError as exc:
        raise DealError(422, "Send exactly one valid close request identifier.") from exc
    try:
        outcome = ctx.client.rpc(
            "confirm_deal_close",
            {
                "p_deal_id": ctx.deal["id"],
                "p_actor_id": ctx.user_id,
                "p_request_id": request_id,
                "p_ip_address": ctx.params["ip_address"],
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    if not isinstance(outcome, dict) or set(outcome) != {
        "transitioned", "stage", "idempotent", "notifications_handled"
    }:
        raise DealError(409, "The close request returned an invalid result. Refresh and review its status.")
    status = get_close_status(ctx.deal["id"], ctx.user_id, _client=ctx.client)
    return {**outcome, "status": status}
