"""Canonical calendar-term materialization for the contract execution seam."""

from __future__ import annotations

from typing import Any, NoReturn

from supabase import Client

from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import TermsExtraction


_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "CALENDAR_TERMS_NOT_FOUND": (404, "This deal could not be found."),
    "CALENDAR_TERMS_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "CALENDAR_TERMS_WRONG_STAGE": (409, "Calendar terms can be initialized only while the signed deal enters Creating."),
    "CALENDAR_TERMS_UNTRUSTED_SOURCE": (409, "The executed contract does not contain trusted calendar terms."),
    "CALENDAR_TERMS_EXISTING_CONFLICT": (409, "Existing calendar terms conflict with the executed contract. Nothing was changed."),
    "CALENDAR_TERMS_INVALID_REQUEST": (409, "Calendar terms could not be initialized safely. Nothing was changed."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "Calendar terms could not be initialized safely. Nothing was changed.") from exc


def _source_summary(client: Client, deal_id: str) -> dict[str, Any]:
    rows = (
        client.table("contracts")
        .select("id,generated_from_summary_id,status,version,ai_summaries!inner(id,deal_id,status,structured_terms)")
        .eq("deal_id", deal_id)
        .eq("status", "executed")
        .eq("version", 1)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(409, "The executed contract does not contain trusted calendar terms.")
    summary = rows[0].get("ai_summaries")
    if not isinstance(summary, dict) or summary.get("status") != "approved" or summary.get("deal_id") != deal_id:
        raise DealError(409, "The executed contract does not contain trusted calendar terms.")
    try:
        terms = TermsExtraction.model_validate(summary.get("structured_terms"))
    except (TypeError, ValueError) as exc:
        raise DealError(409, "The executed contract does not contain trusted calendar terms.") from exc
    if terms.usage_rights.status != "found" or terms.blackout_window.status != "found":
        raise DealError(409, "The executed contract does not contain trusted calendar terms.")
    return summary


def materialize_for_creating_entry(
    client: Client,
    deal_id: str,
    actor_id: str,
    ip_address: str,
) -> dict[str, Any]:
    """Create the two source-bound rights rows before Approval advances."""
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, actor_id) is None:
        raise DealError(403, "You're not part of this deal.")
    if deal["stage"] not in {"approval", "creating"}:
        raise DealError(409, "Calendar terms can be initialized only while the signed deal enters Creating.")
    summary = _source_summary(client, deal_id)
    try:
        return client.rpc(
            "materialize_canonical_calendar_terms",
            {
                "p_deal_id": deal_id,
                "p_source_summary_id": summary["id"],
                "p_actor_id": actor_id,
                "p_ip_address": ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
