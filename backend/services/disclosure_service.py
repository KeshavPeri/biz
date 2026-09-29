"""Backend-only disclosure materialization and participant-safe tracker reads."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.deliverable_service import PLATFORM_MAP
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import (
    TermsExtractionV1,
    TermsExtractionV2,
    TermsExtractionV3,
    normalise_contract_text,
    validate_chat_terms_row,
)

_MAX_DEALS = 100
_MAX_DELIVERABLES = 100
_MAX_RULES = 50
_MAX_NAME = 160
_MAX_RULE = 500
_SAFE_ROLES = {"creator", "brand_admin", "brand_maker", "brand_checker"}
_EXECUTED_STAGES = {"creating", "posted", "payment", "closed"}
_DATABASE_PLATFORMS = frozenset(PLATFORM_MAP.values())
_GENERIC_UNAVAILABLE = "Disclosure requirements are temporarily unavailable. Please refresh."

_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "DISCLOSURE_NOT_FOUND": (404, "This deal could not be found."),
    "DISCLOSURE_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "DISCLOSURE_WRONG_STAGE": (409, "Disclosures can be initialized only while the signed deal enters Creating."),
    "DISCLOSURE_UNTRUSTED_SOURCE": (409, "Disclosure requirements could not be verified safely. Nothing was changed."),
    "DISCLOSURE_INVALID_DELIVERABLES": (409, "Disclosure requirements could not be matched to the deliverable plan. Nothing was changed."),
    "DISCLOSURE_EXISTING_CONFLICT": (409, "Existing disclosure evidence conflicts with the executed contract. Nothing was changed."),
    "DISCLOSURE_INVALID_REQUEST": (409, "Disclosure requirements could not be initialized safely. Nothing was changed."),
}

TermsModel = TermsExtractionV1 | TermsExtractionV2 | TermsExtractionV3


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "Disclosure requirements could not be initialized safely. Nothing was changed.") from exc


def _unavailable() -> NoReturn:
    raise DealError(409, _GENERIC_UNAVAILABLE)


def _safe_text(value: Any, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        _unavailable()
    return value


def _executed_source(client: Client, deal_id: str) -> tuple[dict[str, Any], dict[str, Any], TermsModel]:
    rows = (
        client.table("contracts")
        .select(
            "id,generated_from_summary_id,"
            "ai_summaries!inner(id,deal_id,status,structured_terms,schema_version,prompt_version)"
        )
        .eq("deal_id", deal_id)
        .eq("status", "executed")
        .eq("version", 1)
        .limit(2)
        .execute()
        .data
    )
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
        terms = validate_chat_terms_row(summary)
    except (TypeError, ValueError):
        _unavailable()
    return contract, summary, terms


def _source_platforms(terms: TermsModel) -> set[str]:
    envelope = terms.platform_per_deliverable
    if envelope.status != "found" or not envelope.value:
        _unavailable()
    result: set[str] = set()
    for item in envelope.value:
        mapped = PLATFORM_MAP.get(item.platform)
        if mapped is None:
            _unavailable()
        result.add(mapped)
    return result


def _deliverable_platforms(client: Client, deal_id: str, source_id: str, terms: TermsModel) -> set[str]:
    rows = (
        client.table("deliverables")
        .select("id,source_summary_id,sequence,platform")
        .eq("deal_id", deal_id)
        .order("sequence")
        .limit(_MAX_DELIVERABLES + 1)
        .execute()
        .data
    )
    if not rows or len(rows) > _MAX_DELIVERABLES:
        _unavailable()
    if terms.deliverable_count.status != "found" or terms.deliverable_count.value != len(rows):
        _unavailable()
    sequences = [row.get("sequence") for row in rows]
    if sequences != list(range(1, len(rows) + 1)):
        _unavailable()
    platforms: set[str] = set()
    for row in rows:
        platform = row.get("platform")
        if row.get("source_summary_id") != source_id or platform not in _DATABASE_PLATFORMS:
            _unavailable()
        platforms.add(platform)
    if platforms != _source_platforms(terms):
        _unavailable()
    return platforms


def _storage_rule_key(value: str) -> str:
    return normalise_contract_text(value)


def _rule_order_key(value: str) -> tuple[str, tuple[int, ...]]:
    return _storage_rule_key(value), tuple(ord(character) for character in value)


def _expected_rows(terms: TermsExtractionV2, platforms: set[str]) -> list[dict[str, Any]]:
    envelope = terms.sponsored_content_disclosure
    if envelope.status != "found" or envelope.value is None:
        _unavailable()
    disclosure = envelope.value
    if not disclosure.required:
        return [
            {"platform": platform, "required": False, "rule_note": "", "rule_sequence": 0}
            for platform in sorted(platforms)
        ]

    mapped: list[tuple[str, str]] = []
    for source_rule in disclosure.platform_rules:
        platform = PLATFORM_MAP.get(source_rule.platform)
        rule = source_rule.rule
        if (
            platform is None
            or platform not in platforms
            or len(rule) > _MAX_RULE
            or rule != rule.strip()
            or any(ord(character) < 32 or ord(character) == 127 for character in rule)
        ):
            _unavailable()
        mapped.append((platform, rule))
    if not mapped or len(mapped) > _MAX_RULES or {platform for platform, _ in mapped} != platforms:
        _unavailable()
    mapped.sort(key=lambda item: (item[0], *_rule_order_key(item[1])))
    sequences: dict[str, int] = {}
    expected: list[dict[str, Any]] = []
    for platform, rule in mapped:
        sequences[platform] = sequences.get(platform, 0) + 1
        expected.append({
            "platform": platform,
            "required": True,
            "rule_note": rule,
            "rule_sequence": sequences[platform],
        })
    return expected


def _execution_evidence(client: Client, deal_id: str, contract_id: str, *, require_transition: bool) -> None:
    audits = (
        client.table("audit_log")
        .select("created_at,metadata")
        .eq("entity_type", "deal")
        .eq("entity_id", deal_id)
        .eq("action", "contract_executed")
        .contains("metadata", {"contract_id": contract_id})
        .limit(2)
        .execute()
        .data
    )
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
    transitions = (
        client.table("deal_stage_transitions")
        .select("created_at")
        .eq("deal_id", deal_id)
        .eq("from_stage", "approval")
        .eq("to_stage", "creating")
        .limit(2)
        .execute()
        .data
    )
    if len(transitions) != 1 or not isinstance(transitions[0].get("created_at"), str):
        _unavailable()
    try:
        transitioned_at = datetime.fromisoformat(transitions[0]["created_at"].replace("Z", "+00:00"))
        if transitioned_at.tzinfo is None or executed_at > transitioned_at:
            _unavailable()
    except (TypeError, ValueError):
        _unavailable()


def _canonical_audit_count(client: Client, deal_id: str) -> int:
    rows = (
        client.table("audit_log")
        .select("id")
        .eq("entity_type", "deal")
        .eq("entity_id", deal_id)
        .eq("action", "canonical_disclosures_materialized")
        .limit(2)
        .execute()
        .data
    )
    return len(rows)


def _fact(
    client: Client,
    deal_id: str,
    contract: dict[str, Any],
    summary: dict[str, Any],
    terms: TermsModel,
) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(terms, TermsExtractionV2):
        return "unavailable", []
    platforms = _deliverable_platforms(client, deal_id, summary["id"], terms)
    expected = _expected_rows(terms, platforms)
    _execution_evidence(client, deal_id, contract["id"], require_transition=False)
    rows = (
        client.table("disclosure_requirements")
        .select("source_summary_id,deliverable_id,platform,required,rule_note,rule_sequence")
        .eq("deal_id", deal_id)
        .not_.is_("source_summary_id", "null")
        .limit(_MAX_RULES + 2)
        .execute()
        .data
    )
    if rows:
        normalized = sorted(
            rows,
            key=lambda row: (str(row.get("platform")), int(row.get("rule_sequence", -1))),
        )
        if (
            len(rows) != len(expected)
            or _canonical_audit_count(client, deal_id) != 1
            or any(row.get("source_summary_id") != summary["id"] or row.get("deliverable_id") is not None for row in rows)
            or any(
                any(actual.get(key) != wanted[key] for key in ("platform", "required", "rule_note", "rule_sequence"))
                for actual, wanted in zip(normalized, expected, strict=False)
            )
        ):
            _unavailable()
    else:
        if _canonical_audit_count(client, deal_id) != 0:
            _unavailable()
        _execution_evidence(client, deal_id, contract["id"], require_transition=True)

    groups: list[dict[str, Any]] = []
    for platform in sorted(platforms):
        rules = sorted(
            (row["rule_note"] for row in expected if row["platform"] == platform),
            key=_rule_order_key,
        )
        groups.append({"platform": platform, "rules": rules})
    return ("required" if expected[0]["required"] else "not_required"), groups


def _authorized_deals(client: Client, user_id: str) -> list[dict[str, Any]]:
    participants = (
        client.table("deal_participants")
        .select("deal_id,participant_role")
        .eq("profile_id", user_id)
        .limit(_MAX_DEALS + 1)
        .execute()
        .data
    )
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
    deals = (
        client.table("deals")
        .select("id,deal_name,stage,creator_id,brand_id")
        .in_("id", list(roles))
        .is_("deleted_at", "null")
        .limit(_MAX_DEALS + 1)
        .execute()
        .data
    )
    if len(deals) > _MAX_DEALS or len({row.get("id") for row in deals}) != len(deals):
        _unavailable()
    brand_ids = {
        row.get("brand_id")
        for row in deals
        if roles.get(row.get("id")) != "creator" and isinstance(row.get("brand_id"), str)
    }
    memberships: set[str] = set()
    if brand_ids:
        membership_rows = (
            client.table("brand_members")
            .select("brand_id")
            .eq("profile_id", user_id)
            .eq("status", "active")
            .in_("brand_id", list(brand_ids))
            .limit(_MAX_DEALS + 1)
            .execute()
            .data
        )
        memberships = {
            row.get("brand_id") for row in membership_rows if isinstance(row.get("brand_id"), str)
        }
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


def materialize_for_creating_entry(
    client: Client,
    deal_id: str,
    actor_id: str,
    ip_address: str,
) -> dict[str, Any]:
    """Materialize v2 facts; valid v1 contracts remain explicitly unmapped."""
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, actor_id) is None:
        raise DealError(403, "You're not part of this deal.")
    if deal["stage"] not in {"approval", "creating"}:
        raise DealError(409, "Disclosures can be initialized only while the signed deal enters Creating.")
    try:
        contract, summary, terms = _executed_source(client, deal_id)
    except DealError as exc:
        raise DealError(409, "Disclosure requirements could not be verified safely. Nothing was changed.") from exc
    if not isinstance(terms, TermsExtractionV2):
        return {"outcome": "legacy_unmapped", "idempotent": True, "deal_id": deal_id, "count": 0}
    _deliverable_platforms(client, deal_id, summary["id"], terms)
    _expected_rows(terms, _source_platforms(terms))
    try:
        return client.rpc(
            "materialize_canonical_disclosures",
            {
                "p_deal_id": deal_id,
                "p_source_summary_id": summary["id"],
                "p_actor_id": actor_id,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def get_disclosure_snapshot(
    user_id: str,
    *,
    _client: Client | None = None,
    _now: datetime | None = None,
) -> dict[str, Any]:
    """Return one bounded disclosure fact for every authorized executed deal."""
    client = _client or get_supabase()
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    deals = _authorized_deals(client, user_id)
    creator_ids = {row.get("creator_id") for row in deals if isinstance(row.get("creator_id"), str)}
    brand_ids = {row.get("brand_id") for row in deals if isinstance(row.get("brand_id"), str)}
    creators = (
        client.table("profiles").select("id,display_name").in_("id", list(creator_ids)).execute().data
        if creator_ids else []
    )
    brands = (
        client.table("brands").select("id,company_name").in_("id", list(brand_ids)).execute().data
        if brand_ids else []
    )
    creator_names = {row.get("id"): _safe_text(row.get("display_name"), _MAX_NAME) for row in creators}
    brand_names = {row.get("id"): _safe_text(row.get("company_name"), _MAX_NAME) for row in brands}

    result: list[dict[str, Any]] = []
    for deal in deals:
        direction = "inbound" if deal.get("creator_id") == user_id else "outbound"
        counterparty = (
            brand_names.get(deal.get("brand_id"))
            if direction == "inbound"
            else creator_names.get(deal.get("creator_id"))
        )
        presence = "unavailable"
        platforms: list[dict[str, Any]] = []
        try:
            if deal.get("creator_id") not in creator_names or deal.get("brand_id") not in brand_names:
                _unavailable()
            contract, summary, terms = _executed_source(client, deal["id"])
            presence, platforms = _fact(client, deal["id"], contract, summary, terms)
        except (DealError, KeyError, TypeError, ValueError):
            presence, platforms = "unavailable", []
        result.append({
            "deal_id": deal["id"],
            "deal_name": _safe_text(deal.get("deal_name"), _MAX_NAME),
            "counterparty_name": _safe_text(counterparty, _MAX_NAME),
            "direction": direction,
            "stage": _safe_text(deal.get("stage"), 32),
            "presence": presence,
            "platforms": platforms,
            "deal_path": f"/deal/{deal['id']}",
        })
    result.sort(key=lambda row: row["deal_id"])
    if len(result) > _MAX_DEALS or len({row["deal_id"] for row in result}) != len(result):
        _unavailable()
    return {
        "version": 1,
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "deals": result,
    }
