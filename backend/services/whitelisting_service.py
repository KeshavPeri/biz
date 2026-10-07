"""Canonical whitelisting materialization and participant-safe tracker projection."""

from __future__ import annotations

from datetime import date, datetime, timezone
import re
from typing import Any, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import (
    CHAT_PROMPT_VERSION_V3,
    CHAT_SCHEMA_VERSION_V3,
    credential_like_contract_text,
    normalise_contract_text,
    validate_chat_terms_row,
)

_MAX_DEALS = 100
_MAX_ARRANGEMENTS = 50
_MAX_NAME = 160
_MAX_ACCOUNT = 200
_SAFE_ROLES = {"creator", "brand_admin", "brand_maker", "brand_checker"}
_EXECUTED_STAGES = {"creating", "posted", "payment", "closed"}
_GENERIC_UNAVAILABLE = "Whitelisting arrangements are temporarily unavailable. Please refresh."
_PLATFORMS = {"instagram", "tiktok", "youtube", "linkedin", "x", "pinterest", "threads", "podcast"}
_DECIMAL = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")

_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "WHITELISTING_NOT_FOUND": (404, "This deal could not be found."),
    "WHITELISTING_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "WHITELISTING_WRONG_STAGE": (409, "Whitelisting can be initialized only while the signed deal enters Creating."),
    "WHITELISTING_UNTRUSTED_SOURCE": (409, "Whitelisting terms could not be verified safely. Nothing was changed."),
    "WHITELISTING_EXISTING_CONFLICT": (409, "Existing whitelisting evidence conflicts with the executed contract. Nothing was changed."),
    "WHITELISTING_INVALID_REQUEST": (409, "Whitelisting could not be initialized safely. Nothing was changed."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "Whitelisting could not be initialized safely. Nothing was changed.") from exc


def _unavailable() -> NoReturn:
    raise DealError(409, _GENERIC_UNAVAILABLE)


def _safe_text(value: Any, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _unavailable()
    return value


def _codepoints(value: str) -> tuple[int, ...]:
    return tuple(ord(character) for character in value)


def _executed_source(client: Client, deal_id: str) -> tuple[dict[str, Any], dict[str, Any], bool]:
    rows = client.table("contracts").select(
        "id,generated_from_summary_id,ai_summaries!inner(id,deal_id,status,schema_version,prompt_version)"
    ).eq("deal_id", deal_id).eq("status", "executed").eq("version", 1).limit(2).execute().data
    if len(rows) != 1:
        _unavailable()
    contract, summary = rows[0], rows[0].get("ai_summaries")
    if not isinstance(summary, dict) or summary.get("deal_id") != deal_id or summary.get("status") != "approved" or contract.get("generated_from_summary_id") != summary.get("id"):
        _unavailable()
    is_v3 = summary.get("schema_version") == CHAT_SCHEMA_VERSION_V3 and summary.get("prompt_version") == CHAT_PROMPT_VERSION_V3
    if is_v3:
        return contract, summary, True
    legacy_rows = client.table("ai_summaries").select(
        "structured_terms,schema_version,prompt_version"
    ).eq("id", summary["id"]).eq("deal_id", deal_id).eq("status", "approved").limit(2).execute().data
    if len(legacy_rows) != 1:
        _unavailable()
    try:
        validate_chat_terms_row(legacy_rows[0])
    except (TypeError, ValueError):
        _unavailable()
    return contract, summary, False


def _exact_rows(client: Client, deal_id: str, source_id: str) -> list[dict[str, Any]]:
    try:
        rows = client.rpc("project_whitelisting_exact", {
            "p_deal_id": deal_id, "p_source_summary_id": source_id,
        }).execute().data
    except Exception:
        _unavailable()
    if not isinstance(rows, list) or not 1 <= len(rows) <= _MAX_ARRANGEMENTS:
        _unavailable()
    expected: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {
            "has_whitelisting", "platform", "ad_account", "source_budget_text",
            "budget_currency", "start_date", "end_date", "arrangement_sequence",
            "canonical_present", "canonical_budget_text",
        }:
            _unavailable()
        enabled = row.get("has_whitelisting")
        sequence = row.get("arrangement_sequence")
        if not isinstance(enabled, bool) or not isinstance(sequence, int) or sequence != index + 1:
            if not (len(rows) == 1 and enabled is False and sequence == 0):
                _unavailable()
        budget = row.get("source_budget_text")
        canonical_budget = row.get("canonical_budget_text")
        currency = row.get("budget_currency")
        if budget is not None and (not isinstance(budget, str) or not _DECIMAL.fullmatch(budget)):
            _unavailable()
        if canonical_budget is not None and (not isinstance(canonical_budget, str) or not _DECIMAL.fullmatch(canonical_budget)):
            _unavailable()
        if (budget is None) != (currency is None) or (currency is not None and (not isinstance(currency, str) or not _CURRENCY.fullmatch(currency))):
            _unavailable()
        if not isinstance(row.get("canonical_present"), bool):
            _unavailable()
        if enabled:
            platform, account = row.get("platform"), row.get("ad_account")
            start, end = row.get("start_date"), row.get("end_date")
            if platform not in _PLATFORMS or not isinstance(account, str) or not 1 <= len(account) <= _MAX_ACCOUNT or account != account.strip() or credential_like_contract_text(account) or not isinstance(start, str) or not isinstance(end, str) or start > end:
                _unavailable()
        elif any(row.get(key) is not None for key in ("platform", "ad_account", "source_budget_text", "budget_currency", "start_date", "end_date")):
            _unavailable()
        expected.append({
            "has_whitelisting": enabled, "platform": row.get("platform"),
            "ad_account": row.get("ad_account"), "budget": budget,
            "canonical_budget": canonical_budget, "budget_currency": currency,
            "start_date": row.get("start_date"), "end_date": row.get("end_date"),
            "arrangement_sequence": sequence, "canonical_present": row["canonical_present"],
        })
    return expected


def _execution_evidence(client: Client, deal_id: str, contract_id: str, *, require_transition: bool) -> None:
    audits = client.table("audit_log").select("created_at,metadata").eq("entity_type", "deal").eq("entity_id", deal_id).eq("action", "contract_executed").contains("metadata", {"contract_id": contract_id}).limit(2).execute().data
    if len(audits) != 1 or not isinstance(audits[0].get("created_at"), str):
        _unavailable()
    try:
        executed_at = datetime.fromisoformat(audits[0]["created_at"].replace("Z", "+00:00"))
        if executed_at.tzinfo is None:
            _unavailable()
    except (TypeError, ValueError):
        _unavailable()
    if not require_transition:
        return
    transitions = client.table("deal_stage_transitions").select("created_at").eq("deal_id", deal_id).eq("from_stage", "approval").eq("to_stage", "creating").limit(2).execute().data
    if len(transitions) != 1 or not isinstance(transitions[0].get("created_at"), str):
        _unavailable()
    try:
        transitioned_at = datetime.fromisoformat(transitions[0]["created_at"].replace("Z", "+00:00"))
        if transitioned_at.tzinfo is None or executed_at > transitioned_at:
            _unavailable()
    except (TypeError, ValueError):
        _unavailable()


def _canonical_audits(client: Client, deal_id: str) -> list[dict[str, Any]]:
    return client.table("audit_log").select("id,metadata").eq("entity_type", "deal").eq("entity_id", deal_id).eq("action", "canonical_whitelisting_materialized").limit(2).execute().data


def _fact(client: Client, deal_id: str, contract: dict[str, Any], summary: dict[str, Any], is_v3: bool, today: str) -> tuple[str, list[dict[str, Any]]]:
    if not is_v3:
        return "unavailable", []
    expected = _exact_rows(client, deal_id, summary["id"])
    _execution_evidence(client, deal_id, contract["id"], require_transition=False)
    rows = client.table("whitelisting_arrangements").select(
        "source_summary_id,has_whitelisting,platform,ad_account,start_date,end_date,arrangement_sequence"
    ).eq("deal_id", deal_id).not_.is_("source_summary_id", "null").order("arrangement_sequence").limit(_MAX_ARRANGEMENTS + 1).execute().data
    audits = _canonical_audits(client, deal_id)
    expected_metadata = {
        "source_summary_id": summary["id"],
        "enabled": expected[0]["has_whitelisting"],
        "row_count": len(expected),
    }
    if rows:
        comparable = ("has_whitelisting", "platform", "ad_account", "start_date", "end_date", "arrangement_sequence")
        if len(rows) != len(expected) or len(audits) != 1 or audits[0].get("metadata") != expected_metadata or any(row.get("source_summary_id") != summary["id"] for row in rows) or any(any(actual.get(key) != wanted[key] for key in comparable) for actual, wanted in zip(rows, expected, strict=False)) or any(not wanted["canonical_present"] or wanted["canonical_budget"] != wanted["budget"] for wanted in expected):
            _unavailable()
    else:
        if audits or any(wanted["canonical_present"] for wanted in expected):
            _unavailable()
        _execution_evidence(client, deal_id, contract["id"], require_transition=True)
    if not expected[0]["has_whitelisting"]:
        return "not_enabled", []
    return "enabled", [{
        "platform": row["platform"], "account_label": row["ad_account"],
        "start_date": row["start_date"], "end_date": row["end_date"],
        "status": whitelisting_status(row["start_date"], row["end_date"], today),
        "budget": None if row["budget"] is None else {
            "amount": row["canonical_budget"] if rows else row["budget"],
            "currency": row["budget_currency"],
        },
    } for row in expected]


def _authorized_deals(client: Client, user_id: str) -> list[dict[str, Any]]:
    participants = client.table("deal_participants").select("deal_id,participant_role").eq("profile_id", user_id).limit(_MAX_DEALS + 1).execute().data
    if len(participants) > _MAX_DEALS:
        _unavailable()
    roles: dict[str, str] = {}
    for participant in participants:
        deal_id, role = participant.get("deal_id"), participant.get("participant_role")
        if not isinstance(deal_id, str) or role not in _SAFE_ROLES or deal_id in roles:
            _unavailable()
        roles[deal_id] = role
    if not roles:
        return []
    deals = client.table("deals").select("id,deal_name,stage,creator_id,brand_id").in_("id", list(roles)).is_("deleted_at", "null").limit(_MAX_DEALS + 1).execute().data
    if len(deals) > _MAX_DEALS or len({row.get("id") for row in deals}) != len(deals):
        _unavailable()
    brand_ids = {row.get("brand_id") for row in deals if roles.get(row.get("id")) != "creator" and isinstance(row.get("brand_id"), str)}
    memberships: set[str] = set()
    if brand_ids:
        membership_rows = client.table("brand_members").select("brand_id").eq("profile_id", user_id).eq("status", "active").in_("brand_id", list(brand_ids)).limit(_MAX_DEALS + 1).execute().data
        memberships = {row.get("brand_id") for row in membership_rows if isinstance(row.get("brand_id"), str)}
    eligible = []
    for deal in deals:
        role = roles.get(deal.get("id"))
        if role == "creator":
            if deal.get("creator_id") != user_id:
                continue
        elif deal.get("brand_id") not in memberships:
            continue
        if deal.get("stage") in _EXECUTED_STAGES:
            eligible.append(deal)
    return eligible


def materialize_for_creating_entry(client: Client, deal_id: str, actor_id: str, ip_address: str) -> dict[str, Any]:
    """Materialize exact v3 facts; valid v1/v2 contracts remain explicitly unmapped."""
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, actor_id) is None:
        raise DealError(403, "You're not part of this deal.")
    if deal["stage"] not in {"approval", "creating"}:
        raise DealError(409, "Whitelisting can be initialized only while the signed deal enters Creating.")
    try:
        _, summary, is_v3 = _executed_source(client, deal_id)
    except DealError as exc:
        raise DealError(409, "Whitelisting terms could not be verified safely. Nothing was changed.") from exc
    if not is_v3:
        return {"outcome": "legacy_unmapped", "idempotent": True, "deal_id": deal_id, "count": 0}
    try:
        return client.rpc("materialize_canonical_whitelisting", {"p_deal_id": deal_id, "p_source_summary_id": summary["id"], "p_actor_id": actor_id, "p_ip_address": ip_address}).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def whitelisting_status(start_date: str, end_date: str, today: str) -> str:
    start, end, current = date.fromisoformat(start_date), date.fromisoformat(end_date), date.fromisoformat(today)
    if current < start:
        return "upcoming"
    if current > end:
        return "expired"
    return "active"


def get_whitelisting_snapshot(user_id: str, *, _client: Client | None = None, _now: datetime | None = None) -> dict[str, Any]:
    """Return one bounded whitelisting fact for every authorized executed deal."""
    client = _client or get_supabase()
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    deals = _authorized_deals(client, user_id)
    creator_ids = {row.get("creator_id") for row in deals if isinstance(row.get("creator_id"), str)}
    brand_ids = {row.get("brand_id") for row in deals if isinstance(row.get("brand_id"), str)}
    creators = client.table("profiles").select("id,display_name").in_("id", list(creator_ids)).execute().data if creator_ids else []
    brands = client.table("brands").select("id,company_name").in_("id", list(brand_ids)).execute().data if brand_ids else []
    creator_names = {row.get("id"): _safe_text(row.get("display_name"), _MAX_NAME) for row in creators}
    brand_names = {row.get("id"): _safe_text(row.get("company_name"), _MAX_NAME) for row in brands}
    result: list[dict[str, Any]] = []
    rank = {"active": 0, "upcoming": 1, "expired": 2}
    for deal in deals:
        direction = "inbound" if deal.get("creator_id") == user_id else "outbound"
        counterparty = brand_names.get(deal.get("brand_id")) if direction == "inbound" else creator_names.get(deal.get("creator_id"))
        presence, arrangements = "unavailable", []
        try:
            if deal.get("creator_id") not in creator_names or deal.get("brand_id") not in brand_names:
                _unavailable()
            contract, summary, is_v3 = _executed_source(client, deal["id"])
            presence, arrangements = _fact(client, deal["id"], contract, summary, is_v3, now.date().isoformat())
            arrangements.sort(key=lambda row: (rank[row["status"]], row["start_date"], row["end_date"], normalise_contract_text(row["platform"]), _codepoints(row["platform"]), normalise_contract_text(row["account_label"]), _codepoints(row["account_label"]), "" if row["budget"] is None else row["budget"]["amount"], "" if row["budget"] is None else row["budget"]["currency"]))
        except (DealError, KeyError, TypeError, ValueError):
            presence, arrangements = "unavailable", []
        result.append({"deal_id": deal["id"], "deal_name": _safe_text(deal.get("deal_name"), _MAX_NAME), "counterparty_name": _safe_text(counterparty, _MAX_NAME), "direction": direction, "stage": _safe_text(deal.get("stage"), 32), "presence": presence, "arrangements": arrangements, "deal_path": f"/deal/{deal['id']}"})
    result.sort(key=lambda row: row["deal_id"])
    if len(result) > _MAX_DEALS or len({row["deal_id"] for row in result}) != len(result):
        _unavailable()
    return {"version": 1, "as_of": now.isoformat().replace("+00:00", "Z"), "deals": result}
