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
  confirm-posts    posted   → payment       brand admin/maker               LIVE (post + payment-detail versions)
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

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
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
from services.deliverable_detail_service import get_deliverable_detail
from services.content_service import (
    approve_submission,
    prepare_upload,
    request_revision,
    submission_download,
    stream_submission,
    submit_upload,
)
from services.posting_service import flag_live_post, submit_live_post
from services.payment_details_service import (
    get_payment_details,
    update_brand_details,
    update_creator_details,
)
from services.payment_tracking_service import (
    confirm_receipt,
    get_payment_tracking,
    update_milestone_state,
    update_payment_state,
)
from services.close_service import get_close_status
from services.post_close_service import append_entry, get_entries, get_ratings, submit_rating
from services.chat_archive_service import archive_download, get_archive_status, prepare_archive
from services.dispute_service import (
    DisputeConflict,
    get_disputes,
    raise_dispute,
)
from services.participant_service import (
    create_participant_request,
    decide_participant_request,
    get_participant_management,
)
from services.deal_name_service import rename_deal

router = APIRouter(prefix="/deals", tags=["deals"])


class ConnectBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    target_type: Literal["creator", "brand"]
    target_id: UUID
    category: str
    acknowledgement_digest: str | None = Field(default=None, min_length=64, max_length=64,
                                               pattern=r'^[a-f0-9]{64}$')

    @field_validator('category')
    @classmethod
    def validate_category(cls, value: str) -> str:
        from services.exclusivity_conflicts import valid_category
        return valid_category(value, trim=False)


class AcceptBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # The recipient re-confirms after seeing a warn-only exclusivity notice.
    acknowledge_exclusivity: bool = False
    acknowledgement_digest: str | None = Field(default=None, min_length=64, max_length=64,
                                               pattern=r'^[a-f0-9]{64}$')


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


class ParticipantRequestBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    request_id: UUID
    proposed_profile_id: UUID
    proposed_role: Literal['brand_admin', 'brand_maker', 'brand_checker']
    reason: str = Field(min_length=1, max_length=500)

    @field_validator('reason')
    @classmethod
    def participant_reason_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Add a reason for this request.')
        return value


class ParticipantDecisionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    decision: Literal['approved', 'rejected']


class DealNameBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    deal_name: str = Field(min_length=1, max_length=640)
    expected_version: int = Field(ge=0)


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


class ContentPrepareBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    original_filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=100)
    size_bytes: int

    @field_validator('original_filename', 'mime_type')
    @classmethod
    def strip_content_text(cls, value: str) -> str:
        return value.strip()


class ContentSubmitBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    reservation_id: UUID
    expected_round: int = Field(ge=1)


class RevisionRequestBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    revision_id: UUID
    comment: str = Field(min_length=3, max_length=1000)

    @field_validator('comment')
    @classmethod
    def strip_revision_comment(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError('Add a revision explanation of at least 3 characters.')
        return value


class ContentApproveBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    revision_id: UUID


class LivePostSubmitBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    url: str = Field(min_length=1, max_length=2048)
    expected_version: int = Field(ge=0)

    @field_validator('url')
    @classmethod
    def strip_live_post_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Enter a live post URL.')
        return value


class LivePostFlagBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)

    @field_validator('reason')
    @classmethod
    def strip_flag_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError('Explain the link issue in at least 3 characters.')
        return value


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _transition(
    deal_id: str,
    user_id: str,
    target_stage: str,
    request: Request,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Delegate a stage transition to the engine, mapping DealError → HTTP."""
    try:
        return request_transition(
            deal_id, user_id, target_stage, _client_ip(request), params=params
        )
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
        return connect_deal(user_id, body.target_type, str(body.target_id), _client_ip(request),
                            body.category, body.acknowledgement_digest)
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
        return accept_deal(user_id, deal_id, _client_ip(request), body.acknowledge_exclusivity,
                           body.acknowledgement_digest)
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


@router.get('/{deal_id}/participants')
def participant_management(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    try:
        return get_participant_management(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put('/{deal_id}/name')
def update_deal_name(
    deal_id: str,
    body: DealNameBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return rename_deal(
            deal_id, user_id, body.expected_version, body.deal_name, _client_ip(request)
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/participant-requests')
def request_participant_addition(
    deal_id: str,
    body: ParticipantRequestBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return create_participant_request(
            deal_id, user_id, str(body.request_id), str(body.proposed_profile_id),
            body.proposed_role, body.reason, _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/participant-requests/{participant_request_id}/decision')
def decide_participant_addition(
    deal_id: str,
    participant_request_id: UUID,
    body: ParticipantDecisionBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return decide_participant_request(
            deal_id, str(participant_request_id), user_id, body.decision, _client_ip(request),
        )
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


@router.get('/{deal_id}/deliverables/{deliverable_id}/detail')
def deliverable_detail(
    deal_id: str,
    deliverable_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_deliverable_detail(deal_id, deliverable_id, user_id)
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


@router.post('/{deal_id}/deliverables/{deliverable_id}/content/prepare')
def prepare_content_upload(
    deal_id: str,
    deliverable_id: UUID,
    body: ContentPrepareBody,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return prepare_upload(
            deal_id,
            str(deliverable_id),
            user_id,
            body.original_filename,
            body.mime_type,
            body.size_bytes,
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/deliverables/{deliverable_id}/content/submit')
def submit_content_upload(
    deal_id: str,
    deliverable_id: UUID,
    body: ContentSubmitBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return submit_upload(
            deal_id,
            str(deliverable_id),
            str(body.reservation_id),
            body.expected_round,
            user_id,
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/deliverables/{deliverable_id}/content/request-revision')
def request_content_changes(
    deal_id: str,
    deliverable_id: UUID,
    body: RevisionRequestBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return request_revision(
            deal_id,
            str(deliverable_id),
            str(body.revision_id),
            user_id,
            body.comment,
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/deliverables/{deliverable_id}/content/approve')
def approve_content(
    deal_id: str,
    deliverable_id: UUID,
    body: ContentApproveBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return approve_submission(
            deal_id,
            str(deliverable_id),
            str(body.revision_id),
            user_id,
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/deliverables/{deliverable_id}/live-post')
def submit_deliverable_live_post(
    deal_id: str,
    deliverable_id: UUID,
    body: LivePostSubmitBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return submit_live_post(
            deal_id,
            str(deliverable_id),
            user_id,
            body.url,
            body.expected_version,
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post('/{deal_id}/deliverables/{deliverable_id}/live-post/flag')
def flag_deliverable_live_post(
    deal_id: str,
    deliverable_id: UUID,
    body: LivePostFlagBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return flag_live_post(
            deal_id,
            str(deliverable_id),
            user_id,
            body.expected_version,
            body.reason,
            _client_ip(request),
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get('/{deal_id}/deliverables/{deliverable_id}/content/{revision_id}/download')
def download_content_submission(
    deal_id: str,
    deliverable_id: UUID,
    revision_id: UUID,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        result = submission_download(
            deal_id,
            str(deliverable_id),
            str(revision_id),
            user_id,
            _client_ip(request),
        )
        result['url'] = str(request.url_for(
            'stream_content_download', revision_id=str(revision_id)
        ).include_query_params(token=result.pop('download_token')))
        return result
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get('/content-download/{revision_id}', name='stream_content_download')
def stream_content_download(revision_id: UUID, token: str) -> StreamingResponse:
    try:
        body, mime_type, filename = stream_submission(str(revision_id), token)
        safe_name = filename.replace('"', '').replace('\r', '').replace('\n', '')
        return StreamingResponse(
            body,
            media_type=mime_type,
            headers={'Content-Disposition': f'attachment; filename="{safe_name}"'},
        )
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


@router.get("/{deal_id}/payment-details")
def read_payment_details(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_payment_details(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/{deal_id}/payment-details/creator")
def save_creator_payment_details(
    deal_id: str,
    body: dict[str, Any],
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return update_creator_details(deal_id, user_id, body, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/{deal_id}/payment-details/brand")
def save_brand_payment_details(
    deal_id: str,
    body: dict[str, Any],
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return update_brand_details(deal_id, user_id, body, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


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
    body: dict[str, Any],
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    return _transition(
        deal_id,
        user_id,
        "payment",
        request,
        {
            "post_confirmation": True,
            "confirmation_body": body,
        },
    )


@router.post("/{deal_id}/close")
def close(
    deal_id: str,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    result = _transition(
        deal_id,
        user_id,
        "closed",
        request,
        {"close_body": body},
    )
    if result.get("stage") == "closed":
        try:
            result["chat_archive"] = prepare_archive(
                deal_id, user_id, _client_ip(request), explicit_retry=False
            )
        except DealError:
            # Closing is authoritative and must never roll back or look failed
            # merely because post-commit document work needs an explicit retry.
            try:
                result["chat_archive"] = get_archive_status(deal_id, user_id)
            except DealError:
                result["chat_archive"] = {
                    "deal_id": deal_id,
                    "state": "failed",
                    "failure": "The chat record could not be prepared safely.",
                    "allowed_actions": {"can_retry": True, "can_download": False},
                }
    return result


@router.get("/{deal_id}/close-status")
def read_close_status(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_close_status(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/post-close/ratings")
def read_post_close_ratings(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_ratings(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/post-close/ratings")
def create_post_close_rating(
    deal_id: str,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return submit_rating(deal_id, user_id, body, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/post-close/entries")
def read_post_close_entries(
    deal_id: str,
    visibility: Literal["shared", "private"] = Query(...),
    limit: int = Query(20, ge=1, le=50),
    cursor: str | None = Query(None, max_length=512),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_entries(deal_id, user_id, visibility, limit, cursor)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/post-close/entries")
def create_post_close_entry(
    deal_id: str,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return append_entry(deal_id, user_id, body)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/chat-archive")
def read_chat_archive(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_archive_status(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/chat-archive/prepare")
def retry_chat_archive(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return prepare_archive(deal_id, user_id, _client_ip(request), explicit_retry=True)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/chat-archive/download")
def download_chat_archive(
    deal_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return archive_download(deal_id, user_id, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/payment-tracking")
def read_payment_tracking(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_payment_tracking(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/{deal_id}/payment-tracking/state")
def report_payment_state(
    deal_id: str,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return update_payment_state(deal_id, user_id, body, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/{deal_id}/payment-tracking/milestones/{milestone_id}/state")
def report_payment_milestone_state(
    deal_id: str,
    milestone_id: UUID,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return update_milestone_state(
            deal_id, str(milestone_id), user_id, body, _client_ip(request)
        )
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/payment-tracking/confirm-receipt")
def confirm_payment_receipt(
    deal_id: str,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return confirm_receipt(deal_id, user_id, body, _client_ip(request))
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{deal_id}/disputes")
def read_disputes(
    deal_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return get_disputes(deal_id, user_id)
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/{deal_id}/disputes")
def open_dispute(
    deal_id: str,
    request: Request,
    body: Any = Body(...),
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        return raise_dispute(deal_id, user_id, body, _client_ip(request))
    except DisputeConflict as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"message": exc.detail, "disputes": exc.projection},
        ) from exc
    except DealError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
