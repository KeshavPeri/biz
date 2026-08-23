"""Phase 9 Gate A: minimum-field checklist + two-side summary trigger.

The service is deliberately parser-agnostic. `ai_service` supplies field
statuses; this module enforces the documented 12-item contract, role/side rules,
atomic state changes and friendly errors using the backend service-role client.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from supabase import Client

from core.supabase_client import get_supabase
from services import ai_service
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role

ActorSide = Literal['creator', 'brand']
ALLOWED_ACTOR_ROLES = frozenset({'creator', 'brand_admin', 'brand_maker'})


@dataclass(frozen=True)
class ChecklistDefinition:
    key: str
    label: str
    child_requirements: tuple[str, ...] = ()


MINIMUM_CHECKLIST = (
    ChecklistDefinition('payment_amount', 'Payment amount'),
    ChecklistDefinition('payment_terms', 'Payment terms — type and from-date'),
    ChecklistDefinition('exclusivity', 'Exclusivity — yes/no', ('duration', 'category')),
    ChecklistDefinition('usage_rights', 'Usage rights — yes/no', ('duration', 'channels')),
    ChecklistDefinition('whitelisting', 'Whitelisting — yes/no'),
    ChecklistDefinition('blackout_window', 'Blackout window — yes/no', ('duration_and_timing',)),
    ChecklistDefinition('revision_rounds', 'Revision rounds — maximum'),
    ChecklistDefinition('creative_guidance', 'Creative guidance / brief'),
    ChecklistDefinition('content_format', 'Content format per deliverable'),
    ChecklistDefinition('platform', 'Platform per deliverable'),
    ChecklistDefinition('posting_window', 'Posting date / window per deliverable'),
    ChecklistDefinition('sponsored_disclosure', 'Sponsored content disclosure'),
)
_BY_KEY = {item.key: item for item in MINIMUM_CHECKLIST}


def _side_for_role(role: str) -> ActorSide:
    return 'creator' if role == 'creator' else 'brand'


def _require_chatting_participant(client: Client, deal_id: str, user_id: str) -> tuple[dict[str, Any], str, ActorSide]:
    deal = _load_deal_for_transition(client, deal_id)
    role = _participant_role(client, deal_id, user_id)
    if role is None:
        raise DealError(403, "You're not part of this deal.")
    if deal['stage'] != 'chatting':
        raise DealError(409, 'Terms can only be prepared while this deal is being discussed.')
    return deal, role, _side_for_role(role)


def _require_gate_actor(role: str) -> None:
    if role not in ALLOWED_ACTOR_ROLES:
        raise DealError(403, "Your role can view this checklist but can't take this action.")


def _overrides_by_key(gate: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    raw = (gate or {}).get('manual_overrides') or []
    return {row['field_key']: row for row in raw if isinstance(row, dict) and row.get('field_key') in _BY_KEY}


def _item_status(definition: ChecklistDefinition, analysis: ai_service.ChecklistAnalysis, override: dict[str, Any] | None) -> dict[str, Any]:
    status = analysis.status
    missing_children: list[str] = []
    # `found` with a true parent answer means its documented child requirements
    # must also be clear. Phase 10 will populate the children from the 22-field
    # contract; a no answer has no children to require.
    if status == 'found' and analysis.value is True:
        missing_children = [child for child in definition.child_requirements if analysis.children.get(child) != 'found']
        if missing_children:
            status = 'ambiguous'
    override_state = override.get('status') if override else None
    cleared = override_state == 'confirmed'
    return {
        'key': definition.key,
        'label': definition.label,
        'status': 'found' if cleared else status,
        'missing_children': missing_children,
        'is_complete': cleared or status == 'found',
        'override': {
            'state': override_state,
            'proposed_by': override.get('proposed_by'),
            'proposer_side': override.get('proposer_side'),
            'confirmed_by': override.get('confirmed_by'),
        }
        if override
        else None,
    }


async def _checklist(client: Client, deal_id: str, gate: dict[str, Any] | None) -> list[dict[str, Any]]:
    analyses = await ai_service.get_minimum_field_statuses(deal_id)
    overrides = _overrides_by_key(gate)
    return [_item_status(item, analyses.get(item.key, ai_service.ChecklistAnalysis('not_discussed')), overrides.get(item.key)) for item in MINIMUM_CHECKLIST]


def _gate_row(client: Client, deal_id: str) -> dict[str, Any] | None:
    response = client.table('deal_summary_gates').select('*').eq('deal_id', deal_id).execute()
    return response.data[0] if response.data else None


async def get_summary_checklist(deal_id: str, user_id: str) -> dict[str, Any]:
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    gate = _gate_row(client, deal_id)
    items = await _checklist(client, deal_id, gate)
    missing = [item for item in items if not item['is_complete']]
    state = (gate or {}).get('request_status', 'idle')
    return {
        'checklist': items,
        'missing_fields': [{'key': item['key'], 'label': item['label'], 'status': item['status'], 'missing_children': item['missing_children']} for item in missing],
        'summary_request_allowed': not missing and state == 'idle',
        'request_status': state,
        'requester_side': (gate or {}).get('requester_side'),
        'requested_by': (gate or {}).get('requested_by'),
        'confirmed_by': (gate or {}).get('confirmed_by'),
        'can_act': role in ALLOWED_ACTOR_ROLES,
        'viewer_side': side,
    }


async def request_summary(deal_id: str, user_id: str, ip_address: str) -> dict[str, Any]:
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    _require_gate_actor(role)
    status = await get_summary_checklist(deal_id, user_id)
    if status['missing_fields']:
        count = len(status['missing_fields'])
        raise DealError(409, f'{count} field{"s" if count != 1 else ""} still need discussion before a summary can be requested.')
    result = client.rpc('apply_summary_gate_action', {'p_deal_id': deal_id, 'p_action': 'request', 'p_actor_id': user_id, 'p_actor_side': side, 'p_ip_address': ip_address}).execute().data
    outcome = result.get('outcome')
    if outcome == 'request_exists':
        raise DealError(409, 'A summary request is already waiting for the other side.')
    return {'status': 'awaiting_confirmation', 'idempotent': outcome == 'already_requested'}


async def confirm_summary(deal_id: str, user_id: str, ip_address: str) -> dict[str, Any]:
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    _require_gate_actor(role)
    result = client.rpc('apply_summary_gate_action', {'p_deal_id': deal_id, 'p_action': 'confirm', 'p_actor_id': user_id, 'p_actor_side': side, 'p_ip_address': ip_address}).execute().data
    outcome = result.get('outcome')
    if outcome == 'nothing_to_confirm':
        raise DealError(409, 'There is no summary request waiting for confirmation.')
    if outcome == 'same_side':
        raise DealError(403, 'Only an eligible participant on the other side can confirm this request.')
    if outcome == 'confirmed' and result.get('invoke_ai'):
        # This seam is reached exactly once: the atomic state switch above makes
        # every later concurrent confirmation return already_confirmed.
        await ai_service.request_terms_summary_generation(deal_id)
    return {'status': 'ready_for_generation', 'idempotent': outcome == 'already_confirmed', 'parser_status': 'pending'}


async def decline_summary(deal_id: str, user_id: str, ip_address: str) -> dict[str, Any]:
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    _require_gate_actor(role)
    result = client.rpc('apply_summary_gate_action', {'p_deal_id': deal_id, 'p_action': 'not_yet', 'p_actor_id': user_id, 'p_actor_side': side, 'p_ip_address': ip_address}).execute().data
    if result.get('outcome') == 'nothing_to_decline':
        raise DealError(409, 'There is no summary request to respond to.')
    if result.get('outcome') == 'same_side':
        raise DealError(403, 'Only the other side can respond to this request.')
    return {'status': 'idle'}


async def propose_override(deal_id: str, field_key: str, user_id: str, ip_address: str) -> dict[str, Any]:
    if field_key not in _BY_KEY:
        raise DealError(422, 'That is not a minimum checklist item.')
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    _require_gate_actor(role)
    current = await get_summary_checklist(deal_id, user_id)
    item = next(row for row in current['checklist'] if row['key'] == field_key)
    if item['is_complete']:
        raise DealError(409, 'This checklist item is already complete.')
    result = client.rpc('apply_checklist_override_action', {'p_deal_id': deal_id, 'p_field_key': field_key, 'p_action': 'propose', 'p_actor_id': user_id, 'p_actor_side': side, 'p_ip_address': ip_address}).execute().data
    if result.get('outcome') == 'proposal_exists':
        raise DealError(409, 'The other side has already proposed this checklist override.')
    return {'status': result.get('outcome')}


async def confirm_override(deal_id: str, field_key: str, user_id: str, ip_address: str) -> dict[str, Any]:
    if field_key not in _BY_KEY:
        raise DealError(422, 'That is not a minimum checklist item.')
    client = get_supabase()
    _, role, side = _require_chatting_participant(client, deal_id, user_id)
    _require_gate_actor(role)
    result = client.rpc('apply_checklist_override_action', {'p_deal_id': deal_id, 'p_field_key': field_key, 'p_action': 'confirm', 'p_actor_id': user_id, 'p_actor_side': side, 'p_ip_address': ip_address}).execute().data
    if result.get('outcome') == 'nothing_to_confirm':
        raise DealError(409, 'There is no override waiting for confirmation.')
    if result.get('outcome') == 'same_side':
        raise DealError(403, 'Only the other side can confirm this override.')
    return {'status': result.get('outcome')}
