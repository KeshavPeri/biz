"""Participant-safe canonical deliverable initialization and reads.

Approved AI terms are untrusted until ``TermsExtraction`` validates them. This
service then applies exhaustive enum mappings and delegates the entire set to a
deal-locked backend-only RPC. No public entry point writes the table directly.
"""

from __future__ import annotations

from typing import Any, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import TermsExtraction
from services.content_service import participant_content_view


CONTENT_FORMAT_MAP: dict[str, str] = {
    'Reel': 'reel',
    'Static Post': 'static_post',
    'Story': 'story',
    'Carousel': 'carousel',
    'YouTube Video': 'yt_video',
    'YouTube Short': 'yt_short',
    'Blog Post': 'blog',
    'UGC Photo': 'ugc_photo',
    'Podcast Read': 'podcast_read',
    'X/Twitter Thread': 'x_thread',
    'LinkedIn Post': 'linkedin_post',
    'Pinterest Pin': 'pinterest_pin',
}

PLATFORM_MAP: dict[str, str] = {
    'Instagram': 'instagram',
    'TikTok': 'tiktok',
    'YouTube': 'youtube',
    'LinkedIn': 'linkedin',
    'X/Twitter': 'x',
    'Pinterest': 'pinterest',
    'Threads': 'threads',
    'Podcast platform': 'podcast',
}

_RPC_ERRORS: dict[str, tuple[int, str]] = {
    'DELIVERABLE_DEAL_NOT_FOUND': (404, 'This deal could not be found.'),
    'DELIVERABLE_NOT_PARTICIPANT': (403, "You're not part of this deal."),
    'DELIVERABLE_WRONG_STAGE': (409, 'The deliverable plan is available once the deal reaches Creating.'),
    'DELIVERABLE_CONTRACT_NOT_EXECUTED': (409, 'The signed contract must finish before the deliverable plan is created.'),
    'DELIVERABLE_STALE_SOURCE': (409, 'The approved terms changed. Refresh before loading the deliverable plan.'),
    'DELIVERABLE_SOURCE_NOT_APPROVED': (409, 'An approved terms summary is required for the deliverable plan.'),
    'DELIVERABLE_INVALID_SUMMARY': (409, 'The approved terms do not contain a complete deliverable plan.'),
    'DELIVERABLE_INVALID_SET': (409, 'The approved terms do not contain a complete deliverable plan.'),
    'DELIVERABLE_EXISTING_CONFLICT': (409, 'The existing deliverable plan conflicts with the approved terms. Nothing was changed.'),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, 'message', '') or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, 'The deliverable plan could not be initialized safely. Nothing was changed.') from exc


def _latest_approved_summary(client: Client, deal_id: str) -> dict[str, Any]:
    rows = (
        client.table('ai_summaries')
        .select('id,deal_id,structured_terms,status,generated_at')
        .eq('deal_id', deal_id)
        .eq('status', 'approved')
        .order('generated_at', desc=True)
        .order('id', desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise DealError(409, 'An approved terms summary is required for the deliverable plan.')
    return rows[0]


def _found_value(terms: TermsExtraction, field: str) -> Any:
    envelope = getattr(terms, field)
    if envelope.status != 'found' or envelope.value is None:
        raise DealError(409, 'The approved terms do not contain a complete deliverable plan.')
    return envelope.value


def _canonical_items(raw_terms: Any) -> tuple[int, list[dict[str, Any]]]:
    try:
        terms = TermsExtraction.model_validate(raw_terms)
    except (TypeError, ValueError) as exc:
        raise DealError(409, 'The approved terms do not contain a valid deliverable plan.') from exc

    count = _found_value(terms, 'deliverable_count')
    revision_max = _found_value(terms, 'revision_rounds_max')
    formats = {item.deliverable_index: item.content_format for item in _found_value(terms, 'content_format_per_deliverable')}
    platforms = {item.deliverable_index: item.platform for item in _found_value(terms, 'platform_per_deliverable')}
    timings = {item.deliverable_index: item for item in _found_value(terms, 'posting_window_per_deliverable')}
    locations = (
        {item.deliverable_index: item.location for item in terms.location_per_deliverable.value}
        if terms.location_per_deliverable.status == 'found' and terms.location_per_deliverable.value is not None
        else {}
    )
    expected = set(range(1, count + 1))
    if set(formats) != expected or set(platforms) != expected or set(timings) != expected:
        raise DealError(409, 'The approved terms do not contain a complete deliverable plan.')

    items: list[dict[str, Any]] = []
    for sequence in range(1, count + 1):
        source_format = formats[sequence]
        source_platform = platforms[sequence]
        if source_format not in CONTENT_FORMAT_MAP or source_platform not in PLATFORM_MAP:
            raise DealError(409, 'The approved terms use a deliverable format or platform that is not supported yet.')
        timing = timings[sequence]
        items.append(
            {
                'sequence': sequence,
                'content_format': CONTENT_FORMAT_MAP[source_format],
                'platform': PLATFORM_MAP[source_platform],
                'posting_date': timing.posting_date,
                'posting_window_start': timing.window_start,
                'posting_window_end': timing.window_end,
                'location': locations.get(sequence),
                'revision_max': revision_max,
                'revision_current': 0,
                'status': 'pending',
            }
        )
    return count, items


def _materialize(
    client: Client,
    deal_id: str,
    actor_id: str,
    ip_address: str,
    *,
    allow_approval: bool,
) -> dict[str, Any]:
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, actor_id) is None:
        raise DealError(403, "You're not part of this deal.")
    allowed_stages = {'creating', 'approval'} if allow_approval else {'creating'}
    if deal['stage'] not in allowed_stages:
        raise DealError(409, 'The deliverable plan is available once the deal reaches Creating.')

    summary = _latest_approved_summary(client, deal_id)
    count, items = _canonical_items(summary['structured_terms'])
    existing = (
        client.table('deliverables')
        .select(
            'id,source_summary_id,sequence,content_format,platform,posting_date,'
            'posting_window_start,posting_window_end,location,revision_max'
        )
        .eq('deal_id', deal_id)
        .order('sequence')
        .execute()
        .data
    )
    if existing:
        matches = len(existing) == count
        for row, item in zip(existing, items, strict=False):
            matches = matches and all(
                row.get(key) == item.get(key)
                for key in (
                    'sequence', 'content_format', 'platform', 'posting_date',
                    'posting_window_start', 'posting_window_end', 'location', 'revision_max',
                )
            ) and row.get('source_summary_id') == summary['id']
        if matches:
            return {
                'outcome': 'existing', 'idempotent': True,
                'deal_id': deal_id, 'source_summary_id': summary['id'], 'count': count,
            }
        raise DealError(409, 'The existing deliverable plan conflicts with the approved terms. Nothing was changed.')
    try:
        return client.rpc(
            'materialize_canonical_deliverables',
            {
                'p_deal_id': deal_id,
                'p_source_summary_id': summary['id'],
                'p_actor_id': actor_id,
                'p_expected_count': count,
                'p_items': items,
                'p_ip_address': ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)


def materialize_for_creating_entry(
    client: Client,
    deal_id: str,
    actor_id: str,
    ip_address: str,
) -> dict[str, Any]:
    """Initialize before a future Approval → Creating completion."""
    return _materialize(client, deal_id, actor_id, ip_address, allow_approval=True)


def get_deliverables(
    deal_id: str,
    user_id: str,
    ip_address: str = 'read-recovery',
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    """Return the ordered safe plan, recovering an existing Creating deal."""
    client = _client or get_supabase()
    _materialize(client, deal_id, user_id, ip_address, allow_approval=False)
    rows = (
        client.table('deliverables')
        .select(
            'id,sequence,content_format,platform,posting_date,posting_window_start,'
            'posting_window_end,location,revision_max,revision_current,status,'
            'content_ops_attention,content_ops_reason'
        )
        .eq('deal_id', deal_id)
        .order('sequence')
        .execute()
        .data
    )
    return {
        'deal_id': deal_id,
        'stage': 'creating',
        'deliverables': participant_content_view(
            client,
            deal_id,
            user_id,
            [{**row, 'display_name': f"Deliverable {row['sequence']}"} for row in rows],
        ),
        'order': 'sequence_ascending',
    }
