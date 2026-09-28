"""Participant-safe, read-only projection for one canonical deliverable."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from core.supabase_client import get_supabase
from services.content_service import participant_content_view
from services.deliverable_service import _canonical_items
from services.posting_service import participant_post_state
from services.stage_engine import DealError
from services.term_extraction import TermsExtractionV1, TermsExtractionV2, validate_chat_terms_row

_NOT_FOUND = "This deliverable could not be found."


def _unavailable() -> None:
    # One bounded response intentionally covers absent, stale and foreign rows.
    raise DealError(404, _NOT_FOUND)


def _authorized_deal(client: Client, deal_id: str, user_id: str) -> tuple[dict[str, Any], str]:
    """Check participation before looking up any deal, source, or deliverable facts."""
    participants = client.table("deal_participants").select("participant_role").eq(
        "deal_id", deal_id
    ).eq("profile_id", user_id).limit(1).execute().data
    if not participants:
        _unavailable()
    role = participants[0].get("participant_role")
    if role not in {"creator", "brand_admin", "brand_maker", "brand_checker"}:
        _unavailable()
    rows = client.table("deals").select(
        "id,stage,creator_id,brand_id,deal_name"
    ).eq("id", deal_id).is_("deleted_at", "null").limit(1).execute().data
    if not rows:
        _unavailable()
    deal = rows[0]
    if role == "creator":
        if deal.get("creator_id") != user_id:
            _unavailable()
    elif not client.table("brand_members").select("profile_id").eq(
        "brand_id", deal["brand_id"]
    ).eq("profile_id", user_id).eq("status", "active").limit(1).execute().data:
        _unavailable()
    return deal, role


TermsModel = TermsExtractionV1 | TermsExtractionV2


def _executed_source(client: Client, deal_id: str) -> tuple[dict[str, Any], dict[str, Any], TermsModel]:
    rows = client.table("contracts").select(
        "id,generated_from_summary_id,"
        "ai_summaries!inner(id,deal_id,status,structured_terms,schema_version,prompt_version)"
    ).eq("deal_id", deal_id).eq("status", "executed").eq("version", 1).limit(2).execute().data
    if len(rows) != 1:
        _unavailable()
    contract = rows[0]
    summary = contract.get("ai_summaries")
    if not isinstance(summary, dict) or summary.get("deal_id") != deal_id or summary.get("status") != "approved":
        _unavailable()
    if contract.get("generated_from_summary_id") != summary.get("id"):
        _unavailable()
    try:
        terms = validate_chat_terms_row(summary)
        _canonical_items(summary)
    except (TypeError, ValueError, DealError):
        _unavailable()
    return contract, summary, terms


def _utc_date(value: str) -> str:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()


def _rights_from_fallback(client: Client, deal_id: str, contract: dict[str, Any], terms: TermsModel) -> dict[str, Any]:
    audits = client.table("audit_log").select("created_at,metadata").eq(
        "entity_type", "deal"
    ).eq("entity_id", deal_id).eq("action", "contract_executed").contains(
        "metadata", {"contract_id": contract["id"]}
    ).limit(2).execute().data
    transitions = client.table("deal_stage_transitions").select("created_at").eq(
        "deal_id", deal_id
    ).eq("from_stage", "approval").eq("to_stage", "creating").limit(2).execute().data
    if len(audits) != 1 or len(transitions) != 1 or not isinstance(audits[0].get("created_at"), str):
        _unavailable()
    execution_at = audits[0]["created_at"]
    if execution_at > transitions[0].get("created_at", ""):
        _unavailable()
    usage = terms.usage_rights
    if usage.status != "found" or not isinstance(usage.value, bool):
        _unavailable()
    if not usage.value:
        return {"present": True, "has_usage_rights": False, "channels": [], "start_date": None, "end_date": None, "is_perpetual": False}
    duration = terms.usage_rights_duration
    channels = terms.usage_rights_channels
    if duration.status != "found" or channels.status != "found" or not duration.value or not isinstance(channels.value, list):
        _unavailable()
    start = _utc_date(execution_at)
    perpetual = bool(duration.value.is_perpetual)
    end = None if perpetual else (datetime.fromisoformat(start).date() + timedelta(days=duration.value.duration_days - 1)).isoformat()
    return {"present": True, "has_usage_rights": True, "channels": channels.value, "start_date": start, "end_date": end, "is_perpetual": perpetual}


def _rights(client: Client, deal_id: str, source_id: str, contract: dict[str, Any], terms: TermsModel, today: str) -> dict[str, Any]:
    rows = client.table("usage_rights").select(
        "id,source_summary_id,has_usage_rights,channels,start_date,end_date,is_perpetual"
    ).eq("deal_id", deal_id).not_.is_("source_summary_id", "null").limit(2).execute().data
    if rows:
        if len(rows) != 1 or rows[0].get("source_summary_id") != source_id:
            _unavailable()
        fact = {"present": True, **{key: rows[0].get(key) for key in ("has_usage_rights", "channels", "start_date", "end_date", "is_perpetual")}}
    else:
        try:
            fact = _rights_from_fallback(client, deal_id, contract, terms)
        except (KeyError, TypeError, ValueError):
            _unavailable()
    status = rights_status(fact, today)
    return {**fact, "status": status}


def rights_status(fact: dict[str, Any], today: str) -> str:
    """Derive the display-only rights state from the server's UTC date."""
    if not fact.get("has_usage_rights"):
        return "none"
    if fact.get("is_perpetual"):
        return "perpetual"
    end = fact.get("end_date")
    if not isinstance(end, str):
        _unavailable()
    if today > end:
        return "expired"
    if today >= (datetime.fromisoformat(end).date() - timedelta(days=14)).isoformat():
        return "expiring"
    return "active"


def _safe_submission(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in (
        "id", "round_number", "lifecycle", "original_filename", "mime_type", "size_bytes",
        "submitted_at", "submitted_by_name", "comment", "decided_at", "decided_by_name", "can_download",
    )}


def get_deliverable_detail(
    deal_id: str, deliverable_id: str, user_id: str, *, _client: Client | None = None,
    _now: datetime | None = None,
) -> dict[str, Any]:
    """Return one source-bound detail payload; never fetch private annotations."""
    client = _client or get_supabase()
    deal, _ = _authorized_deal(client, deal_id, user_id)
    contract, summary, terms = _executed_source(client, deal_id)
    source_id = summary["id"]
    canonical = client.table("deliverables").select(
        "id,sequence,content_format,platform,posting_date,posting_window_start,posting_window_end,location,"
        "revision_max,revision_current,status,content_ops_attention,content_ops_reason,source_summary_id"
    ).eq("id", deliverable_id).eq("deal_id", deal_id).eq("source_summary_id", source_id).limit(1).execute().data
    if len(canonical) != 1:
        _unavailable()
    # Reuse the established content/post projections, then narrow them to this one item.
    enriched = participant_content_view(client, deal_id, user_id, [{**canonical[0], "display_name": f"Deliverable {canonical[0]['sequence']}"}])
    projected, _ = participant_post_state(client, deal_id, user_id, deal["stage"], enriched)
    item = projected[0]
    now = (_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    rights = _rights(client, deal_id, source_id, contract, terms, now.date().isoformat())
    approval = item["content_approval"]
    safe_approval = None if approval is None else {key: approval.get(key) for key in (
        "status", "maker_name", "checker_name", "round_number", "comment", "created_at", "decided_at",
    )}
    post = item["post_state"]["current"]
    safe_post = None if post is None else {key: post.get(key) for key in (
        "final_url", "host", "title", "verification_status", "verified_at", "flagged_at", "confirmed_at",
    )}
    history = [_safe_submission(row) for row in item["submission_history"][:20]]
    return {
        "version": 1, "as_of": now.isoformat().replace("+00:00", "Z"), "deal_id": deal_id,
        "deliverable": {
            "id": item["id"], "display_name": item["display_name"], "content_format": item["content_format"],
            "platform": item["platform"], "location": item["location"], "posting_date": item["posting_date"],
            "posting_window_start": item["posting_window_start"], "posting_window_end": item["posting_window_end"],
            "revision_current": item["revision_current"], "revision_max": item["revision_max"], "status": item["status"],
            "operational_attention": item["content_ops_attention"], "current_submission": None if item["current_submission"] is None else _safe_submission(item["current_submission"]),
            "submission_history": history, "history_truncated": len(item["submission_history"]) > len(history),
            "approval": safe_approval, "live_proof": safe_post,
        },
        "usage_rights": rights,
        "allowed_actions": {"can_download_drafts": bool(history)},
    }
