"""Secure Creating-stage draft submissions and revision requests.

The browser uploads only to a backend-prepared opaque Storage path. Postgres
owns the round counter and lifecycle transitions; this service verifies the
stored object's metadata and leading bytes before invoking those atomic RPCs.
"""

from __future__ import annotations

import logging
import base64
import hashlib
import hmac
import time
import threading
from functools import wraps
from typing import Any, NoReturn

import httpx
from supabase import Client

from core.supabase_client import get_supabase
from core.config import settings
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role

BUCKET = 'content-drafts'
MAX_DRAFT_BYTES = 100 * 1024 * 1024
SIGNED_URL_TTL_SECONDS = 300
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
}

logger = logging.getLogger(__name__)
_CONTENT_LOCK = threading.RLock()


def _serialized(function: Any) -> Any:
    """Keep the shared synchronous Supabase client safe inside one worker."""
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        with _CONTENT_LOCK:
            return function(*args, **kwargs)
    return wrapped

_RPC_ERRORS: dict[str, tuple[int, str]] = {
    'CONTENT_DEAL_NOT_FOUND': (404, 'This deal could not be found.'),
    'CONTENT_NOT_PARTICIPANT': (403, "You're not part of this deal."),
    'CONTENT_CREATOR_ONLY': (403, 'Only the creator named on this deal can submit a draft.'),
    'CONTENT_REVIEWER_ONLY': (403, 'Only a brand admin or maker can review this submission.'),
    'CONTENT_WRONG_STAGE': (409, 'Drafts can only be submitted and reviewed while the deal is Creating.'),
    'CONTENT_DELIVERABLE_NOT_FOUND': (404, 'This deliverable could not be found.'),
    'CONTENT_REVISION_NOT_FOUND': (404, 'This submission could not be found.'),
    'CONTENT_UPLOAD_NOT_FOUND': (404, 'This prepared upload could not be found.'),
    'CONTENT_UPLOAD_MISSING': (409, 'The draft upload is missing. Choose the file again.'),
    'CONTENT_UPLOAD_EXPIRED': (409, 'This upload expired. Choose the file again.'),
    'CONTENT_UPLOAD_LIMIT_REACHED': (409, 'Too many draft uploads are waiting. Retry after the current uploads expire.'),
    'CONTENT_UNSUPPORTED_TYPE': (415, 'Choose a PDF, JPEG, PNG, WebP, MP4, or MOV file.'),
    'CONTENT_UPLOAD_METADATA_MISMATCH': (415, 'The uploaded file does not match the prepared file. Choose it again.'),
    'CONTENT_FILE_TOO_LARGE': (413, 'Choose a draft no larger than 100 MB.'),
    'CONTENT_INVALID_FILENAME': (422, 'Choose a file with a valid name.'),
    'CONTENT_INVALID_COMMENT': (422, 'Add a revision explanation between 3 and 1,000 characters.'),
    'CONTENT_NOT_SUBMITTABLE': (409, 'This deliverable is not ready for another draft.'),
    'CONTENT_OPS_PAUSED': (409, 'Contracted revision rounds are exhausted. Platform help is needed before more work continues.'),
    'CONTENT_STALE_ROUND': (409, 'The revision round changed. Refresh before submitting.'),
    'CONTENT_STALE_REVISION': (409, 'This submission is no longer awaiting review.'),
    'CONTENT_ALREADY_DECIDED': (409, 'This submission has already been reviewed.'),
    'CONTENT_CHECKER_MISSING': (409, 'No active checker is assigned to this deal yet.'),
    'CONTENT_SELF_APPROVAL': (403, "You can't approve your own held action."),
    'CONTENT_PENDING_APPROVAL_EXISTS': (409, 'Another approval is already waiting for this submission.'),
    'CONTENT_REQUEST_NOT_FOUND': (404, 'This content approval request could not be found.'),
    'CONTENT_REQUEST_PAYLOAD_MISSING': (409, 'This content approval request is incomplete and cannot be released.'),
    'CONTENT_REQUEST_ALREADY_DECIDED': (409, 'This content approval request has already been decided.'),
    'CONTENT_NOT_ASSIGNED_CHECKER': (403, "You aren't the assigned checker for this content approval."),
    'CONTENT_CHECKER_ROLE_REQUIRED': (403, "You don't hold the active checker role on this deal."),
    'CONTENT_MAKER_ROLE_REQUIRED': (403, 'The initiating maker is no longer eligible for this action.'),
    'CONTENT_STALE_REQUEST': (409, 'This approval is stale because the active submission or deal changed.'),
    'CONTENT_INVALID_DECISION': (422, "Decision must be 'approve' or 'reject'."),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, 'message', '') or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    logger.exception('Content submission database operation failed')
    raise DealError(500, 'The content action could not be completed. Please try again.') from exc


def _rpc(client: Client, name: str, params: dict[str, Any]) -> Any:
    try:
        return client.rpc(name, params).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


@_serialized
def prepare_upload(
    deal_id: str,
    deliverable_id: str,
    user_id: str,
    original_filename: str,
    mime_type: str,
    size_bytes: int,
) -> dict[str, Any]:
    cleanup_expired_uploads()
    if mime_type not in ALLOWED_MIME_TYPES:
        raise DealError(415, 'Choose a PDF, JPEG, PNG, WebP, MP4, or MOV file.')
    if size_bytes < 1 or size_bytes > MAX_DRAFT_BYTES:
        raise DealError(413, 'Choose a draft no larger than 100 MB.')
    return _rpc(
        get_supabase(),
        'prepare_content_draft_upload',
        {
            'p_deal_id': deal_id,
            'p_deliverable_id': deliverable_id,
            'p_actor_id': user_id,
            'p_original_filename': original_filename,
            'p_mime_type': mime_type,
            'p_size_bytes': size_bytes,
        },
    )


def cleanup_expired_uploads(*, limit: int = 25, _client: Client | None = None) -> dict[str, int]:
    """Remove at most 25 expired unbound objects through the Storage API.

    Claims are leased in Postgres so concurrent workers do not delete the same
    object. A failed Storage removal releases the lease for a later safe retry.
    """
    client = _client or get_supabase()
    claimed = _rpc(client, 'claim_expired_content_draft_uploads', {'p_limit': limit})
    removed = 0
    released = 0
    for upload in claimed:
        try:
            client.storage.from_(BUCKET).remove([upload['object_path']])
            completed = _rpc(
                client,
                'complete_expired_content_draft_upload_cleanup',
                {'p_upload_id': upload['id']},
            )
            removed += int(bool(completed))
        except Exception:
            logger.warning('Could not clean an expired content upload', exc_info=True)
            try:
                _rpc(
                    client,
                    'release_expired_content_draft_upload_cleanup',
                    {'p_upload_id': upload['id']},
                )
                released += 1
            except DealError:
                logger.warning('Could not release an expired content cleanup claim', exc_info=True)
    return {'claimed': len(claimed), 'removed': removed, 'released': released}


def _sniff_mime(header: bytes) -> str | None:
    if header.startswith(b'%PDF-'):
        return 'application/pdf'
    if header.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if header.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if len(header) >= 12 and header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return 'image/webp'
    if len(header) >= 12 and header[4:8] == b'ftyp':
        return 'video/quicktime' if header[8:12] == b'qt  ' else 'video/mp4'
    return None


def _stored_header(client: Client, path: str) -> bytes:
    result = client.storage.from_(BUCKET).create_signed_url(path, 60)
    url = result.get('signedURL') or result.get('signedUrl')
    if not url:
        raise DealError(500, 'The uploaded draft could not be verified. Please try again.')
    try:
        header = bytearray()
        with httpx.stream('GET', url, headers={'Range': 'bytes=0-4095'}, timeout=20) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes():
                header.extend(chunk[: 4096 - len(header)])
                if len(header) >= 4096:
                    break
        return bytes(header)
    except httpx.HTTPError as exc:
        logger.warning('Could not inspect prepared content upload', exc_info=True)
        raise DealError(500, 'The uploaded draft could not be verified. Please try again.') from exc


@_serialized
def submit_upload(
    deal_id: str,
    deliverable_id: str,
    reservation_id: str,
    expected_round: int,
    user_id: str,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()
    inspection = _rpc(
        client,
        'inspect_content_draft_upload',
        {
            'p_deal_id': deal_id,
            'p_deliverable_id': deliverable_id,
            'p_reservation_id': reservation_id,
            'p_actor_id': user_id,
        },
    )
    if not inspection.get('already_bound'):
        actual_size = inspection.get('actual_size_bytes')
        expected_size = inspection.get('expected_size_bytes')
        if not isinstance(actual_size, int) or actual_size != expected_size or actual_size > MAX_DRAFT_BYTES:
            raise DealError(413, 'The uploaded file size changed. Choose the file again.')
        expected_mime = inspection.get('expected_mime_type')
        if inspection.get('actual_mime_type') != expected_mime:
            raise DealError(415, 'The uploaded file type changed. Choose the file again.')
        if _sniff_mime(_stored_header(client, inspection['object_path'])) != expected_mime:
            raise DealError(415, 'The file contents do not match its type. Choose a valid draft file.')
    return _rpc(
        client,
        'submit_content_draft',
        {
            'p_deal_id': deal_id,
            'p_deliverable_id': deliverable_id,
            'p_reservation_id': reservation_id,
            'p_actor_id': user_id,
            'p_expected_round': expected_round,
            'p_ip_address': ip_address,
        },
    )


@_serialized
def request_revision(
    deal_id: str,
    deliverable_id: str,
    revision_id: str,
    user_id: str,
    comment: str,
    ip_address: str,
) -> dict[str, Any]:
    return _rpc(
        get_supabase(),
        'request_content_revision',
        {
            'p_deal_id': deal_id,
            'p_deliverable_id': deliverable_id,
            'p_revision_id': revision_id,
            'p_actor_id': user_id,
            'p_comment': comment,
            'p_ip_address': ip_address,
        },
    )


@_serialized
def approve_submission(
    deal_id: str,
    deliverable_id: str,
    revision_id: str,
    user_id: str,
    ip_address: str,
) -> dict[str, Any]:
    """Approve directly or create one exact-submission checker hold."""
    return _rpc(
        get_supabase(),
        'approve_content_submission',
        {
            'p_deal_id': deal_id,
            'p_deliverable_id': deliverable_id,
            'p_revision_id': revision_id,
            'p_actor_id': user_id,
            'p_ip_address': ip_address,
        },
    )


@_serialized
def decide_held_content_approval(
    request_id: str,
    checker_id: str,
    decision: str,
    comment: str | None,
    ip_address: str,
) -> dict[str, Any]:
    """Release or reject a held maker action in one database transaction."""
    return _rpc(
        get_supabase(),
        'decide_content_approval_request',
        {
            'p_request_id': request_id,
            'p_checker_id': checker_id,
            'p_decision': decision,
            'p_comment': comment,
            'p_ip_address': ip_address,
        },
    )


def participant_content_view(
    client: Client,
    deal_id: str,
    user_id: str,
    deliverables: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")
    deliverable_ids = [row['id'] for row in deliverables]
    revisions = []
    if deliverable_ids:
        revisions = (
            client.table('revisions')
            .select(
                'id,deliverable_id,round_number,lifecycle,submitted_by,submitted_at,'
                'original_filename,mime_type,size_bytes,comment,decided_by,decided_at'
            )
            .in_('deliverable_id', deliverable_ids)
            .order('round_number', desc=True)
            .execute()
            .data
        )
    approval_requests = []
    if deliverable_ids:
        approval_requests = (
            client.table('maker_checker_requests')
            .select(
                'id,deal_id,initiated_by,checker_id,status,comment,created_at,decided_at,action_payload'
            )
            .eq('deal_id', deal_id)
            .eq('action_type', 'content_approval')
            .order('created_at', desc=True)
            .execute()
            .data
        )
    actor_ids = {
        value
        for row in revisions
        for value in (row.get('submitted_by'), row.get('decided_by'))
        if value
    } | {
        value
        for row in approval_requests
        for value in (row.get('initiated_by'), row.get('checker_id'))
        if value
    }
    names: dict[str, str] = {}
    if actor_ids:
        profiles = client.table('profiles').select('id,display_name').in_('id', list(actor_ids)).execute().data
        names = {row['id']: row['display_name'] for row in profiles}
    by_deliverable: dict[str, list[dict[str, Any]]] = {row_id: [] for row_id in deliverable_ids}
    for revision in revisions:
        safe = {
            'id': revision['id'],
            'round_number': revision['round_number'],
            'lifecycle': revision['lifecycle'],
            'original_filename': revision['original_filename'],
            'mime_type': revision['mime_type'],
            'size_bytes': revision['size_bytes'],
            'submitted_at': revision['submitted_at'],
            'submitted_by_name': names.get(revision.get('submitted_by'), 'Creator'),
            'comment': revision['comment'],
            'decided_at': revision['decided_at'],
            'decided_by_name': names.get(revision.get('decided_by')) if revision.get('decided_by') else None,
            'can_download': True,
        }
        by_deliverable[revision['deliverable_id']].append(safe)

    approvals_by_deliverable: dict[str, list[dict[str, Any]]] = {row_id: [] for row_id in deliverable_ids}
    for request in approval_requests:
        payload = request.get('action_payload')
        if not isinstance(payload, dict):
            continue
        deliverable_id = payload.get('deliverable_id')
        revision_id = payload.get('revision_id')
        round_number = payload.get('round_number')
        if deliverable_id not in approvals_by_deliverable or not isinstance(revision_id, str):
            continue
        approvals_by_deliverable[deliverable_id].append({
            'request_id': request['id'],
            'status': request['status'],
            'maker_id': request['initiated_by'],
            'maker_name': names.get(request['initiated_by'], 'Brand maker'),
            'checker_id': request['checker_id'],
            'checker_name': names.get(request['checker_id'], 'Brand checker'),
            'revision_id': revision_id,
            'round_number': round_number,
            'comment': request['comment'],
            'created_at': request['created_at'],
            'decided_at': request['decided_at'],
            'can_decide': False,
        })

    result: list[dict[str, Any]] = []
    for deliverable in deliverables:
        history = by_deliverable[deliverable['id']]
        current = history[0] if history else None
        approvals = approvals_by_deliverable[deliverable['id']]
        current_approval = next(
            (request for request in approvals if current is not None and request['revision_id'] == current['id']),
            None,
        )
        live_approval = current_approval is not None and current_approval['status'] == 'pending'
        if current_approval is not None:
            current_approval['can_decide'] = (
                role == 'brand_checker'
                and current_approval['checker_id'] == user_id
                and live_approval
                and deliverable['status'] == 'submitted'
                and current is not None
                and current['lifecycle'] == 'awaiting_review'
            )
        can_submit = (
            role == 'creator'
            and user_id == deal['creator_id']
            and deliverable['status'] in {'pending', 'in_revision'}
            and deliverable['revision_current'] < deliverable['revision_max']
            and not deliverable['content_ops_attention']
        )
        can_review = (
            role in {'brand_admin', 'brand_maker'}
            and deliverable['status'] == 'submitted'
            and current is not None
            and current['lifecycle'] == 'awaiting_review'
            and not live_approval
        )
        result.append({
            **deliverable,
            'content_ops_attention': deliverable['content_ops_attention'],
            'content_ops_reason': deliverable['content_ops_reason'],
            'current_submission': current,
            'submission_history': history,
            'content_approval': current_approval,
            'available_actions': {
                'can_submit_content': can_submit,
                'can_request_revision': can_review,
                'can_approve_content': can_review,
                'can_submit_live_url': False,
            },
        })
    return result


@_serialized
def submission_download(
    deal_id: str,
    deliverable_id: str,
    revision_id: str,
    user_id: str,
    ip_address: str,
) -> dict[str, Any]:
    client = get_supabase()
    _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, user_id) is None:
        raise DealError(403, "You're not part of this deal.")
    rows = (
        client.table('revisions')
        .select('id,submitted_content_url,deliverables!inner(id,deal_id)')
        .eq('id', revision_id)
        .eq('deliverable_id', deliverable_id)
        .eq('deliverables.deal_id', deal_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(404, 'This submission could not be found.')
    expires_at = int(time.time()) + SIGNED_URL_TTL_SECONDS
    token = _download_token(revision_id, expires_at)
    client.table('audit_log').insert({
        'actor_id': user_id,
        'action': 'content_draft_download_link_issued',
        'entity_type': 'deliverable',
        'entity_id': deliverable_id,
        'metadata': {
            'deal_id': deal_id,
            'deliverable_id': deliverable_id,
            'revision_id': revision_id,
            'expires_in_seconds': SIGNED_URL_TTL_SECONDS,
        },
        'ip_address': ip_address,
    }).execute()
    return {'download_token': token, 'expires_in': SIGNED_URL_TTL_SECONDS}


def _download_token(revision_id: str, expires_at: int) -> str:
    payload = f'{revision_id}.{expires_at}'
    signature = hmac.new(
        settings.SUPABASE_SERVICE_ROLE_KEY.encode(), payload.encode(), hashlib.sha256
    ).digest()
    encoded = base64.urlsafe_b64encode(signature).decode().rstrip('=')
    return f'{expires_at}.{encoded}'


@_serialized
def stream_submission(revision_id: str, token: str) -> tuple[Any, str, str]:
    """Return a bounded-lived byte iterator without exposing the object path."""
    try:
        expires_text, signature = token.split('.', 1)
        expires_at = int(expires_text)
    except (TypeError, ValueError):
        raise DealError(403, 'This draft link is invalid or expired.') from None
    if expires_at < int(time.time()) or not hmac.compare_digest(
        token, _download_token(revision_id, expires_at)
    ):
        raise DealError(403, 'This draft link is invalid or expired.')
    client = get_supabase()
    rows = client.table('revisions').select(
        'submitted_content_url,original_filename,mime_type'
    ).eq('id', revision_id).limit(1).execute().data
    if not rows:
        raise DealError(404, 'This submission could not be found.')
    row = rows[0]
    signed = client.storage.from_(BUCKET).create_signed_url(row['submitted_content_url'], 60)
    url = signed.get('signedURL') or signed.get('signedUrl')
    if not url:
        raise DealError(500, 'The secure draft could not be opened. Please try again.')

    def body() -> Any:
        try:
            with httpx.stream('GET', url, timeout=30) as response:
                response.raise_for_status()
                yield from response.iter_bytes()
        except httpx.HTTPError:
            logger.warning('Could not stream authorized content draft', exc_info=True)

    return body(), row['mime_type'], row['original_filename']
