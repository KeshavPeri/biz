"""Participant-safe creative-brief reads and atomic backend-owned writes."""

from __future__ import annotations

from typing import Any, NoReturn

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role


_RPC_ERRORS: dict[str, tuple[int, str]] = {
    'BRIEF_DEAL_NOT_FOUND': (404, 'This deal could not be found.'),
    'BRIEF_NOT_PARTICIPANT': (403, "You're not part of this deal."),
    'BRIEF_WRONG_ROLE': (403, 'Only a brand admin or maker can share the creative brief.'),
    'BRIEF_WRONG_STAGE': (409, 'Creative briefs can only be changed while the deal is in Creating.'),
    'BRIEF_INVALID_EXPECTED_VERSION': (422, 'The expected brief version is not valid.'),
    'BRIEF_STALE_VERSION': (409, 'The brief was just updated. Refresh before creating a new version.'),
    'BRIEF_ACK_CREATOR_ONLY': (403, 'Only the creator on this deal can acknowledge the brief.'),
    'BRIEF_NOT_FOUND': (404, 'This brief could not be found.'),
    'BRIEF_STALE_ACK': (409, 'A newer brief is available. Refresh and acknowledge the latest version.'),
}


def _raise_rpc_error(exc: Exception) -> NoReturn:
    message = getattr(exc, 'message', '') or str(exc)
    for marker, (status, detail) in _RPC_ERRORS.items():
        if marker in message:
            raise DealError(status, detail) from exc
    raise DealError(409, 'The brief could not be updated. Refresh and try again.') from exc


def _profile_names(client: Client, profile_ids: set[str]) -> dict[str, str]:
    if not profile_ids:
        return {}
    rows = client.table('profiles').select('id,display_name').in_('id', list(profile_ids)).execute().data
    return {row['id']: row.get('display_name') or 'Deal participant' for row in rows}


def get_briefs(deal_id: str, user_id: str, *, _client: Client | None = None) -> dict[str, Any]:
    client = _client or get_supabase()
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")

    rows = (
        client.table('briefs')
        .select(
            'id,deal_id,version,content,created_by,created_at,'
            'acknowledged_by_creator,acknowledged_by,acknowledged_at'
        )
        .eq('deal_id', deal_id)
        .order('version', desc=True)
        .execute()
        .data
    )
    profile_ids = {
        profile_id
        for row in rows
        for profile_id in (row.get('created_by'), row.get('acknowledged_by'))
        if profile_id
    }
    names = _profile_names(client, profile_ids)
    history = [
        {
            'id': row['id'],
            'version': row['version'],
            'content': row['content'],
            'created_by': row.get('created_by'),
            'created_by_display_name': names.get(row.get('created_by'), 'Brand participant'),
            'created_at': row['created_at'],
            'acknowledged_by_creator': row['acknowledged_by_creator'],
            'acknowledged_by': row.get('acknowledged_by'),
            'acknowledged_by_display_name': names.get(row.get('acknowledged_by')),
            'acknowledged_at': row.get('acknowledged_at'),
        }
        for row in rows
    ]
    latest = history[0] if history else None
    creating = deal['stage'] == 'creating'
    return {
        'deal_id': deal_id,
        'stage': deal['stage'],
        'latest': latest,
        'history': history,
        'history_order': 'newest_first',
        'allowed_actions': {
            'can_create_version': creating and role in {'brand_admin', 'brand_maker'},
            'can_acknowledge_latest': bool(
                creating
                and role == 'creator'
                and deal['creator_id'] == user_id
                and latest
                and not latest['acknowledged_by_creator']
            ),
        },
    }


def create_brief(
    deal_id: str,
    user_id: str,
    expected_version: int,
    content: dict[str, Any],
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    try:
        outcome = client.rpc(
            'create_creative_brief_version',
            {
                'p_deal_id': deal_id,
                'p_actor_id': user_id,
                'p_expected_version': expected_version,
                'p_content': content,
                'p_ip_address': ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    state = get_briefs(deal_id, user_id, _client=client)
    state['outcome'] = outcome
    return state


def acknowledge_brief(
    deal_id: str,
    brief_id: str,
    user_id: str,
    ip_address: str,
    *,
    _client: Client | None = None,
) -> dict[str, Any]:
    client = _client or get_supabase()
    try:
        outcome = client.rpc(
            'acknowledge_creative_brief',
            {
                'p_deal_id': deal_id,
                'p_brief_id': brief_id,
                'p_actor_id': user_id,
                'p_ip_address': ip_address,
            },
        ).execute().data
    except Exception as exc:
        _raise_rpc_error(exc)
    state = get_briefs(deal_id, user_id, _client=client)
    state['outcome'] = outcome
    return state
