"""Deal endpoints — connect (Phase 8) + the stage-transition contract (task 9.8).

Thin layer over the services: authenticate the caller (core.auth), extract the
client IP, delegate, and map DealError → clean HTTP responses (never a raw trace).

────────────────────────────────────────────────────────────────────────────────
STAGE-TRANSITION CONTRACT (stable — the task 9.7 sticky action bar builds on this)
────────────────────────────────────────────────────────────────────────────────
Every transition endpoint is `POST /deals/{deal_id}/{action}` and delegates to the
ONE engine path, services.stage_engine.request_transition. The client only ever
*requests* a transition; the server validates and applies it.

Response shape (all transition endpoints):
  • advanced      → 200 {"transitioned": true, "stage": "<new stage>"}
                    (accept may also echo "exclusivity_warning" if acknowledged)
  • needs input   → 200 {"transitioned": false, "requires_acknowledgement": true,
                          "exclusivity_warning": "…"}   (accept only — warn-only gate)
  • rejected      → 4xx {"detail": "<friendly message>"}
                    403 not a participant / wrong role / not the recipient
                    404 deal not found
                    409 wrong current stage · backward · skip · not-yet-available ·
                        raced by a concurrent transition
                    410 connection request expired
                    422 unknown target stage

Actions, their target stage, and which per-deal role may call each (rbac.md):
  action           from → to               who may call                  status
  ───────────────  ─────────────────────  ────────────────────────────  ──────
  accept           pending  → chatting     recipient (creator/admin/maker) LIVE
  decline          pending  → declined     recipient (creator/admin/maker) LIVE
  approve-summary  chatting → approval      any participant                 stub → 409 (Gate B / 9.11)
  cancel           chatting → cancelled     creator/admin/maker             stub → 409 (mutual cancel)
                   approval → cancelled     creator/admin/maker             stub → 409
  submit-live      creating → posted        creator                         stub → 409 (task 9.13)
  confirm-posts    posted   → payment       brand admin/maker               stub → 409 (task 9.14)
  close            payment  → closed        creator/admin/maker             stub → 409 (tasks 9.15-17)

  (approval → creating is SYSTEM-AUTO — fired internally when signatures complete,
   task 9.12 — so it has no endpoint here.)

Chatting Gate A is separate: GET `/{id}/summary-checklist`, then POST
`/{id}/request-summary` and `/confirm-summary-request` persist the 12-field
checklist/other-side confirmation. `approve-summary` remains Gate B and stays a
stub until all-party term approvals exist. Other "stub → 409" endpoints are
wired to the engine now (role + stage checks are real); their guard returns "not
available yet" until the owning task fills it in.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.auth import get_current_user_id
from services.deals import DealError, accept_deal, connect_deal, decline_deal
from services.stage_engine import request_transition
from services.summary_gate import (
    confirm_override,
    confirm_summary,
    decline_summary,
    get_summary_checklist,
    propose_override,
    request_summary,
)

router = APIRouter(prefix="/deals", tags=["deals"])


class ConnectBody(BaseModel):
    target_type: Literal["creator", "brand"]
    target_id: str


class AcceptBody(BaseModel):
    # The recipient re-confirms after seeing a warn-only exclusivity notice.
    acknowledge_exclusivity: bool = False


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _transition(deal_id: str, user_id: str, target_stage: str, request: Request) -> dict[str, Any]:
    """Delegate a stage transition to the engine, mapping DealError → HTTP."""
    try:
        return request_transition(deal_id, user_id, target_stage, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def _summary_action(coro: Any) -> dict[str, Any]:
    """Map Gate-A service errors to the same clean public API contract."""
    try:
        return await coro
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/connect")
def connect(
    body: ConnectBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return connect_deal(user_id, body.target_type, body.target_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/accept")
def accept(
    deal_id: str,
    body: AcceptBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return accept_deal(user_id, deal_id, _client_ip(request), body.acknowledge_exclusivity)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/decline")
def decline(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return decline_deal(user_id, deal_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/approve-summary")
def approve_summary(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(deal_id, user_id, "approval", request)


# Gate A: the request + opposite-side confirmation that happens before any AI
# output exists. Gate B remains POST /approve-summary in its intentional 409 stub
# until Phase 10/9.11 builds all-party term approvals.
@router.get("/{deal_id}/summary-checklist")
async def summary_checklist(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    return await _summary_action(get_summary_checklist(deal_id, user_id))


@router.post("/{deal_id}/request-summary")
async def request_terms_summary(
    deal_id: str, request: Request, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    return await _summary_action(request_summary(deal_id, user_id, _client_ip(request)))


@router.post("/{deal_id}/confirm-summary-request")
async def confirm_terms_summary_request(
    deal_id: str, request: Request, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    return await _summary_action(confirm_summary(deal_id, user_id, _client_ip(request)))


@router.post("/{deal_id}/summary-request-not-yet")
async def summary_request_not_yet(
    deal_id: str, request: Request, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    return await _summary_action(decline_summary(deal_id, user_id, _client_ip(request)))


@router.post("/{deal_id}/summary-checklist/{field_key}/override")
async def propose_checklist_override(
    deal_id: str, field_key: str, request: Request, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    return await _summary_action(propose_override(deal_id, field_key, user_id, _client_ip(request)))


@router.post("/{deal_id}/summary-checklist/{field_key}/confirm-override")
async def confirm_checklist_override(
    deal_id: str, field_key: str, request: Request, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    return await _summary_action(confirm_override(deal_id, field_key, user_id, _client_ip(request)))


@router.post("/{deal_id}/cancel")
def cancel(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(deal_id, user_id, "cancelled", request)


@router.post("/{deal_id}/submit-live")
def submit_live(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(deal_id, user_id, "posted", request)


@router.post("/{deal_id}/confirm-posts")
def confirm_posts(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(deal_id, user_id, "payment", request)


@router.post("/{deal_id}/close")
def close(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(deal_id, user_id, "closed", request)
