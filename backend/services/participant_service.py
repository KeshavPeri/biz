"""Participant admission boundary for B3-004.

All mutations delegate to migration 044's deal-locked RPCs. This service only
builds bounded identity projections, maps stable database conflicts to friendly
HTTP errors, and emits best-effort generic notifications after commit.
"""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from core.supabase_client import get_supabase
from services.stage_engine import DealError


ROLE_LABELS = {
    "creator": "Creator",
    "brand_admin": "Brand admin",
    "brand_maker": "Brand maker",
    "brand_checker": "Brand checker",
}

ERRORS: tuple[tuple[str, int, str], ...] = (
    ("PARTICIPANT_ADD_NOT_FOUND", 404, "This participant request could not be found."),
    ("PARTICIPANT_ADD_FORBIDDEN", 403, "You're not allowed to manage participants for this deal."),
    ("PARTICIPANT_ADD_ROLE_INVALID", 409, "Choose an available brand-side role."),
    ("PARTICIPANT_ADD_REASON_INVALID", 409, "Add a reason between 1 and 500 characters."),
    ("PARTICIPANT_ADD_CANDIDATE_INVALID", 409, "That teammate is no longer eligible for this deal."),
    ("PARTICIPANT_ADD_ROLE_MISMATCH", 409, "That teammate isn't eligible for the proposed role."),
    ("PARTICIPANT_ADD_ALREADY_PRESENT", 409, "That teammate is already in this deal."),
    ("PARTICIPANT_ADD_PENDING_EXISTS", 409, "Another participant request is already awaiting approval."),
    ("PARTICIPANT_ADD_IDEMPOTENCY_CONFLICT", 409, "That request ID was already used with different details."),
    ("PARTICIPANT_ADD_DECISION_CONFLICT", 409, "Your response is already final and can't be changed."),
    ("PARTICIPANT_ADD_TERMS_LOCKED", 409, "Participants can only be added while terms are still unlocked in Chatting."),
)


def _rpc_error(exc: APIError) -> DealError:
    message = str(exc)
    for marker, status, detail in ERRORS:
        if marker in message:
            return DealError(status, detail)
    return DealError(409, "This participant request changed. Refresh and try again.")


def _deal_and_role(client: Any, deal_id: str, user_id: str) -> tuple[dict[str, Any], str]:
    deals = (
        client.table("deals")
        .select("id,brand_id,creator_id,stage")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    if not deals:
        raise DealError(404, "Deal not found.")
    participants = (
        client.table("deal_participants")
        .select("participant_role")
        .eq("deal_id", deal_id)
        .eq("profile_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not participants:
        raise DealError(403, "You're not part of this deal.")
    return deals[0], participants[0]["participant_role"]


def _profiles(client: Any, profile_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not profile_ids:
        return {}
    rows = (
        client.table("profiles")
        .select("id,display_name,avatar_url")
        .in_("id", sorted(profile_ids))
        .execute()
        .data
    )
    return {row["id"]: row for row in rows}


def _terms_unlocked(client: Any, deal_id: str) -> bool:
    return bool(client.rpc("participant_add_terms_unlocked", {"p_deal_id": deal_id}).execute().data)


def get_participant_management(deal_id: str, user_id: str) -> dict[str, Any]:
    client = get_supabase()
    deal, _ = _deal_and_role(client, deal_id, user_id)
    participants = (
        client.table("deal_participants")
        .select("profile_id,participant_role,joined_at")
        .eq("deal_id", deal_id)
        .order("joined_at")
        .execute()
        .data
    )
    participant_ids = {row["profile_id"] for row in participants}

    pending_rows = (
        client.table("participant_add_requests")
        .select("id,proposed_profile_id,requested_by,reason,status,proposed_role,created_at")
        .eq("deal_id", deal_id)
        .eq("status", "pending")
        .limit(1)
        .execute()
        .data
    )
    pending = pending_rows[0] if pending_rows else None
    decisions: list[dict[str, Any]] = []
    if pending:
        decisions = (
            client.table("participant_add_decisions")
            .select("approver_profile_id,decision")
            .eq("request_id", pending["id"])
            .order("created_at")
            .execute()
            .data
        )

    candidate_rows = (
        client.table("brand_members")
        .select("profile_id,brand_role")
        .eq("brand_id", deal["brand_id"])
        .eq("status", "active")
        .execute()
        .data
    )
    candidates = [
        row for row in candidate_rows
        if row["profile_id"] not in participant_ids and row["profile_id"] != deal["creator_id"]
    ]
    identity_ids = participant_ids | {row["profile_id"] for row in candidates}
    if pending:
        identity_ids.add(pending["proposed_profile_id"])
    profile_by_id = _profiles(client, identity_ids)

    terms_unlocked = deal["stage"] == "chatting" and _terms_unlocked(client, deal_id)
    can_request = terms_unlocked and pending is None and bool(candidates)
    response_pending = None
    if pending:
        proposed = profile_by_id.get(pending["proposed_profile_id"], {})
        own_decision = next(
            (row["decision"] for row in decisions if row["approver_profile_id"] == user_id), None
        )
        response_pending = {
            "id": pending["id"],
            "proposed": {
                "display_name": proposed.get("display_name") or "Teammate",
                "avatar_url": proposed.get("avatar_url"),
            },
            "proposed_role": pending["proposed_role"],
            "proposed_role_label": ROLE_LABELS.get(pending["proposed_role"], "Brand teammate"),
            "reason": pending["reason"],
            "created_at": pending["created_at"],
            "approvals": [
                {
                    "display_name": profile_by_id.get(row["approver_profile_id"], {}).get("display_name") or "Participant",
                    "status": row["decision"],
                }
                for row in decisions
            ],
            "can_decide": own_decision == "pending",
        }

    return {
        "deal_id": deal_id,
        "stage": deal["stage"],
        "participants": [
            {
                "display_name": profile_by_id.get(row["profile_id"], {}).get("display_name") or "Participant",
                "avatar_url": profile_by_id.get(row["profile_id"], {}).get("avatar_url"),
                "role": row["participant_role"],
                "role_label": ROLE_LABELS[row["participant_role"]],
            }
            for row in participants
        ],
        "pending_request": response_pending,
        "candidates": [
            {
                "id": row["profile_id"],
                "display_name": profile_by_id.get(row["profile_id"], {}).get("display_name") or "Teammate",
                "avatar_url": profile_by_id.get(row["profile_id"], {}).get("avatar_url"),
                "eligible_roles": (
                    ["brand_admin", "brand_maker", "brand_checker"]
                    if row["brand_role"] == "admin"
                    else ["brand_maker", "brand_checker"]
                ),
            }
            for row in candidates
        ] if can_request else [],
        "available_actions": {"can_request": can_request},
    }


def _notify(client: Any, profile_ids: list[str], deal_id: str, title: str, body: str) -> None:
    if not profile_ids:
        return
    try:
        client.table("notifications").insert([
            {"profile_id": profile_id, "tier": "important", "title": title, "body": body, "deal_id": deal_id}
            for profile_id in sorted(set(profile_ids))
        ]).execute()
    except Exception:
        # Authorization is already committed; notification delivery is explicitly best-effort.
        return


def create_participant_request(
    deal_id: str,
    user_id: str,
    request_id: str,
    proposed_profile_id: str,
    proposed_role: str,
    reason: str,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()
    _deal_and_role(client, deal_id, user_id)
    try:
        result = client.rpc("apply_participant_add_request", {
            "p_request_id": request_id,
            "p_deal_id": deal_id,
            "p_actor_id": user_id,
            "p_proposed_profile_id": proposed_profile_id,
            "p_proposed_role": proposed_role,
            "p_reason": reason,
            "p_ip_address": ip_address,
        }).execute().data
    except APIError as exc:
        raise _rpc_error(exc) from exc
    if not result.get("idempotent"):
        rows = (
            client.table("participant_add_decisions")
            .select("approver_profile_id")
            .eq("request_id", request_id)
            .neq("approver_profile_id", user_id)
            .execute()
            .data
        )
        _notify(client, [row["approver_profile_id"] for row in rows], deal_id,
                "Participant request needs review", "A deal participant has requested a teammate addition.")
    return get_participant_management(deal_id, user_id)

def decide_participant_request(
    deal_id: str,
    request_id: str,
    user_id: str,
    decision: str,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()
    _deal_and_role(client, deal_id, user_id)
    requester = (
        client.table("participant_add_requests")
        .select("requested_by")
        .eq("id", request_id)
        .eq("deal_id", deal_id)
        .limit(1)
        .execute()
        .data
    )
    try:
        result = client.rpc("apply_participant_add_decision", {
            "p_deal_id": deal_id,
            "p_request_id": request_id,
            "p_actor_id": user_id,
            "p_decision": decision,
            "p_ip_address": ip_address,
        }).execute().data
    except APIError as exc:
        raise _rpc_error(exc) from exc
    if requester and not result.get("idempotent") and result.get("status") in {"approved", "rejected"}:
        title = "Teammate added" if result["status"] == "approved" else "Participant request declined"
        body = "Your participant request has been completed." if result["status"] == "approved" else "Your participant request was declined."
        _notify(client, [requester[0]["requested_by"]], deal_id, title, body)
    return get_participant_management(deal_id, user_id)
