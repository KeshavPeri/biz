"""Backend-only exclusivity materialization and participant-safe tracker projection."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import TermsExtractionV1, TermsExtractionV2, validate_chat_terms_row

_MAX_DEALS = 100
_MAX_NAME = 160
_MAX_CATEGORY = 200
_SAFE_ROLES = {"creator", "brand_admin", "brand_maker", "brand_checker"}
_EXECUTED_STAGES = {"creating", "posted", "payment", "closed"}
_GENERIC_UNAVAILABLE = "Exclusivity information is temporarily unavailable. Please refresh."

_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "EXCLUSIVITY_NOT_FOUND": (404, "This deal could not be found."),
    "EXCLUSIVITY_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "EXCLUSIVITY_WRONG_STAGE": (409, "Exclusivity can be initialized only while the signed deal enters Creating."),
    "EXCLUSIVITY_UNTRUSTED_SOURCE": (409, "The executed contract does not contain trusted exclusivity terms."),
    "EXCLUSIVITY_EXISTING_CONFLICT": (409, "Existing exclusivity evidence conflicts with the executed contract. Nothing was changed."),
    "EXCLUSIVITY_INVALID_REQUEST": (409, "Exclusivity could not be initialized safely. Nothing was changed."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "Exclusivity could not be initialized safely. Nothing was changed.") from exc


def _unavailable() -> NoReturn:
    raise DealError(409, _GENERIC_UNAVAILABLE)


TermsModel = TermsExtractionV1 | TermsExtractionV2


def _valid_terms(summary: dict[str, Any]) -> TermsModel:
    try:
        terms = validate_chat_terms_row(summary)
    except (TypeError, ValueError) as exc:
        raise DealError(409, "The executed contract does not contain trusted exclusivity terms.") from exc
    if terms.exclusivity.status != "found" or not isinstance(terms.exclusivity.value, bool):
        raise DealError(409, "The executed contract does not contain trusted exclusivity terms.")
    if terms.exclusivity.value and (
        terms.exclusivity_duration_days.status != "found"
        or not isinstance(terms.exclusivity_duration_days.value, int)
        or terms.exclusivity_category.status != "found"
        or not isinstance(terms.exclusivity_category.value, str)
    ):
        raise DealError(409, "The executed contract does not contain trusted exclusivity terms.")
    return terms


def _executed_source(client: Client, deal_id: str) -> tuple[dict[str, Any], dict[str, Any], TermsModel]:
    rows = client.table("contracts").select(
        "id,generated_from_summary_id,"
        "ai_summaries!inner(id,deal_id,status,structured_terms,schema_version,prompt_version)"
    ).eq("deal_id", deal_id).eq("status", "executed").eq("version", 1).limit(2).execute().data
    if len(rows) != 1:
        _unavailable()
    contract = rows[0]
    summary = contract.get("ai_summaries")
    if (
        not isinstance(summary, dict)
        or summary.get("deal_id") != deal_id
        or summary.get("status") != "approved"
        or contract.get("generated_from_summary_id") != summary.get("id")
    ):
        _unavailable()
    try:
        terms = _valid_terms(summary)
    except DealError:
        _unavailable()
    return contract, summary, terms


def _source_summary(client: Client, deal_id: str) -> dict[str, Any]:
    rows = client.table("contracts").select(
        "id,generated_from_summary_id,"
        "ai_summaries!inner(id,deal_id,status,structured_terms,schema_version,prompt_version)"
    ).eq("deal_id", deal_id).eq("status", "executed").eq("version", 1).limit(2).execute().data
    if len(rows) != 1:
        raise DealError(409, "The executed contract does not contain trusted exclusivity terms.")
    summary = rows[0].get("ai_summaries")
    if (
        not isinstance(summary, dict)
        or summary.get("deal_id") != deal_id
        or summary.get("status") != "approved"
        or rows[0].get("generated_from_summary_id") != summary.get("id")
    ):
        raise DealError(409, "The executed contract does not contain trusted exclusivity terms.")
    _valid_terms(summary)
    return summary


def materialize_for_creating_entry(client: Client, deal_id: str, actor_id: str, ip_address: str) -> dict[str, Any]:
    """Create the one source-bound exclusivity fact before Approval advances."""
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, actor_id) is None:
        raise DealError(403, "You're not part of this deal.")
    if deal["stage"] not in {"approval", "creating"}:
        raise DealError(409, "Exclusivity can be initialized only while the signed deal enters Creating.")
    summary = _source_summary(client, deal_id)
    try:
        return client.rpc("materialize_canonical_exclusivity_versioned", {
            "p_deal_id": deal_id,
            "p_source_summary_id": summary["id"],
            "p_actor_id": actor_id,
            "p_ip_address": ip_address,
            "p_schema_version": summary["schema_version"],
            "p_prompt_version": summary["prompt_version"],
        }).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def _safe_text(value: Any, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        _unavailable()
    return value


def _utc_date(value: Any) -> date:
    if not isinstance(value, str):
        _unavailable()
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if instant.tzinfo is None:
            _unavailable()
        return instant.astimezone(timezone.utc).date()
    except (TypeError, ValueError):
        _unavailable()


def _authorized_deals(client: Client, user_id: str) -> list[dict[str, Any]]:
    participants = client.table("deal_participants").select("deal_id,participant_role").eq(
        "profile_id", user_id
    ).limit(_MAX_DEALS + 1).execute().data
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
    deals = client.table("deals").select(
        "id,deal_name,stage,creator_id,brand_id"
    ).in_("id", list(roles)).is_("deleted_at", "null").limit(_MAX_DEALS + 1).execute().data
    if len(deals) > _MAX_DEALS or len({row.get("id") for row in deals}) != len(deals):
        _unavailable()

    brand_ids = {
        row.get("brand_id") for row in deals
        if roles.get(row.get("id")) != "creator" and isinstance(row.get("brand_id"), str)
    }
    memberships: set[str] = set()
    if brand_ids:
        membership_rows = client.table("brand_members").select("brand_id").eq(
            "profile_id", user_id
        ).eq("status", "active").in_("brand_id", list(brand_ids)).limit(_MAX_DEALS + 1).execute().data
        memberships = {row.get("brand_id") for row in membership_rows if isinstance(row.get("brand_id"), str)}

    eligible: list[dict[str, Any]] = []
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


def _execution_evidence(client: Client, deal_id: str, contract_id: str, *, require_transition: bool) -> date:
    audits = client.table("audit_log").select("created_at,metadata").eq(
        "entity_type", "deal"
    ).eq("entity_id", deal_id).eq("action", "contract_executed").contains(
        "metadata", {"contract_id": contract_id}
    ).limit(2).execute().data
    if len(audits) != 1:
        _unavailable()
    executed_on = _utc_date(audits[0].get("created_at"))
    if require_transition:
        transitions = client.table("deal_stage_transitions").select("created_at").eq(
            "deal_id", deal_id
        ).eq("from_stage", "approval").eq("to_stage", "creating").limit(2).execute().data
        if len(transitions) != 1:
            _unavailable()
        transition_at = transitions[0].get("created_at")
        if not isinstance(transition_at, str) or audits[0]["created_at"] > transition_at:
            _unavailable()
    return executed_on


def _expected_fact(client: Client, deal_id: str, contract: dict[str, Any], terms: TermsModel, *, fallback: bool) -> dict[str, Any]:
    start = _execution_evidence(client, deal_id, contract["id"], require_transition=fallback)
    has_exclusivity = terms.exclusivity.value
    if not has_exclusivity:
        return {"has_exclusivity": False, "category": None, "duration_days": None, "start_date": None, "end_date": None}
    duration = terms.exclusivity_duration_days.value
    category = terms.exclusivity_category.value
    if (
        not isinstance(duration, int) or not 1 <= duration <= 36500
        or not isinstance(category, str) or not 1 <= len(category) <= _MAX_CATEGORY
        or category != category.strip()
        or any(ord(char) < 32 or ord(char) == 127 for char in category)
    ):
        _unavailable()
    return {
        "has_exclusivity": True,
        "category": category,
        "duration_days": duration,
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=duration - 1)).isoformat(),
    }


def _fact(client: Client, deal_id: str, contract: dict[str, Any], summary: dict[str, Any], terms: TermsModel) -> dict[str, Any]:
    rows = client.table("exclusivity_clauses").select(
        "source_summary_id,has_exclusivity,category,duration_days,start_date,end_date"
    ).eq("deal_id", deal_id).not_.is_("source_summary_id", "null").limit(2).execute().data
    if rows:
        if len(rows) != 1 or rows[0].get("source_summary_id") != summary.get("id"):
            _unavailable()
        expected = _expected_fact(client, deal_id, contract, terms, fallback=False)
        if any(rows[0].get(key) != expected[key] for key in expected):
            _unavailable()
        return expected
    return _expected_fact(client, deal_id, contract, terms, fallback=True)


def exclusivity_status(end_date: str, today: str) -> str:
    end = date.fromisoformat(end_date)
    current = date.fromisoformat(today)
    if current > end:
        return "expired"
    if current >= end - timedelta(days=14):
        return "expiring"
    return "active"


def get_exclusivity_snapshot(user_id: str, *, _client: Client | None = None, _now: datetime | None = None) -> dict[str, Any]:
    """Return visible true clauses plus a bounded count of unverifiable deal facts."""
    client = _client or get_supabase()
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    deals = _authorized_deals(client, user_id)
    creator_ids = {row.get("creator_id") for row in deals if isinstance(row.get("creator_id"), str)}
    brand_ids = {row.get("brand_id") for row in deals if isinstance(row.get("brand_id"), str)}
    creators = client.table("profiles").select("id,display_name").in_("id", list(creator_ids)).execute().data if creator_ids else []
    brands = client.table("brands").select("id,company_name").in_("id", list(brand_ids)).execute().data if brand_ids else []
    creator_names = {row.get("id"): _safe_text(row.get("display_name"), _MAX_NAME) for row in creators}
    brand_names = {row.get("id"): _safe_text(row.get("company_name"), _MAX_NAME) for row in brands}

    visible: list[dict[str, Any]] = []
    unavailable_count = 0
    for deal in deals:
        try:
            if deal.get("creator_id") not in creator_names or deal.get("brand_id") not in brand_names:
                _unavailable()
            contract, summary, terms = _executed_source(client, deal["id"])
            fact = _fact(client, deal["id"], contract, summary, terms)
            if not fact["has_exclusivity"]:
                continue
            status = exclusivity_status(fact["end_date"], now.date().isoformat())
            visible.append({
                "deal_id": deal["id"],
                "deal_name": _safe_text(deal.get("deal_name"), _MAX_NAME),
                "brand_name": brand_names[deal["brand_id"]],
                "creator_name": creator_names[deal["creator_id"]],
                "category": fact["category"],
                "start_date": fact["start_date"],
                "end_date": fact["end_date"],
                "status": status,
                "deal_path": f"/deal/{deal['id']}",
            })
        except (DealError, KeyError, TypeError, ValueError):
            unavailable_count += 1
    rank = {"expiring": 0, "active": 1, "expired": 2}
    visible.sort(key=lambda row: (rank[row["status"]], row["end_date"], row["deal_id"]))
    if len(visible) > _MAX_DEALS or len({row["deal_id"] for row in visible}) != len(visible):
        _unavailable()
    return {
        "version": 1,
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "integrity_unavailable_count": unavailable_count,
        "clauses": visible,
    }
