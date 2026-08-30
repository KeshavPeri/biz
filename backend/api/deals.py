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
  approve-summary  chatting → approval      any participant                 LIVE (versioned Gate B)
  cancel           chatting → cancelled     creator/admin/maker             stub → 409 (mutual cancel)
                   approval → cancelled     creator/admin/maker             stub → 409
  submit-live      creating → posted        creator                         stub → 409 (task 9.13)
  confirm-posts    posted   → payment       brand admin/maker               stub → 409 (task 9.14)
  close            payment  → closed        creator/admin/maker             stub → 409 (tasks 9.15-17)

  (approval → creating is SYSTEM-AUTO — fired internally when signatures complete,
   task 9.12 — so it has no endpoint here.)

Chatting Gate A is separate: GET `/{id}/summary-checklist`, then POST
`/{id}/request-summary` and `/confirm-summary-request` persist the 12-field
checklist/other-side confirmation. GET `/{id}/terms-summary` and POST
`/{id}/approve-summary` own the later immutable all-participant Gate B. Other
"stub → 409" endpoints remain wired to the engine (role + stage checks are real).
"""

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

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
from services.contract_service import contract_status, generate_contract, sign_contract, signed_url
from services.contract_alignment import confirm_contract_alignment, start_contract_alignment
from services.term_approvals import get_terms_review
from services.brief_service import acknowledge_brief, create_brief, get_briefs
from services.deliverable_service import get_deliverables

router = APIRouter(prefix="/deals", tags=["deals"])


class ConnectBody(BaseModel):
    target_type: Literal["creator", "brand"]
    target_id: str


class AcceptBody(BaseModel):
    # The recipient re-confirms after seeing a warn-only exclusivity notice.
    acknowledge_exclusivity: bool = False


class ContractSignBody(BaseModel):
    mode: Literal["stored", "drawn", "print_bypass"]
    svg: str | None = None
    bypass_reason: str | None = None
    physical_doc_path: str | None = None


class SummaryDecisionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    summary_id: UUID
    decision: Literal['approved', 'issue_raised']
    comment: str | None = None


class AlignmentOverrideBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extraction_id: UUID


class BriefContentBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    objective: str = Field(min_length=1, max_length=500)
    guidelines: str = Field(default='', max_length=2000)
    dos: list[str] = Field(default_factory=list, max_length=20)
    donts: list[str] = Field(default_factory=list, max_length=20)
    hashtags: list[str] = Field(default_factory=list, max_length=20)
    caption_guidance: str = Field(default='', max_length=2000)

    @field_validator('objective', 'guidelines', 'caption_guidance')
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator('dos', 'donts')
    @classmethod
    def bounded_list_items(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(not item or len(item) > 200 for item in cleaned):
            raise ValueError('Each item must be between 1 and 200 characters.')
        return cleaned

    @field_validator('hashtags')
    @classmethod
    def bounded_hashtags(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(not item or len(item) > 100 for item in cleaned):
            raise ValueError('Each hashtag must be between 1 and 100 characters.')
        return cleaned

    @field_validator('objective')
    @classmethod
    def objective_not_blank(cls, value: str) -> str:
        if not value:
            raise ValueError('Objective must not be blank.')
        return value


class BriefCreateBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    expected_version: int = Field(ge=0)
    content: BriefContentBody


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
    body: SummaryDecisionBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return request_transition(
            deal_id,
            user_id,
            "approval",
            _client_ip(request),
            params={
                'gate_b': True,
                'summary_id': str(body.summary_id),
                'decision': body.decision,
                'comment': body.comment,
                'ip_address': _client_ip(request),
            },
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get('/{deal_id}/terms-summary')
def terms_summary(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return get_terms_review(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get('/{deal_id}/briefs')
def creative_briefs(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return get_briefs(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get('/{deal_id}/deliverables')
def canonical_deliverables(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_deliverables(deal_id, user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/briefs')
def share_creative_brief(
    deal_id: str,
    body: BriefCreateBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return create_brief(
            deal_id,
            user_id,
            body.expected_version,
            body.content.model_dump(mode='json'),
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/briefs/{brief_id}/acknowledge')
def acknowledge_latest_creative_brief(
    deal_id: str,
    brief_id: UUID,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return acknowledge_brief(deal_id, str(brief_id), user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# Gate A: the request + opposite-side confirmation that happens before AI output.
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


@router.post("/{deal_id}/contract")
def generate_current_contract(deal_id: str, request: Request, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return generate_contract(deal_id, user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/contract")
def get_contract_status(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return contract_status(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/contract/alignment")
async def run_contract_alignment(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return await start_contract_alignment(deal_id, user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/contract/alignment/override")
def override_contract_alignment(
    deal_id: str,
    body: AlignmentOverrideBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return confirm_contract_alignment(deal_id, str(body.extraction_id), user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/contract/sign")
def apply_contract_signature(deal_id: str, body: ContractSignBody, request: Request, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return sign_contract(
            deal_id,
            user_id,
            body.mode,
            _client_ip(request),
            body.svg,
            body.bypass_reason,
            body.physical_doc_path,
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/contract/download")
def download_contract(deal_id: str, request: Request, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return signed_url(deal_id, user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


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
