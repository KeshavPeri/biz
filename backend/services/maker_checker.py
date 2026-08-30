"""Maker-checker enforcement (task 7.10).

The segregation-of-duties mechanism, enforced SERVER-SIDE (docs/rbac.md). A maker
initiates a gated action; if the brand configured that action to need a checker,
the action is HELD as a pending request; the assigned checker (who must be a
different person) approves or rejects. Every step writes an immutable audit_log
row.

Runs on the service_role client (bypasses RLS), so this module enforces every
rule itself and never trusts the caller's identity — that is verified upstream by
core.auth.get_current_user_id.

Generic payment-release requests still exercise only the lifecycle mechanism.
Contract signing and content approval delegate to their owning services so a
request can never become approved separately from its held action.
"""

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from core.supabase_client import get_supabase

# Per-deal operative roles that may INITIATE a gated action (rbac.md).
INITIATOR_ROLES = {"brand_admin", "brand_maker"}
CHECKER_ROLE = "brand_checker"

VALID_ACTIONS = {"payment_release", "contract_signing", "content_approval"}


class MakerCheckerError(Exception):
    """Raised for a rule/precondition failure; carries the HTTP status to return."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _deal_brand_id(client: Client, deal_id: str) -> str | None:
    resp = client.table("deals").select("brand_id").eq("id", deal_id).execute()
    return resp.data[0]["brand_id"] if resp.data else None


def _participant_role(client: Client, deal_id: str, profile_id: str) -> str | None:
    resp = (
        client.table("deal_participants")
        .select("participant_role")
        .eq("deal_id", deal_id)
        .eq("profile_id", profile_id)
        .execute()
    )
    return resp.data[0]["participant_role"] if resp.data else None


def _requires_checker(client: Client, brand_id: str, action_type: str) -> bool:
    """Unconfigured action ⇒ no checker required (the brand runs maker-alone)."""
    resp = (
        client.table("maker_checker_config")
        .select("requires_checker")
        .eq("brand_id", brand_id)
        .eq("action_type", action_type)
        .execute()
    )
    return bool(resp.data and resp.data[0]["requires_checker"])


def _assigned_checker(client: Client, deal_id: str) -> str | None:
    """The deal's single assigned checker (MVP: one checker per deal)."""
    resp = (
        client.table("deal_participants")
        .select("profile_id")
        .eq("deal_id", deal_id)
        .eq("participant_role", CHECKER_ROLE)
        .execute()
    )
    return resp.data[0]["profile_id"] if resp.data else None


def _audit(
    client: Client,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, Any],
    ip_address: str,
) -> None:
    client.table("audit_log").insert(
        {
            "actor_id": actor_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "metadata": metadata,
            "ip_address": ip_address,
        }
    ).execute()


def initiate_action(
    user_id: str,
    deal_id: str,
    action_type: str,
    ip_address: str,
    *,
    action_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A maker initiates a gated action. Returns 'executed' (ran directly) or
    'held' (a pending checker request was created)."""
    client = get_supabase()

    if action_type not in VALID_ACTIONS:
        raise MakerCheckerError(422, "Unknown action type.")

    brand_id = _deal_brand_id(client, deal_id)
    if brand_id is None:
        raise MakerCheckerError(404, "Deal not found.")

    # RBAC: only a brand admin/maker ON THIS DEAL may initiate.
    role = _participant_role(client, deal_id, user_id)
    if role not in INITIATOR_ROLES:
        raise MakerCheckerError(403, "You can't initiate this action on this deal.")

    # A real contract-signing approval must carry the validated, snapshotted
    # signature created by contract_service. The generic endpoint cannot create
    # an empty request that blocks the actual deal flow.
    if action_type in {"contract_signing", "content_approval"} and action_payload is None:
        action_label = "contract signing" if action_type == "contract_signing" else "content approval"
        raise MakerCheckerError(409, f"Start {action_label} from its card in this deal.")

    if not _requires_checker(client, brand_id, action_type):
        # No checker gate — the caller's owning service executes the action.
        _audit(
            client, user_id, "maker_checker.executed_direct", "deal", deal_id,
            {"action_type": action_type, "requires_checker": False}, ip_address,
        )
        return {"status": "executed", "requires_checker": False}

    checker_id = _assigned_checker(client, deal_id)
    if checker_id is None:
        raise MakerCheckerError(409, "No checker is assigned to this deal yet.")
    # Segregation of duties — refuse to let one person hold both hats.
    if checker_id == user_id:
        raise MakerCheckerError(
            403, "You can't be both maker and checker on the same action."
        )

    if action_type == "contract_signing" and action_payload is not None:
        try:
            return client.rpc(
                "create_held_contract_signing_request",
                {
                    "p_deal_id": deal_id,
                    "p_initiated_by": user_id,
                    "p_checker_id": checker_id,
                    "p_contract_id": action_payload["contract_id"],
                    "p_signature_mode": action_payload["mode"],
                    "p_signature_ref": action_payload["signature_ref"],
                    "p_bypass_reason": action_payload.get("bypass_reason"),
                    "p_physical_doc_path": action_payload.get("physical_doc_path"),
                    "p_signer_ip_address": action_payload["ip_address"],
                },
            ).execute().data
        except Exception as exc:
            if "pending_contract_signing_exists" in str(exc):
                raise MakerCheckerError(409, "Another signing approval is already waiting for the checker.") from exc
            raise MakerCheckerError(500, "The signing approval could not be saved. Please try again.") from exc

    request_row = {
        "deal_id": deal_id,
        "action_type": action_type,
        "initiated_by": user_id,
        "checker_id": checker_id,
        "status": "pending",
    }
    if action_payload is not None:
        request_row["action_payload"] = action_payload
    try:
        inserted = client.table("maker_checker_requests").insert(request_row).execute()
    except Exception as exc:
        # A concurrent retry may have won the pending-request unique index. The
        # same maker/payload is idempotent; a different live action is a conflict.
        pending = (
            client.table("maker_checker_requests")
            .select("id,initiated_by,checker_id,action_payload")
            .eq("deal_id", deal_id)
            .eq("action_type", action_type)
            .eq("status", "pending")
            .limit(1)
            .execute()
            .data
        )
        if pending and pending[0]["initiated_by"] == user_id and pending[0].get("action_payload") == action_payload:
            return {
                "status": "held",
                "requires_checker": True,
                "request_id": pending[0]["id"],
                "checker_id": pending[0]["checker_id"],
                "idempotent": True,
            }
        raise MakerCheckerError(409, "Another signing approval is already waiting for the checker.") from exc
    request_id = inserted.data[0]["id"]
    _audit(
        client, user_id, "maker_checker.request_created", "maker_checker_request",
        request_id, {"action_type": action_type, "checker_id": checker_id}, ip_address,
    )
    return {"status": "held", "requires_checker": True, "request_id": request_id, "checker_id": checker_id}


def decide_request(
    user_id: str, request_id: str, decision: str, comment: str | None, ip_address: str
) -> dict[str, Any]:
    """The assigned checker approves or rejects a held request."""
    client = get_supabase()

    if decision not in {"approve", "reject"}:
        raise MakerCheckerError(422, "Decision must be 'approve' or 'reject'.")

    resp = (
        client.table("maker_checker_requests").select("*").eq("id", request_id).execute()
    )
    if not resp.data:
        raise MakerCheckerError(404, "Approval request not found.")
    request = resp.data[0]

    if request["status"] != "pending":
        raise MakerCheckerError(409, "This request has already been decided.")

    # Segregation of duties (defense in depth): the maker can NEVER approve their
    # own action, even if role data were somehow inconsistent.
    if request["initiated_by"] == user_id:
        raise MakerCheckerError(403, "You can't approve your own action.")
    # Only the assigned checker may decide.
    if request["checker_id"] != user_id:
        raise MakerCheckerError(403, "You aren't the assigned checker for this action.")
    # And they must actually hold the checker role on the deal.
    if _participant_role(client, request["deal_id"], user_id) != CHECKER_ROLE:
        raise MakerCheckerError(403, "You don't hold the checker role on this deal.")

    # Contract signing is the one action whose approval releases a real held
    # signature. Its request decision + signature + both audit rows are one DB
    # transaction (migration 022), so a crash can never approve without signing.
    if request["action_type"] == "contract_signing":
        from services.contract_service import decide_held_contract_signature

        try:
            return decide_held_contract_signature(request, user_id, decision, comment, ip_address)
        except Exception as exc:
            # Avoid importing DealError at module load (stage_engine imports this
            # module through contract_service). Preserve its friendly contract.
            if hasattr(exc, "status_code") and hasattr(exc, "detail"):
                raise MakerCheckerError(exc.status_code, exc.detail) from exc
            raise

    if request["action_type"] == "content_approval":
        from services.content_service import decide_held_content_approval

        try:
            return decide_held_content_approval(request_id, user_id, decision, comment, ip_address)
        except Exception as exc:
            if hasattr(exc, "status_code") and hasattr(exc, "detail"):
                raise MakerCheckerError(exc.status_code, exc.detail) from exc
            raise

    new_status = "approved" if decision == "approve" else "rejected"
    updated = client.table("maker_checker_requests").update(
        {
            "status": new_status,
            "comment": comment,
            "decided_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", request_id).eq("status", "pending").execute()
    if not updated.data:
        raise MakerCheckerError(409, "This request has already been decided.")

    _audit(
        client, user_id, f"maker_checker.{new_status}", "maker_checker_request",
        request_id,
        {"action_type": request["action_type"], "initiated_by": request["initiated_by"]},
        ip_address,
    )
    return {"status": new_status, "request_id": request_id}
