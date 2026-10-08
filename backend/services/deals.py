"""Deal connect — B2-004 "basic connect" (Phase 8 Cluster C).

The MINIMAL seam into the Phase-9 deal engine: tapping Connect seeds a deal in
Pending + both participants + the logged initial stage transition + a one-line
chat stub, and surfaces a NON-BLOCKING exclusivity warning. Everything past that
(proposal, terms, AI, accept/decline, the deal room) is Phase 9.

Runs on the service_role client (bypasses RLS), so — like services/maker_checker —
this module enforces every rule itself and never trusts the caller's identity,
which is verified upstream by core.auth.get_current_user_id.
"""

from typing import Any, Literal

from supabase import Client

from core.supabase_client import get_supabase
from services.exclusivity_conflicts import project_conflicts, valid_category

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
    category: str,
    acknowledgement_digest: str | None = None,
) -> dict[str, Any]:
    client = get_supabase()
    try:
        category = valid_category(category, trim=False)
    except ValueError as exc:
        raise DealError(422, str(exc)) from exc

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

    projection = project_conflicts(client, creator_id, category) if direction == "outbound" else None
    conflicts = projection["warning"]["conflicts"] if projection else []
    if conflicts and acknowledgement_digest != projection["digest"]:
        return {"requires_acknowledgement": True, "exclusivity_conflicts": projection["warning"]}
    if not conflicts and acknowledgement_digest is not None:
        raise DealError(409, "The conflict warning changed. Refresh and try again.")
    try:
        response = client.rpc("connect_with_category", {
            "p_actor_id": user_id, "p_target_type": target_type, "p_target_id": target_id,
            "p_category": category,
            "p_expected_snapshot": projection["snapshot"] if projection else None,
            "p_override_metadata": projection["audit"] if conflicts else None,
            "p_ip_address": ip_address,
        }).execute().data
        return response[0] if isinstance(response, list) else response
    except Exception as exc:
        message = getattr(exc, "message", "") or str(exc)
        if "CONNECT_STALE" in message:
            raise DealError(409, "The conflict information changed. Refresh and try again.") from exc
        if "CONNECT_MEMBERSHIP" in message:
            raise DealError(403, "You aren't an active member of a brand.") from exc
        if "CONNECT_RECIPIENT_UNAVAILABLE" in message:
            raise DealError(409, "This brand can't receive connection requests right now. Try again later.") from exc
        if "CONNECT_TARGET" in message:
            raise DealError(404, "This profile could not be found.") from exc
        raise DealError(409, "This connection could not be started safely. Refresh and try again.") from exc


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
    acknowledgement_digest: str | None = None,
) -> dict[str, Any]:
    """Recipient accepts a Pending connection → CHATTING (via the engine)."""
    return request_transition(
        deal_id,
        user_id,
        "chatting",
        ip_address,
        params={"acknowledge_exclusivity": acknowledge_exclusivity,
                "acknowledgement_digest": acknowledgement_digest},
    )


def decline_deal(user_id: str, deal_id: str, ip_address: str) -> dict[str, Any]:
    """Recipient declines a Pending connection → DECLINED, terminal (via the engine)."""
    return request_transition(deal_id, user_id, "declined", ip_address)
