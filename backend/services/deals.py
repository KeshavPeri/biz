"""Deal connect — B2-004 "basic connect" (Phase 8 Cluster C).

The MINIMAL seam into the Phase-9 deal engine: tapping Connect seeds a deal in
Pending + both participants + the logged initial stage transition + a one-line
chat stub, and surfaces a NON-BLOCKING exclusivity warning. Everything past that
(proposal, terms, AI, accept/decline, the deal room) is Phase 9.

Runs on the service_role client (bypasses RLS), so — like services/maker_checker —
this module enforces every rule itself and never trusts the caller's identity,
which is verified upstream by core.auth.get_current_user_id.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from supabase import Client

from core.supabase_client import get_supabase

# DealError + the shared transition primitives live in the engine now; connect and
# the accept/decline wrappers below route through it (no parallel transition path).
from services.stage_engine import DealError, _exclusivity_warning, request_transition

# Stages that mean "no live deal" — a new connect may be created past these.
TERMINAL_STAGES = ("declined", "cancelled", "closed")
PENDING_WINDOW_HOURS = 72  # deal-engine.md §1; auto-decline enforcement is Phase 9.


def _account_type(client: Client, profile_id: str) -> str | None:
    resp = client.table("profiles").select("account_type, display_name").eq("id", profile_id).execute()
    return resp.data[0]["account_type"] if resp.data else None


def _active_brand_id(client: Client, profile_id: str) -> str | None:
    """The brand this user is an ACTIVE member of (MVP: a user belongs to one brand)."""
    resp = (
        client.table("brand_members")
        .select("brand_id")
        .eq("profile_id", profile_id)
        .eq("status", "active")
        .execute()
    )
    return resp.data[0]["brand_id"] if resp.data else None


def _find_live_deal(client: Client, creator_id: str, brand_id: str) -> dict[str, Any] | None:
    resp = (
        client.table("deals")
        .select("id, stage")
        .eq("creator_id", creator_id)
        .eq("brand_id", brand_id)
        .is_("deleted_at", "null")
        .execute()
    )
    for d in resp.data:
        if d["stage"] not in TERMINAL_STAGES:
            return d
    return None


def connect_deal(
    user_id: str,
    target_type: Literal["creator", "brand"],
    target_id: str,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()

    caller_type = _account_type(client, user_id)
    if caller_type is None:
        raise DealError(404, "Your profile could not be found.")

    # ── 1. Resolve parties + direction from the caller's account type ──────────
    # direction is creator-centric (data-model.md): a brand reaching a creator is
    # INBOUND to the creator; a creator reaching a brand is OUTBOUND from them.
    if caller_type == "brand" and target_type == "creator":
        brand_id = _active_brand_id(client, user_id)
        if brand_id is None:  # RBAC: must actually belong to a brand
            raise DealError(403, "You aren't an active member of a brand.")
        creator_id = target_id
        direction = "inbound"
        # Validate the target is really a creator.
        if _account_type(client, creator_id) != "creator":
            raise DealError(404, "Creator not found.")
    elif caller_type == "creator" and target_type == "brand":
        creator_id = user_id
        brand_id = target_id
        direction = "outbound"
        exists = client.table("brands").select("id").eq("id", brand_id).execute()
        if not exists.data:
            raise DealError(404, "Brand not found.")
    else:
        raise DealError(422, "That connection isn't supported.")

    # ── 2. Duplicate guard — reuse an existing live deal for this pair ─────────
    existing = _find_live_deal(client, creator_id, brand_id)
    if existing is not None:
        return {"deal_id": existing["id"], "stage": existing["stage"], "created": False}

    # Names for a sensible default deal_name.
    brand_row = client.table("brands").select("company_name").eq("id", brand_id).execute()
    creator_row = client.table("profiles").select("display_name").eq("id", creator_id).execute()
    company_name = brand_row.data[0]["company_name"] if brand_row.data else "Brand"
    creator_name = creator_row.data[0]["display_name"] if creator_row.data else "Creator"

    # ── 3. Create the deal (Pending) ───────────────────────────────────────────
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=PENDING_WINDOW_HOURS)).isoformat()
    deal = (
        client.table("deals")
        .insert(
            {
                "creator_id": creator_id,
                "brand_id": brand_id,
                "deal_name": f"{company_name} × {creator_name}",
                "deal_type": "campaign",
                "stage": "pending",
                "direction": direction,
                "currency": "INR",
                "created_by": user_id,
                "expires_at": expires_at,
            }
        )
        .execute()
    )
    deal_id = deal.data[0]["id"]

    # ── 4. Participants: creator + the initiating brand admin ──────────────────
    # The initiating brand member holds the brand_admin hat for this deal; per-deal
    # maker/checker assignment is Phase 9. We need a brand profile_id for the
    # brand side: the caller when brand-initiated, else the brand's admin member.
    brand_participant_id = user_id if caller_type == "brand" else _brand_admin_profile(client, brand_id)
    participants = [{"deal_id": deal_id, "profile_id": creator_id, "participant_role": "creator"}]
    if brand_participant_id is not None:
        participants.append(
            {"deal_id": deal_id, "profile_id": brand_participant_id, "participant_role": "brand_admin"}
        )
    client.table("deal_participants").insert(participants).execute()

    # ── 5. Log the initial Pending transition (NULL → pending) ─────────────────
    client.table("deal_stage_transitions").insert(
        {
            "deal_id": deal_id,
            "from_stage": None,
            "to_stage": "pending",
            "transition_type": "auto",
            "triggered_by": user_id,
        }
    ).execute()

    # ── 6. Chat-thread stub — the thread IS the deal (no chat UI this task) ─────
    client.table("messages").insert(
        {
            "deal_id": deal_id,
            "sender_id": user_id,
            "body": "Started a connection — this is the beginning of your deal thread.",
        }
    ).execute()

    # ── 7. Non-blocking exclusivity warning ────────────────────────────────────
    warning = _exclusivity_warning(client, creator_id)

    result: dict[str, Any] = {"deal_id": deal_id, "stage": "pending", "created": True}
    if warning:
        result["exclusivity_warning"] = warning
    return result


def _brand_admin_profile(client: Client, brand_id: str) -> str | None:
    """An active admin of the brand — the brand-side participant when a CREATOR
    initiates (the creator has no brand membership of their own to use)."""
    resp = (
        client.table("brand_members")
        .select("profile_id")
        .eq("brand_id", brand_id)
        .eq("status", "active")
        .eq("brand_role", "admin")
        .execute()
    )
    return resp.data[0]["profile_id"] if resp.data else None


# ─────────────────────────────────────────────────────────────────────────────
# Pending accept / decline — B3-016 (task 9.5), now THIN WRAPPERS over the engine.
#
# All transition logic (guards, role/stage/recipient checks, atomic apply, audit,
# notifications) lives in services/stage_engine.request_transition — the single
# path for every stage change (task 9.8). These wrappers just name the target
# stage and pass the accept-only exclusivity-ack param.
# ─────────────────────────────────────────────────────────────────────────────


def accept_deal(
    user_id: str,
    deal_id: str,
    ip_address: str,
    acknowledge_exclusivity: bool = False,
) -> dict[str, Any]:
    """Recipient accepts a Pending connection → CHATTING (via the engine)."""
    return request_transition(
        deal_id,
        user_id,
        "chatting",
        ip_address,
        params={"acknowledge_exclusivity": acknowledge_exclusivity},
    )


def decline_deal(user_id: str, deal_id: str, ip_address: str) -> dict[str, Any]:
    """Recipient declines a Pending connection → DECLINED, terminal (via the engine)."""
    return request_transition(deal_id, user_id, "declined", ip_address)
