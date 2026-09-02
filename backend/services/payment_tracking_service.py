"""Authoritative, participant-safe off-platform payment tracking."""

from __future__ import annotations

from typing import Any, Literal, NoReturn
from uuid import UUID

from pydantic import ValidationError
from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _participant_role
from services.term_extraction import TermsExtraction


_REPORTABLE_STATES = {
    "paid_full",
    "paid_partial",
    "not_paid_in_window",
    "not_paid_delayed",
    "bad_debt",
    "refunded",
}
_RPC_ERRORS: dict[str, tuple[int, str]] = {
    "PAYMENT_TRACKING_DEAL_NOT_FOUND": (404, "This deal could not be found."),
    "PAYMENT_TRACKING_NOT_PARTICIPANT": (403, "You're not part of this deal."),
    "PAYMENT_TRACKING_BRAND_ONLY": (403, "Only an active brand admin or maker can report payment status."),
    "PAYMENT_TRACKING_CREATOR_ONLY": (403, "Only the named creator can confirm payment receipt."),
    "PAYMENT_TRACKING_NOT_AVAILABLE": (409, "Payment tracking is not available for this deal yet."),
    "PAYMENT_TRACKING_READ_ONLY": (409, "Payment tracking is read-only after the deal closes."),
    "PAYMENT_TRACKING_DISPUTED": (409, "Payment tracking can't be changed while this deal is disputed."),
    "PAYMENT_TRACKING_INVALID_TERMS": (409, "The approved payment terms are inconsistent. Nothing was changed."),
    "PAYMENT_TRACKING_CONFLICT": (409, "Existing payment tracking does not match the approved terms. Nothing was changed."),
    "PAYMENT_TRACKING_MISSING": (409, "Payment tracking is unavailable. Refresh and try again."),
    "PAYMENT_TRACKING_INVALID_VERSION": (422, "The expected payment version is not valid."),
    "PAYMENT_TRACKING_INVALID_STATE": (422, "Choose a valid reportable payment state."),
    "PAYMENT_TRACKING_STALE_VERSION": (409, "This payment status changed. Refresh and try again."),
    "PAYMENT_TRACKING_SINGLE_ONLY": (409, "Use the payment status action for this single payment."),
    "PAYMENT_TRACKING_MILESTONE_ONLY": (409, "Update each milestone for this payment structure."),
    "PAYMENT_TRACKING_MILESTONE_NOT_FOUND": (404, "This payment milestone could not be found."),
    "PAYMENT_TRACKING_RECEIPT_STATE": (409, "Receipt can only be confirmed for a currently reported partial or full payment."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, "message", "") or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, "The payment update could not be applied safely. Nothing was changed.") from exc


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


def _authorize(
    client: Client,
    deal_id: str,
    user_id: str,
    *,
    mutation: Literal["brand", "creator"] | None = None,
) -> tuple[dict[str, Any], str, bool]:
    deal = _load_deal(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")

    active_brand = False
    if role in {"brand_admin", "brand_maker"}:
        active_brand = bool(
            client.table("brand_members")
            .select("profile_id")
            .eq("brand_id", deal["brand_id"])
            .eq("profile_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )

    if mutation == "brand" and (role not in {"brand_admin", "brand_maker"} or not active_brand):
        raise DealError(403, "Only an active brand admin or maker can report payment status.")
    if mutation == "creator" and (role != "creator" or deal["creator_id"] != user_id):
        raise DealError(403, "Only the named creator can confirm payment receipt.")
    if mutation is not None:
        if deal["stage"] == "closed":
            raise DealError(409, "Payment tracking is read-only after the deal closes.")
        if deal["stage"] != "payment":
            raise DealError(409, "Payment tracking is not available for this deal yet.")
        if deal["is_disputed"]:
            raise DealError(409, "Payment tracking can't be changed while this deal is disputed.")
    return deal, role, active_brand


def validate_approved_payment_terms(client: Client, deal_id: str) -> TermsExtraction:
    """Validate the exact approved summary bound to the executed contract."""
    contracts = (
        client.table("contracts")
        .select("generated_from_summary_id")
        .eq("deal_id", deal_id)
        .eq("version", 1)
        .eq("status", "executed")
        .limit(1)
        .execute()
        .data
    )
    if not contracts:
        raise DealError(409, "The approved payment terms are inconsistent. Nothing was changed.")
    summaries = (
        client.table("ai_summaries")
        .select("structured_terms")
        .eq("id", contracts[0]["generated_from_summary_id"])
        .eq("deal_id", deal_id)
        .eq("status", "approved")
        .limit(1)
        .execute()
        .data
    )
    if not summaries:
        raise DealError(409, "The approved payment terms are inconsistent. Nothing was changed.")
    try:
        terms = TermsExtraction.model_validate(summaries[0]["structured_terms"])
    except (ValidationError, TypeError, ValueError) as exc:
        raise DealError(409, "The approved payment terms are inconsistent. Nothing was changed.") from exc
    required = (terms.payment_amount, terms.payment_terms_type)
    if any(field.status != "found" or field.value is None for field in required):
        raise DealError(409, "The approved payment terms are inconsistent. Nothing was changed.")
    return terms


def _expected_version(body: Any, *, keys: set[str]) -> tuple[int, str | None]:
    if not isinstance(body, dict) or set(body) != keys:
        raise DealError(422, "Send exactly the displayed payment state and version.")
    version = body.get("expected_version")
    if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
        raise DealError(422, "The expected payment version is not valid.")
    state = body.get("state")
    if "state" in keys and (not isinstance(state, str) or state not in _REPORTABLE_STATES):
        raise DealError(422, "Choose a valid reportable payment state.")
    return version, state


def _payment_rows(client: Client, deal_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payments = (
        client.table("payments")
        .select(
            "id,deal_id,source_summary_id,amount,currency,structure,state,due_date,due_date_pending,"
            "version,updated_at,creator_receipt_version,creator_receipt_confirmed_at"
        )
        .eq("deal_id", deal_id)
        .not_.is_("source_summary_id", "null")
        .limit(2)
        .execute()
        .data
    )
    if len(payments) != 1:
        raise DealError(409, "Payment tracking is unavailable. Refresh and try again.")
    payment = payments[0]
    milestones: list[dict[str, Any]] = []
    if payment["structure"] != "single":
        milestones = (
            client.table("payment_milestones")
            .select(
                "id,sequence,trigger_description,amount,due_date,state,version,updated_at,"
                "creator_receipt_version,creator_receipt_confirmed_at"
            )
            .eq("payment_id", payment["id"])
            .not_.is_("sequence", "null")
            .order("sequence")
            .execute()
            .data
        )
        if not milestones:
            raise DealError(409, "Payment tracking is unavailable. Refresh and try again.")
    return payment, milestones


def _safe_projection(
    deal: dict[str, Any],
    role: str,
    active_brand: bool,
    user_id: str,
    payment: dict[str, Any],
    milestones: list[dict[str, Any]],
) -> dict[str, Any]:
    editable = deal["stage"] == "payment" and not deal["is_disputed"]
    structured = payment["structure"] != "single"
    payment_confirmed = payment.get("creator_receipt_version") == payment["version"]
    receipt_complete = (
        payment["state"] == "paid_full" and payment_confirmed
        if not structured
        else bool(milestones) and all(
            item["state"] == "paid_full"
            and item.get("creator_receipt_version") == item["version"]
            for item in milestones
        )
    )
    creator_actor = role == "creator" and deal["creator_id"] == user_id
    safe_milestones = []
    for item in milestones:
        confirmed = item.get("creator_receipt_version") == item["version"]
        safe_milestones.append(
            {
                "id": item["id"],
                "sequence": item["sequence"],
                "trigger": item["trigger_description"],
                "amount": str(item["amount"]),
                "due_date": item["due_date"],
                "state": item["state"],
                "version": item["version"],
                "reported_at": item["updated_at"],
                "receipt_confirmed": confirmed,
                "receipt_confirmed_at": item.get("creator_receipt_confirmed_at") if confirmed else None,
                "allowed_actions": {
                    "can_update_state": editable and active_brand,
                    "can_confirm_receipt": editable and creator_actor
                    and item["state"] in {"paid_partial", "paid_full"} and not confirmed,
                },
            }
        )
    return {
        "available": True,
        "deal_id": deal["id"],
        "stage": deal["stage"],
        "payment_id": payment["id"],
        "source_version_identifier": "executed-contract-v1",
        "amount": str(payment["amount"]),
        "currency": payment["currency"],
        "structure": payment["structure"],
        "state": payment["state"],
        "due_date": payment.get("due_date"),
        "due_date_pending": payment["due_date_pending"],
        "version": payment["version"],
        "reported_at": payment["updated_at"],
        "receipt_confirmed": payment_confirmed if not structured else False,
        "receipt_confirmed_at": payment.get("creator_receipt_confirmed_at") if payment_confirmed and not structured else None,
        "receipt_complete": receipt_complete,
        "milestones": safe_milestones,
        "allowed_actions": {
            "can_update_state": editable and active_brand and not structured,
            "can_update_milestones": editable and active_brand and structured,
            "can_confirm_receipt": editable and creator_actor and not structured
            and payment["state"] in {"paid_partial", "paid_full"} and not payment_confirmed,
        },
        "future_actions": {
            "can_request_close": False,
            "payment_reported_full": payment["state"] == "paid_full",
            "receipt_complete": receipt_complete,
        },
    }


def get_payment_tracking(
    deal_id: str,
    user_id: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    deal, role, active_brand = _authorize(client, deal_id, user_id)
    if deal["stage"] not in {"payment", "closed"}:
        return {
            "available": False,
            "deal_id": deal["id"],
            "stage": deal["stage"],
            "reason": "not_yet_available",
            "allowed_actions": {},
            "future_actions": {"can_request_close": False, "receipt_complete": False},
        }
    payment, milestones = _payment_rows(client, deal_id)
    return _safe_projection(deal, role, active_brand, user_id, payment, milestones)


def update_payment_state(
    deal_id: str,
    user_id: str,
    body: Any,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    _authorize(client, deal_id, user_id, mutation="brand")
    version, state = _expected_version(body, keys={"expected_version", "state"})
    try:
        outcome = client.rpc("update_payment_tracking_state", {
            "p_deal_id": deal_id,
            "p_actor_id": user_id,
            "p_expected_version": version,
            "p_state": state,
            "p_ip_address": ip_address,
        }).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    result = get_payment_tracking(deal_id, user_id, _client=client)
    result["outcome"] = {key: outcome[key] for key in ("state", "version", "idempotent")}
    return result


def update_milestone_state(
    deal_id: str,
    milestone_id: str,
    user_id: str,
    body: Any,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    _authorize(client, deal_id, user_id, mutation="brand")
    version, state = _expected_version(body, keys={"expected_version", "state"})
    try:
        outcome = client.rpc("update_payment_milestone_state", {
            "p_deal_id": deal_id,
            "p_milestone_id": milestone_id,
            "p_actor_id": user_id,
            "p_expected_version": version,
            "p_state": state,
            "p_ip_address": ip_address,
        }).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    result = get_payment_tracking(deal_id, user_id, _client=client)
    result["outcome"] = {
        key: outcome[key]
        for key in ("milestone_id", "state", "version", "aggregate_state", "idempotent")
    }
    return result


def confirm_receipt(
    deal_id: str,
    user_id: str,
    body: Any,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    _authorize(client, deal_id, user_id, mutation="creator")
    if not isinstance(body, dict) or set(body) not in (
        {"expected_version"},
        {"milestone_id", "expected_version"},
    ):
        raise DealError(422, "Confirm exactly the displayed payment item and version.")
    version = body.get("expected_version")
    if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
        raise DealError(422, "The expected payment version is not valid.")
    milestone_id = body.get("milestone_id")
    if milestone_id is not None:
        if not isinstance(milestone_id, str):
            raise DealError(422, "Choose the displayed payment milestone.")
        try:
            milestone_id = str(UUID(milestone_id))
        except ValueError as exc:
            raise DealError(422, "Choose the displayed payment milestone.") from exc
    try:
        outcome = client.rpc("confirm_payment_receipt", {
            "p_deal_id": deal_id,
            "p_milestone_id": milestone_id,
            "p_actor_id": user_id,
            "p_expected_version": version,
            "p_ip_address": ip_address,
        }).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    result = get_payment_tracking(deal_id, user_id, _client=client)
    result["outcome"] = {
        key: outcome[key]
        for key in ("item_type", "item_id", "version", "idempotent")
    }
    return result
