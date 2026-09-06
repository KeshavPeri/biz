"""Stage Transition Engine — the server-side state machine (task 9.8).

**The core of the product.** Every deal-stage change flows through ONE path:
`request_transition`. It is the single source of truth for what is legal, and it
runs the deal-engine.md "Server-side enforcement" checks in order, rejecting at
the first failure with a clean, user-friendly message (never a raw trace).

Layering:
  • This module VALIDATES (participant → legal move → role → guard).
  • The Postgres RPC `apply_stage_transition` (migration 018) APPLIES atomically
    (conditional UPDATE + transition log + audit in one transaction), which also
    guards against concurrent double-transitions.

Runs on the service_role client (bypasses RLS), so — like services/deals and
services/maker_checker — it enforces every rule itself. The caller's identity is
verified upstream by core.auth.

deal-engine.md is canonical. If code and the doc disagree, the doc wins.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable

from supabase import Client

from core.supabase_client import get_supabase


class DealError(Exception):
    """A rule/precondition failure; carries the HTTP status the API should return."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ─────────────────────────────────────────────────────────────────────────────
# Shared deal primitives (used by the engine AND by services/deals connect flow).
# ─────────────────────────────────────────────────────────────────────────────


def _load_deal_for_transition(client: Client, deal_id: str) -> dict[str, Any]:
    resp = (
        client.table("deals")
        .select("id, stage, created_by, creator_id, brand_id, deal_name, currency, expires_at")
        .eq("id", deal_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise DealError(404, "This deal could not be found.")
    return resp.data[0]


def _participant_role(client: Client, deal_id: str, profile_id: str) -> str | None:
    resp = (
        client.table("deal_participants")
        .select("participant_role")
        .eq("deal_id", deal_id)
        .eq("profile_id", profile_id)
        .execute()
    )
    return resp.data[0]["participant_role"] if resp.data else None


def _is_expired(expires_at: str | None) -> bool:
    """Has the 72h Pending window closed? A null expiry means 'no clock' (already
    accepted), which the pending-stage guard precludes reaching here."""
    if not expires_at:
        return False
    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) >= expiry


def _exclusivity_warning(client: Client, creator_id: str) -> str | None:
    """Non-blocking: does this creator have an ACTIVE exclusivity clause on any of
    their deals? WARN ONLY (deal-engine.md §1) — real category-conflict blocking is
    out of MVP scope."""
    deals = client.table("deals").select("id").eq("creator_id", creator_id).execute()
    deal_ids = [d["id"] for d in deals.data]
    if not deal_ids:
        return None
    clauses = (
        client.table("exclusivity_clauses")
        .select("category, end_date")
        .in_("deal_id", deal_ids)
        .eq("has_exclusivity", True)
        .execute()
    )
    today = date.today().isoformat()
    for c in clauses.data:
        if c["end_date"] is None or c["end_date"] >= today:
            category = c.get("category") or "unspecified category"
            return f"This creator has an active exclusivity arrangement ({category})."
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Guards — each transition's precondition check. Four outcomes:
#   allow(...)         → proceed to apply
#   deny(status, msg)  → reject with a clean error
#   needs_input(...)   → soft-stop: return a payload, DON'T transition (e.g. the
#                        warn-only exclusivity acknowledgement)
#   handled(...)       → the guard's locked RPC handled decision + optional
#                        transition atomically; the engine must not apply again
# Guards for features built in LATER tasks return not_yet_available() so the later
# task drops its real check into the guard body WITHOUT touching the engine shape.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class GuardContext:
    client: Client
    deal: dict[str, Any]
    user_id: str
    role: str | None
    params: dict[str, Any]


@dataclass
class GuardOutcome:
    kind: str  # 'allow' | 'deny' | 'needs_input' | 'handled'
    status: int = 409
    message: str | None = None
    payload: dict[str, Any] | None = None
    audit_metadata: dict[str, Any] = field(default_factory=dict)


def allow(audit_metadata: dict[str, Any] | None = None) -> GuardOutcome:
    return GuardOutcome("allow", audit_metadata=audit_metadata or {})


def deny(status: int, message: str) -> GuardOutcome:
    return GuardOutcome("deny", status=status, message=message)


def needs_input(payload: dict[str, Any]) -> GuardOutcome:
    return GuardOutcome("needs_input", payload=payload)


def handled(payload: dict[str, Any]) -> GuardOutcome:
    return GuardOutcome("handled", payload=payload)


def not_yet_available() -> GuardOutcome:
    """The precondition system for this transition isn't built yet (a later task)."""
    return deny(409, "This step isn't available in the app yet.")


def _guard_accept(ctx: GuardContext) -> GuardOutcome:
    """pending → chatting. Within 72h + warn-only exclusivity (deal-engine.md §1)."""
    if _is_expired(ctx.deal["expires_at"]):
        return deny(410, "This connection request has expired.")
    warning: str | None = None
    if ctx.role == "creator":  # the clause is the creator's; only warn when they accept
        warning = _exclusivity_warning(ctx.client, ctx.deal["creator_id"])
        if warning and not ctx.params.get("acknowledge_exclusivity"):
            return needs_input({"requires_acknowledgement": True, "exclusivity_warning": warning})
    return allow(
        {
            "from_stage": "pending",
            "to_stage": "chatting",
            "exclusivity_warning": warning,
            "exclusivity_acknowledged": bool(warning),
        }
    )


def _guard_decline(ctx: GuardContext) -> GuardOutcome:
    """pending → declined. Recipient + pending already enforced upstream."""
    return allow({"from_stage": "pending", "to_stage": "declined"})


def _guard_stub(ctx: GuardContext) -> GuardOutcome:
    """Placeholder for a transition whose precondition data is built in a later
    task (see the registry notes). Cleanly reports 'not available yet'."""
    return not_yet_available()


def _guard_summary_gate_b(ctx: GuardContext) -> GuardOutcome:
    """Chatting → Approval summary decision.

    Gate B is special: its final participant decision, summary status, stage,
    transition log, and audits must be one Postgres transaction. The guard's
    backend-only RPC therefore returns ``handled`` so request_transition never
    calls the generic transition RPC a second time.
    """
    from services.term_approvals import apply_gate_b_decision

    summary_id = ctx.params.get("summary_id")
    decision = ctx.params.get("decision")
    if not isinstance(summary_id, str) or not summary_id:
        raise DealError(422, "Choose the summary you reviewed before deciding.")
    if decision not in {"approved", "issue_raised"}:
        raise DealError(422, "That summary decision is not valid.")
    result = apply_gate_b_decision(
        ctx.client,
        ctx.deal["id"],
        summary_id,
        ctx.user_id,
        decision,
        ctx.params.get("comment"),
        ctx.params.get("ip_address", "unknown"),
    )
    return handled(result)


def _guard_contract_executed(ctx: GuardContext) -> GuardOutcome:
    """Approval → Creating only after aligned contract v1 is executed."""
    contracts = (
        ctx.client.table("contracts")
        .select("id")
        .eq("deal_id", ctx.deal["id"])
        .eq("version", 1)
        .eq("status", "executed")
        .execute()
        .data
    )
    if not contracts:
        return deny(409, "The contract still needs all required signatures.")
    from services.contract_alignment import assert_alignment_ready

    assert_alignment_ready(ctx.client, ctx.deal["id"], contracts[0]["id"])
    return allow({"contract_id": contracts[0]["id"]})


def _guard_live_posts(ctx: GuardContext) -> GuardOutcome:
    """Save one verified link and enter Posted only when the final link qualifies."""
    if ctx.params.get("live_post_request") is not True:
        return deny(409, "Submit the live URL on each approved deliverable instead.")
    from services.posting_service import commit_live_post

    return handled(commit_live_post(ctx))


def _guard_post_confirmation(ctx: GuardContext) -> GuardOutcome:
    """Confirm the exact current link set and enter Payment in the same transaction."""
    if ctx.params.get("post_confirmation") is not True:
        return deny(422, "Confirm the exact current set of deliverable versions.")
    from services.posting_service import commit_post_confirmation

    return handled(commit_post_confirmation(ctx))


def _guard_close(ctx: GuardContext) -> GuardOutcome:
    """Persist one side and atomically enter Closed when both sides exist."""
    from services.close_service import confirm_close

    return handled(confirm_close(ctx))


# ─────────────────────────────────────────────────────────────────────────────
# The transition registry — deal-engine.md "Guard conditions" table + the two
# terminal off-ramps. Keyed by (from_stage, to_stage): a pair that isn't a key is
# an illegal move (backward / skip / undefined), which enforces FORWARD-ONLY.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Transition:
    from_stage: str
    to_stage: str
    kind: str  # 'accept-gate' | 'mutual-gate' | 'system-auto' (engine semantics)
    allowed_roles: frozenset[str]  # per-deal roles that may TRIGGER (empty = system)
    requires_recipient: bool  # caller must be the recipient (≠ deals.created_by)
    system_only: bool  # only the internal flow may trigger (system-auto)
    guard: Callable[[GuardContext], GuardOutcome]
    audit_action: str | None

    @property
    def db_type(self) -> str:
        # deal_stage_transitions.transition_type is only ('auto' | 'gated').
        return "auto" if self.kind == "system-auto" else "gated"


ALL_PARTICIPANT_ROLES = frozenset({"creator", "brand_admin", "brand_maker", "brand_checker"})
BRAND_ACTORS = frozenset({"brand_admin", "brand_maker"})
# Checker can't accept/decline/cancel/close (rbac.md "Deal flow — by stage").
RESPONDER_ROLES = frozenset({"creator", "brand_admin", "brand_maker"})

REGISTRY: dict[tuple[str, str], Transition] = {
    # LIVE today — the Pending accept-gate + its terminal off-ramp (task 9.5).
    ("pending", "chatting"): Transition(
        "pending", "chatting", "accept-gate", RESPONDER_ROLES, True, False, _guard_accept, "deal_accept"
    ),
    ("pending", "declined"): Transition(
        "pending", "declined", "accept-gate", RESPONDER_ROLES, True, False, _guard_decline, "deal_decline"
    ),
    # STUBS — role/stage checks are real; the guard fills in with its feature task.
    ("chatting", "approval"): Transition(  # workplan 10-C: versioned all-party Gate B
        "chatting", "approval", "mutual-gate", ALL_PARTICIPANT_ROLES, False, False, _guard_summary_gate_b, "deal_summary_approved"
    ),
    ("chatting", "cancelled"): Transition(  # mutual cancel, pre-signing
        "chatting", "cancelled", "mutual-gate", RESPONDER_ROLES, False, False, _guard_stub, "deal_cancelled"
    ),
    ("approval", "creating"): Transition(  # task 9.12: all signatures collected (SYSTEM-auto)
        "approval", "creating", "system-auto", frozenset(), False, True, _guard_contract_executed, "deal_contract_executed"
    ),
    ("approval", "cancelled"): Transition(  # mutual cancel, blocked once anyone signed
        "approval", "cancelled", "mutual-gate", RESPONDER_ROLES, False, False, _guard_stub, "deal_cancelled"
    ),
    ("creating", "posted"): Transition(  # 9.14-A: per-deliverable verified live URLs
        "creating", "posted", "accept-gate", frozenset({"creator"}), False, False, _guard_live_posts, "deal_posted"
    ),
    ("posted", "payment"): Transition(  # 9.14-A: exact current versions confirmed
        "posted", "payment", "accept-gate", BRAND_ACTORS, False, False, _guard_post_confirmation, "deal_payment_started"
    ),
    ("payment", "closed"): Transition(  # tasks 9.15-9.17: paid + both confirm + not disputed
        "payment", "closed", "mutual-gate", RESPONDER_ROLES, False, False, _guard_close, "deal_closed"
    ),
}

# Forward main-line order (terminal off-ramps declined/cancelled sit off it).
MAIN_LINE = ["pending", "chatting", "approval", "creating", "posted", "payment", "closed"]
ALL_STAGES = set(MAIN_LINE) | {"declined", "cancelled"}
_LABEL = {s: s.capitalize() for s in ALL_STAGES}


def _label(stage: str) -> str:
    return _LABEL.get(stage, stage)


def _classify_invalid_move(from_stage: str, to_stage: str) -> DealError:
    """No registry edge for (from, to): explain WHY with the right status. This is
    where backward moves, stage-skips, and undefined targets are rejected."""
    if to_stage not in ALL_STAGES:
        return DealError(422, "That isn't a valid deal stage.")
    if from_stage in MAIN_LINE and to_stage in MAIN_LINE:
        fi, ti = MAIN_LINE.index(from_stage), MAIN_LINE.index(to_stage)
        if ti <= fi:
            return DealError(409, f"This deal has already moved on — deals only move forward, not back to {_label(to_stage)}.")
        if ti > fi + 1:
            return DealError(409, f"You can't skip ahead to {_label(to_stage)} — the earlier steps must finish first.")
    return DealError(409, f"You can't move this deal to {_label(to_stage)} from {_label(from_stage)}.")


# ─────────────────────────────────────────────────────────────────────────────
# The single enforcement path.
# ─────────────────────────────────────────────────────────────────────────────


def request_transition(
    deal_id: str,
    user_id: str,
    target_stage: str,
    ip_address: str,
    *,
    system: bool = False,
    params: dict[str, Any] | None = None,
    _client: Client | None = None,
) -> dict[str, Any]:
    """Validate + apply a stage transition. The ONE path for every stage change.

    Checks run in deal-engine.md order; the first failure wins:
      (a) deal exists & caller is a participant
      (b) the move is legal (registry lookup → forward-only) & caller's role may
          trigger it (+ recipient rule)
      (c) the deal is in the correct current stage (implicit in the lookup)
      (d) the transition's guard conditions are met
    Only then: apply atomically (RPC), then fire the notification seam.
    """
    # Tests may supply an independent service client to model separate backend
    # workers. Application callers always use the configured singleton.
    client = _client or get_supabase()
    params = dict(params or {})
    params.setdefault("ip_address", ip_address)

    # (a) deal exists & caller is a participant
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None and not system:
        if target_stage == "closed":
            raise DealError(404, "This deal could not be found.")
        raise DealError(403, "You're not part of this deal.")

    # (b/c) legal-move lookup: forward-only / no-skip / no-backward / registry-only.
    # (from == current stage always, so a mismatched current stage lands here too.)
    # A network retry after the final Gate-B transaction may arrive after the
    # deal is already Approval/Creating. Route only that explicit decision back
    # through the same handled guard so Postgres can prove idempotency; no other
    # backward/same-stage request receives this exception.
    gate_b_retry = (
        target_stage == "approval"
        and params.get("gate_b") is True
        and deal["stage"] in {"approval", "creating"}
    )
    live_post_request = (
        target_stage == "posted"
        and params.get("live_post_request") is True
        and deal["stage"] in {"posted", "payment"}
    )
    post_confirmation_retry = (
        target_stage == "payment"
        and params.get("post_confirmation") is True
        and deal["stage"] == "payment"
    )
    close_retry = (
        target_stage == "closed"
        and isinstance(params.get("close_body"), dict)
        and isinstance(params["close_body"].get("request_id"), str)
        and deal["stage"] == "closed"
    )
    if gate_b_retry:
        transition = REGISTRY.get(("chatting", "approval"))
    elif live_post_request:
        transition = REGISTRY.get(("creating", "posted"))
    elif post_confirmation_retry:
        transition = REGISTRY.get(("posted", "payment"))
    elif close_retry:
        transition = REGISTRY.get(("payment", "closed"))
    else:
        transition = REGISTRY.get((deal["stage"], target_stage))
    if transition is None:
        raise _classify_invalid_move(deal["stage"], target_stage)

    # (b) role allowed to trigger
    if transition.system_only and not system:
        raise DealError(409, "This step advances automatically once its conditions are met.")
    if not system:
        if role not in transition.allowed_roles:
            raise DealError(403, "Your role can't take this action on this deal.")
        if transition.requires_recipient and user_id == deal["created_by"]:
            raise DealError(403, "Only the recipient can respond to this connection request.")

    # (d) guard conditions
    outcome = transition.guard(GuardContext(client, deal, user_id, role, params))
    if outcome.kind == "needs_input":
        return {"transitioned": False, **(outcome.payload or {})}
    if outcome.kind == "deny":
        raise DealError(outcome.status, outcome.message or "That action isn't allowed right now.")
    if outcome.kind == "handled":
        result = outcome.payload or {"transitioned": False}
        notifications_handled = bool(result.pop("notifications_handled", False))
        if (
            result.get("transitioned")
            and not result.get("idempotent")
            and not notifications_handled
        ):
            _emit_transition_notification(client, deal, transition, user_id)
        return result

    # Apply atomically: conditional stage UPDATE + transition log + audit, one txn.
    _apply_transition(client, transition, deal_id, user_id, outcome.audit_metadata, ip_address)

    # In-app notification seam (best-effort; full catalogue is Phase 12).
    _emit_transition_notification(client, deal, transition, user_id)

    result: dict[str, Any] = {"transitioned": True, "stage": transition.to_stage}
    if outcome.audit_metadata.get("exclusivity_warning"):
        result["exclusivity_warning"] = outcome.audit_metadata["exclusivity_warning"]
    return result


def _apply_transition(
    client: Client,
    transition: Transition,
    deal_id: str,
    user_id: str,
    audit_metadata: dict[str, Any],
    ip_address: str,
) -> None:
    """Call the atomic RPC. A false return means the deal was no longer in the
    expected `from` stage (a concurrent transition beat us) → 409, no double-apply."""
    resp = client.rpc(
        "apply_stage_transition",
        {
            "p_deal_id": deal_id,
            "p_from_stage": transition.from_stage,
            "p_to_stage": transition.to_stage,
            "p_transition_type": transition.db_type,
            "p_triggered_by": user_id,
            # expires_at only means anything in Pending; clear it as we leave.
            "p_clear_expiry": transition.from_stage == "pending",
            "p_audit_action": transition.audit_action,
            "p_audit_actor": user_id,
            "p_audit_metadata": audit_metadata or {},
            "p_audit_ip": ip_address,
        },
    ).execute()
    applied = resp.data
    if isinstance(applied, list):
        applied = applied[0] if applied else False
    if not applied:
        raise DealError(409, "This deal was just updated by someone else. Refresh and try again.")


def _emit_transition_notification(
    client: Client, deal: dict[str, Any], transition: Transition, actor_id: str
) -> None:
    """Minimal in-app notification for the OTHER participants — the clear seam for
    the Phase-12 notification system (docs/notifications.md). Best-effort: a
    failure here must never roll back a committed transition."""
    try:
        others = (
            client.table("deal_participants")
            .select("profile_id")
            .eq("deal_id", deal["id"])
            .neq("profile_id", actor_id)
            .execute()
        )
        rows = [
            {
                "profile_id": p["profile_id"],
                "tier": "important",
                "title": "Deal updated",
                "body": f"This deal moved to {_label(transition.to_stage)}.",
                "deal_id": deal["id"],
            }
            for p in others.data
        ]
        if rows:
            client.table("notifications").insert(rows).execute()
    except Exception:
        # Seam only — the transition already committed; never surface this.
        pass
