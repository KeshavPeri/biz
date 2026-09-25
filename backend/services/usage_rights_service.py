"""Participant-safe, read-only cross-deal usage-rights projection.

This deliberately reuses the executed-source and UTC status code used by the
deliverable detail view.  It is a projection only: historical fallback reads
execution evidence but never materializes or repairs canonical rows.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from core.supabase_client import get_supabase
from services.deliverable_detail_service import _executed_source, _rights
from services.stage_engine import DealError

_MAX_DEALS = 100
_MAX_CHANNELS = 50
_MAX_DEAL_NAME = 160
_MAX_COUNTERPARTY_NAME = 160
_MAX_CHANNEL = 100
_SAFE_ROLES = {"creator", "brand_admin", "brand_maker", "brand_checker"}
_EXECUTED_STAGES = {"creating", "posted", "payment", "closed"}
_GENERIC_UNAVAILABLE = "Usage rights are temporarily unavailable. Please refresh."


def _unavailable() -> None:
    # Do not disclose whether a source, contract, or membership row was absent.
    raise DealError(409, _GENERIC_UNAVAILABLE)


def _safe_text(value: Any, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or any(ord(char) < 32 or ord(char) == 127 for char in value):
        _unavailable()
    return value


def _safe_date(value: Any, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str):
        _unavailable()
    try:
        if datetime.fromisoformat(value).date().isoformat() != value:
            _unavailable()
    except ValueError:
        _unavailable()
    return value


def _fact_payload(fact: dict[str, Any]) -> dict[str, Any]:
    """Narrow a canonical/fallback fact and reject impossible database values."""
    has_rights = fact.get("has_usage_rights")
    perpetual = fact.get("is_perpetual")
    channels = fact.get("channels")
    if not isinstance(has_rights, bool) or not isinstance(perpetual, bool) or not isinstance(channels, list) or len(channels) > _MAX_CHANNELS:
        _unavailable()
    clean_channels = [_safe_text(channel, _MAX_CHANNEL) for channel in channels]
    if len(set(clean_channels)) != len(clean_channels):
        _unavailable()
    start = _safe_date(fact.get("start_date"), nullable=True)
    end = _safe_date(fact.get("end_date"), nullable=True)
    status = fact.get("status")
    if not has_rights:
        if clean_channels or start is not None or end is not None or perpetual or status != "none":
            _unavailable()
        return {
            "rights_presence": "none", "channels": [], "start_date": None,
            "end_date": None, "is_perpetual": False, "status": "none",
        }
    if not start or not clean_channels:
        _unavailable()
    if perpetual:
        if end is not None or status != "perpetual":
            _unavailable()
    elif not end or start > end or status not in {"active", "expiring", "expired"}:
        _unavailable()
    return {
        "rights_presence": "present", "channels": clean_channels, "start_date": start,
        "end_date": end, "is_perpetual": perpetual, "status": status,
    }


def _unavailable_fact() -> dict[str, Any]:
    return {
        "rights_presence": "unavailable", "channels": [], "start_date": None,
        "end_date": None, "is_perpetual": False, "status": "unavailable",
    }


def _authorized_deals(client: Client, user_id: str) -> list[dict[str, Any]]:
    participants = client.table("deal_participants").select("deal_id,participant_role").eq(
        "profile_id", user_id
    ).limit(_MAX_DEALS + 1).execute().data
    if len(participants) > _MAX_DEALS:
        _unavailable()
    deal_roles: dict[str, str] = {}
    for participant in participants:
        deal_id, role = participant.get("deal_id"), participant.get("participant_role")
        if not isinstance(deal_id, str) or role not in _SAFE_ROLES or deal_id in deal_roles:
            _unavailable()
        deal_roles[deal_id] = role
    if not deal_roles:
        return []
    deals = client.table("deals").select(
        "id,deal_name,stage,creator_id,brand_id"
    ).in_("id", list(deal_roles)).is_("deleted_at", "null").limit(_MAX_DEALS + 1).execute().data
    if len(deals) > _MAX_DEALS or len({row.get("id") for row in deals}) != len(deals):
        _unavailable()

    active_brand_ids = {
        row.get("brand_id") for row in deals
        if isinstance(row.get("brand_id"), str) and deal_roles.get(row.get("id")) != "creator"
    }
    active_memberships: set[str] = set()
    if active_brand_ids:
        memberships = client.table("brand_members").select("brand_id").eq(
            "profile_id", user_id
        ).eq("status", "active").in_("brand_id", list(active_brand_ids)).limit(_MAX_DEALS + 1).execute().data
        active_memberships = {row.get("brand_id") for row in memberships if isinstance(row.get("brand_id"), str)}

    eligible: list[dict[str, Any]] = []
    for deal in deals:
        deal_id, role = deal.get("id"), deal_roles.get(deal.get("id"))
        if not isinstance(deal_id, str) or role is None:
            _unavailable()
        if role == "creator":
            if deal.get("creator_id") != user_id:
                continue
        elif deal.get("brand_id") not in active_memberships:
            # A stale/inactive brand participant fails closed, without exposing the deal.
            continue
        if deal.get("stage") in _EXECUTED_STAGES:
            eligible.append({**deal, "participant_role": role})
    return eligible


def _counterparty_names(client: Client, deals: list[dict[str, Any]], user_id: str) -> tuple[dict[str, str], dict[str, str]]:
    creator_ids = {row.get("creator_id") for row in deals if isinstance(row.get("creator_id"), str)}
    brand_ids = {row.get("brand_id") for row in deals if isinstance(row.get("brand_id"), str)}
    profiles = client.table("profiles").select("id,display_name").in_("id", list(creator_ids)).execute().data if creator_ids else []
    brands = client.table("brands").select("id,company_name").in_("id", list(brand_ids)).execute().data if brand_ids else []
    profile_names = {row.get("id"): _safe_text(row.get("display_name"), _MAX_COUNTERPARTY_NAME) for row in profiles}
    brand_names = {row.get("id"): _safe_text(row.get("company_name"), _MAX_COUNTERPARTY_NAME) for row in brands}
    for deal in deals:
        if deal.get("creator_id") == user_id:
            if deal.get("brand_id") not in brand_names:
                _unavailable()
        elif deal.get("creator_id") not in profile_names:
            _unavailable()
    return profile_names, brand_names


def get_usage_rights_snapshot(user_id: str, *, _client: Client | None = None, _now: datetime | None = None) -> dict[str, Any]:
    """Return one bounded, deterministic snapshot for the tracker and deal chips."""
    client = _client or get_supabase()
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    deals = _authorized_deals(client, user_id)
    profile_names, brand_names = _counterparty_names(client, deals, user_id)
    rows: list[dict[str, Any]] = []
    for deal in deals:
        deal_id = deal["id"]
        # This lookup happens only after participation and active membership gates.
        executed = client.table("contracts").select("id").eq("deal_id", deal_id).eq(
            "status", "executed"
        ).limit(2).execute().data
        if not executed:
            continue
        direction = "inbound" if deal.get("creator_id") == user_id else "outbound"
        counterparty = brand_names.get(deal.get("brand_id")) if direction == "inbound" else profile_names.get(deal.get("creator_id"))
        try:
            contract, summary = _executed_source(client, deal_id)
            fact = _fact_payload(_rights(client, deal_id, summary["id"], contract, summary, now.date().isoformat()))
        except (DealError, KeyError, TypeError, ValueError):
            fact = _unavailable_fact()
        rows.append({
            "deal_id": deal_id,
            "deal_name": _safe_text(deal.get("deal_name"), _MAX_DEAL_NAME),
            "counterparty_name": _safe_text(counterparty, _MAX_COUNTERPARTY_NAME),
            "direction": direction,
            "stage": _safe_text(deal.get("stage"), 32),
            **fact,
            "deal_path": f"/deal/{deal_id}",
        })
    rows.sort(key=lambda row: (row["deal_name"].casefold(), row["deal_id"]))
    if len(rows) > _MAX_DEALS or len({row["deal_id"] for row in rows}) != len(rows):
        _unavailable()
    return {"version": 1, "as_of": now.isoformat().replace("+00:00", "Z"), "deals": rows}
