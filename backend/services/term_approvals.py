"""Participant-safe summary review and backend-owned Gate-B decisions."""

from __future__ import annotations

from typing import Any

from supabase import Client

from core.supabase_client import get_supabase
from services.stage_engine import DealError, _load_deal_for_transition, _participant_role
from services.term_extraction import TermsExtractionV1, TermsExtractionV2, validate_terms_for_provenance


FIELD_LABELS: dict[str, str] = {
    'payment_amount': 'Payment amount',
    'payment_terms_type': 'Payment terms',
    'payment_terms_from_date': 'Payment timing basis',
    'exclusivity': 'Exclusivity',
    'exclusivity_duration_days': 'Exclusivity duration',
    'exclusivity_category': 'Exclusivity category',
    'usage_rights': 'Usage rights',
    'usage_rights_duration': 'Usage rights duration',
    'usage_rights_channels': 'Usage rights channels',
    'whitelisting': 'Whitelisting',
    'blackout_window': 'Blackout window',
    'blackout_duration_timing': 'Blackout timing',
    'revision_rounds_max': 'Revision rounds',
    'creative_guidance': 'Creative guidance',
    'content_format_per_deliverable': 'Content format per deliverable',
    'platform_per_deliverable': 'Platform per deliverable',
    'posting_window_per_deliverable': 'Posting timing per deliverable',
    'sponsored_content_disclosure': 'Sponsored-content disclosure',
    'content_ownership': 'Content ownership',
    'deliverable_count': 'Deliverable count',
    'location_per_deliverable': 'Location per deliverable',
    'milestone_schedule': 'Milestone schedule',
}


TermsModel = TermsExtractionV1 | TermsExtractionV2


def _is_applicable(terms: TermsModel, key: str) -> bool:
    if key in {'exclusivity_duration_days', 'exclusivity_category'}:
        return not (terms.exclusivity.status == 'found' and terms.exclusivity.value is False)
    if key in {'usage_rights_duration', 'usage_rights_channels'}:
        return not (terms.usage_rights.status == 'found' and terms.usage_rights.value is False)
    if key == 'blackout_duration_timing':
        return not (terms.blackout_window.status == 'found' and terms.blackout_window.value is False)
    if key == 'payment_terms_from_date' and terms.payment_terms_type.status == 'found':
        return terms.payment_terms_type.value == 'net_x_days'
    if key == 'milestone_schedule' and terms.payment_terms_type.status == 'found':
        return terms.payment_terms_type.value in {'milestone', 'combination'}
    return True


def unresolved_field_keys(terms: TermsModel) -> list[str]:
    return [
        key
        for key in FIELD_LABELS
        if _is_applicable(terms, key) and getattr(terms, key).status != 'found'
    ]


def _validated_terms(raw: Any, schema_version: Any, prompt_version: Any) -> TermsModel:
    try:
        return validate_terms_for_provenance(raw, schema_version, prompt_version, family='chat')
    except (ValueError, TypeError) as exc:
        raise DealError(409, 'This summary is not valid for approval. Request a new summary.') from exc


def _selected_summary(client: Client, deal_id: str, stage: str) -> dict[str, Any] | None:
    fields = 'id,deal_id,generation_id,status,structured_terms,generated_at,schema_version,prompt_version'
    if stage == 'chatting':
        gates = (
            client.table('deal_summary_gates')
            .select('request_status,generation_id')
            .eq('deal_id', deal_id)
            .limit(1)
            .execute()
            .data
        )
        if not gates or gates[0]['request_status'] != 'ready_for_generation' or not gates[0].get('generation_id'):
            return None
        return _paged_valid_summary(
            client,
            fields,
            deal_id,
            'pending_approval',
            generation_id=gates[0]['generation_id'],
        )
    if stage in {'approval', 'creating'}:
        return _paged_valid_summary(client, fields, deal_id, 'approved')
    return None


def _paged_valid_summary(
    client: Client,
    fields: str,
    deal_id: str,
    status: str,
    *,
    generation_id: str | None = None,
) -> dict[str, Any] | None:
    """Scan immutable history in bounded pages until a valid exact pair wins."""
    start = 0
    page_size = 100
    while True:
        query = (
            client.table('ai_summaries')
            .select(fields)
            .eq('deal_id', deal_id)
            .eq('status', status)
        )
        if generation_id is not None:
            query = query.eq('generation_id', generation_id)
        rows = (
            query.order('generated_at', desc=True)
            .order('id', desc=True)
            .range(start, start + page_size - 1)
            .execute()
            .data
        )
        selected = _first_valid_supported_summary(rows)
        if selected is not None or len(rows) < page_size:
            return selected
        start += page_size


def _first_valid_supported_summary(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Do not let newer malformed or unsupported history shadow a valid row."""
    for row in rows:
        try:
            _validated_terms(row.get('structured_terms'), row.get('schema_version'), row.get('prompt_version'))
        except DealError:
            continue
        return row
    return None


def _approver_roster(client: Client, deal_id: str, summary_id: str) -> list[dict[str, Any]]:
    participants = (
        client.table('deal_participants')
        .select('profile_id,participant_role,joined_at')
        .eq('deal_id', deal_id)
        .order('joined_at')
        .execute()
        .data
    )
    profile_ids = [row['profile_id'] for row in participants]
    profiles = (
        client.table('profiles').select('id,display_name').in_('id', profile_ids).execute().data
        if profile_ids
        else []
    )
    names = {row['id']: row['display_name'] for row in profiles}
    decisions = (
        client.table('term_approvals')
        .select('id,profile_id,decision,comment,decided_at,decision_sequence')
        .eq('summary_id', summary_id)
        .order('decision_sequence', desc=True)
        .execute()
        .data
    )
    latest: dict[str, dict[str, Any]] = {}
    for row in decisions:
        latest.setdefault(row['profile_id'], row)

    result: list[dict[str, Any]] = []
    for participant in participants:
        profile_id = participant['profile_id']
        decision = latest.get(profile_id)
        status = 'pending'
        if decision:
            status = 'approved' if decision['decision'] == 'approved' else 'changes_requested'
        result.append(
            {
                'profile_id': profile_id,
                'display_name': names.get(profile_id, 'Deal participant'),
                'role': participant['participant_role'],
                'status': status,
                'comment': decision.get('comment') if decision else None,
                'decided_at': decision.get('decided_at') if decision else None,
            }
        )
    return result


def get_terms_review(deal_id: str, user_id: str) -> dict[str, Any]:
    client = get_supabase()
    deal = _load_deal_for_transition(client, deal_id)
    if _participant_role(client, deal_id, user_id) is None:
        raise DealError(403, "You're not part of this deal.")
    if deal['stage'] not in {'chatting', 'approval', 'creating'}:
        raise DealError(409, 'The terms review is not available at this deal stage.')

    summary = _selected_summary(client, deal_id, deal['stage'])
    if summary is None:
        return {'deal_id': deal_id, 'stage': deal['stage'], 'summary': None}

    terms = _validated_terms(
        summary['structured_terms'], summary.get('schema_version'), summary.get('prompt_version')
    )
    unresolved = set(unresolved_field_keys(terms))
    fields: list[dict[str, Any]] = []
    for key, label in FIELD_LABELS.items():
        envelope = getattr(terms, key)
        fields.append(
            {
                'key': key,
                'label': label,
                'status': envelope.status,
                'value': envelope.model_dump(mode='json')['value'],
                'evidence': [item.model_dump(mode='json') for item in envelope.evidence],
                'applicable': _is_applicable(terms, key),
                'blocks_approval': key in unresolved,
            }
        )
    return {
        'deal_id': deal_id,
        'stage': deal['stage'],
        'summary': {
            'id': summary['id'],
            'status': summary['status'],
            'schema_version': summary['schema_version'],
            'generated_at': summary['generated_at'],
            'fields': fields,
            'unresolved_fields': sorted(unresolved, key=list(FIELD_LABELS).index),
            'approvers': _approver_roster(client, deal_id, summary['id']),
        },
    }


def apply_gate_b_decision(
    client: Client,
    deal_id: str,
    summary_id: str,
    user_id: str,
    decision: str,
    comment: str | None,
    ip_address: str,
) -> dict[str, Any]:
    if decision not in {'approved', 'issue_raised'}:
        raise DealError(422, "Decision must be 'approved' or 'issue_raised'.")
    if len(comment or '') > 1000:
        raise DealError(422, 'The explanation must be 1,000 characters or fewer.')
    if decision == 'issue_raised' and not (comment or '').strip():
        raise DealError(422, 'Explain what needs to change before requesting changes.')

    # Validate the immutable payload before the RPC repeats the applicability
    # check under locks. This yields field-specific, user-friendly feedback.
    rows = (
        client.table('ai_summaries')
        .select('deal_id,status,structured_terms,schema_version,prompt_version')
        .eq('id', summary_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows or rows[0]['deal_id'] != deal_id:
        raise DealError(409, 'That summary does not belong to this deal.')
    terms = _validated_terms(
        rows[0]['structured_terms'], rows[0].get('schema_version'), rows[0].get('prompt_version')
    )
    if decision == 'approved' and rows[0]['status'] == 'pending_approval':
        unresolved = unresolved_field_keys(terms)
        if unresolved:
            labels = ', '.join(FIELD_LABELS[key] for key in unresolved[:3])
            suffix = ' and more' if len(unresolved) > 3 else ''
            raise DealError(409, f'Clarify these terms before approving: {labels}{suffix}.')

    try:
        result = client.rpc(
            'apply_term_approval_gate_b',
            {
                'p_deal_id': deal_id,
                'p_summary_id': summary_id,
                'p_actor_id': user_id,
                'p_decision': decision,
                'p_comment': comment,
                'p_ip_address': ip_address,
            },
        ).execute().data
    except Exception as exc:
        message = getattr(exc, 'message', '') or str(exc)
        mappings = {
            'GATE_B_DEAL_NOT_FOUND': (404, 'This deal could not be found.'),
            'GATE_B_NOT_PARTICIPANT': (403, "You're not part of this deal."),
            'GATE_B_WRONG_SUMMARY': (409, 'That summary does not belong to this deal.'),
            'GATE_B_STALE_SUMMARY': (409, 'This summary is no longer awaiting your decision. Refresh to see the current state.'),
            'GATE_B_UNRESOLVED_FIELDS': (409, 'Some applicable terms still need clarification before approval.'),
            'GATE_B_COMMENT_REQUIRED': (422, 'Explain what needs to change before requesting changes.'),
            'GATE_B_COMMENT_TOO_LONG': (422, 'The explanation must be 1,000 characters or fewer.'),
            'GATE_B_INVALID_DECISION': (422, 'That decision is not valid.'),
            'GATE_B_CONCURRENT_TRANSITION': (409, 'This deal was just updated. Refresh to see the current state.'),
        }
        for marker, (status, detail) in mappings.items():
            if marker in message:
                raise DealError(status, detail) from exc
        raise DealError(503, 'Your decision could not be saved. Please try again.') from exc
    if not isinstance(result, dict) or not result.get('outcome'):
        raise DealError(503, 'Your decision could not be saved. Please try again.')
    return result
