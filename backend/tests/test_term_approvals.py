"""Development-Supabase acceptance checks for workplan 10-C Gate B.

Uses only run-unique fictional users/deals and removes them in ``finally``.
Migration 026 must be applied first.
"""

import copy
import hashlib
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / '.env')

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.contract_alignment import (  # noqa: E402
    PROMPT_VERSION as ALIGNMENT_PROMPT_VERSION,
    SCHEMA_VERSION as ALIGNMENT_SCHEMA_VERSION,
)
from services.stage_engine import request_transition  # noqa: E402
from services.term_extraction import (  # noqa: E402
    CHAT_PROMPT_VERSION_V2,
    CHAT_PROMPT_VERSION_V3,
    CHAT_SCHEMA_VERSION_V2,
    CHAT_SCHEMA_VERSION_V3,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    TermsExtraction,
    TermsExtractionV2,
    TermsExtractionV3,
)

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
MANAGEMENT_CREDENTIAL = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f'Gate-B-{RUN_ID}-Fictional!'
USERS = {
    'C': (f'gateb.creator.{RUN_ID}@inflo.test', 'Fictional Gate B Creator', 'creator'),
    'B': (f'gateb.admin.{RUN_ID}@inflo.test', 'Fictional Gate B Admin', 'brand'),
    'M': (f'gateb.maker.{RUN_ID}@inflo.test', 'Fictional Gate B Maker', 'brand'),
    'K': (f'gateb.checker.{RUN_ID}@inflo.test', 'Fictional Gate B Checker', 'brand'),
    'U': (f'gateb.outsider.{RUN_ID}@inflo.test', 'Fictional Gate B Outsider', 'creator'),
}
api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
checks: list[tuple[str, bool]] = []


def check(label: str, condition: bool) -> None:
    checks.append((label, condition))
    print(f"{'PASS' if condition else 'FAIL'} - {label}")


def management_sql(sql: str):
    response = httpx.post(
        f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query',
        headers={'Authorization': f'Bearer {MANAGEMENT_CREDENTIAL}'},
        json={'query': sql},
        timeout=60,
    )
    if not response.is_success:
        raise RuntimeError(f'Management SQL failed ({response.status_code}): {response.text}')
    return response.json()


def token_for(email: str) -> str:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY).auth.sign_in_with_password(
        {'email': email, 'password': PASSWORD}
    ).session.access_token


def auth_client(email: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.auth.sign_in_with_password({'email': email, 'password': PASSWORD})
    return client


def call(method: str, path: str, token: str, body: dict | None = None):
    return api.request(method, path, json=body, headers={'Authorization': f'Bearer {token}'})


def evidence() -> list[dict[str, str]]:
    return [{'message_id': 'fictional-message', 'quote': 'fictional agreed term'}]


def found(value) -> dict:
    return {'status': 'found', 'value': value, 'evidence': evidence()}


def not_discussed() -> dict:
    return {'status': 'not_discussed', 'value': None, 'evidence': []}


def resolved_terms() -> dict:
    value = {
        'payment_amount': found({'amount': 50000, 'currency': 'INR'}),
        'payment_terms_type': found('on_posting'),
        'payment_terms_from_date': not_discussed(),
        'exclusivity': found(False),
        'exclusivity_duration_days': not_discussed(),
        'exclusivity_category': not_discussed(),
        'usage_rights': found(False),
        'usage_rights_duration': not_discussed(),
        'usage_rights_channels': not_discussed(),
        'whitelisting': found(False),
        'blackout_window': found(False),
        'blackout_duration_timing': not_discussed(),
        'revision_rounds_max': found(2),
        'creative_guidance': found({'kind': 'creator_discretion', 'text': 'Warm fictional launch'}),
        'content_format_per_deliverable': found([{'deliverable_index': 1, 'content_format': 'Reel'}]),
        'platform_per_deliverable': found([{'deliverable_index': 1, 'platform': 'Instagram'}]),
        'posting_window_per_deliverable': found([{'deliverable_index': 1, 'posting_date': '2026-09-15', 'window_start': None, 'window_end': None}]),
        'sponsored_content_disclosure': found({'required': True, 'platform_rules': ['Use #ad']}),
        'content_ownership': found('creator'),
        'deliverable_count': found(1),
        'location_per_deliverable': found([{'deliverable_index': 1, 'location': 'Fictional studio'}]),
        'milestone_schedule': not_discussed(),
    }
    TermsExtraction.model_validate(value)
    return value


def resolved_terms_v2() -> dict:
    value = resolved_terms()
    value['sponsored_content_disclosure'] = found({
        'required': True,
        'platform_rules': [{'platform': 'Instagram', 'rule': 'Use #ad and the paid partnership label'}],
    })
    TermsExtractionV2.model_validate(value)
    return value


def resolved_terms_v3() -> dict:
    value = resolved_terms_v2()
    value['whitelisting'] = found({
        'enabled': True,
        'arrangements': [
            {'platform': 'Instagram', 'ad_account': 'Fictional Brand Ads', 'start_date': '2027-01-01', 'end_date': '2027-01-31', 'budget': {'amount': 0, 'currency': 'INR'}},
        ],
    })
    TermsExtractionV3.model_validate(value)
    return value


def create_deal(ids: dict[str, str], brand_id: str, label: str) -> str:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['C'],
        'brand_id': brand_id,
        'deal_name': f'Fictional Gate B {label} {RUN_ID}',
        'direction': 'inbound',
        'created_by': ids['B'],
        'stage': 'chatting',
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
        {'deal_id': deal_id, 'profile_id': ids['M'], 'participant_role': 'brand_maker'},
        {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
    ]).execute()
    return deal_id


def create_private_outsider_deal(ids: dict[str, str], brand_id: str) -> str:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['U'], 'brand_id': brand_id,
        'deal_name': f'Fictional private pivot target {RUN_ID}',
        'direction': 'inbound', 'created_by': ids['B'], 'stage': 'chatting',
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['U'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
    ]).execute()
    return deal_id


def persist_summary(
    deal_id: str,
    ids: dict[str, str],
    terms: dict,
    *,
    schema_version: str = SCHEMA_VERSION,
    prompt_version: str = PROMPT_VERSION,
) -> str:
    admin.rpc('apply_summary_gate_action', {
        'p_deal_id': deal_id, 'p_action': 'request', 'p_actor_id': ids['B'],
        'p_actor_side': 'brand', 'p_ip_address': 'fictional-test',
    }).execute()
    gate = admin.rpc('apply_summary_gate_action', {
        'p_deal_id': deal_id, 'p_action': 'confirm', 'p_actor_id': ids['C'],
        'p_actor_side': 'creator', 'p_ip_address': 'fictional-test',
    }).execute().data
    return admin.rpc('persist_chat_ai_summary', {
        'p_deal_id': deal_id,
        'p_generation_id': gate['generation_id'],
        'p_raw_output': terms,
        'p_structured_terms': terms,
        'p_schema_version': schema_version,
        'p_prompt_version': prompt_version,
        'p_provider': 'fictional-test-provider',
        'p_model': 'fictional-test-model',
        'p_ip_address': 'fictional-test',
    }).execute().data['id']


def mark_contract_aligned(deal_id: str, summary_id: str, actor_id: str, token: str) -> None:
    """Create the generated v1 fixture and record a deterministic clear alignment."""
    generated = call('POST', f'/deals/{deal_id}/contract', token)
    if generated.status_code != 200:
        raise RuntimeError(f'Could not generate the fictional v1 contract: {generated.status_code}')

    contract = admin.table('contracts').select('id,storage_path,generated_from_summary_id').eq(
        'deal_id', deal_id
    ).eq('version', 1).single().execute().data
    summary = admin.table('ai_summaries').select('id,structured_terms').eq(
        'id', summary_id
    ).single().execute().data
    if contract['generated_from_summary_id'] != summary['id']:
        raise RuntimeError('Generated fictional contract is not bound to the approved summary.')

    source = admin.storage.from_('contracts').download(contract['storage_path'])
    reserved = admin.rpc('reserve_contract_alignment', {
        'p_deal_id': deal_id,
        'p_contract_id': contract['id'],
        'p_summary_id': summary['id'],
        'p_source_sha256': hashlib.sha256(source).hexdigest(),
        'p_actor_id': actor_id,
        'p_ip_address': 'fictional-term-approvals-alignment',
    }).execute().data
    if reserved['outcome'] == 'succeeded':
        return
    if reserved['outcome'] != 'reserved':
        raise RuntimeError(f"Could not reserve fictional contract alignment: {reserved['outcome']}")

    completed = admin.rpc('complete_contract_alignment', {
        'p_attempt_token': reserved['attempt_token'],
        'p_raw_output': summary['structured_terms'],
        'p_structured_terms': summary['structured_terms'],
        'p_conflicts': [],
        'p_schema_version': ALIGNMENT_SCHEMA_VERSION,
        'p_prompt_version': ALIGNMENT_PROMPT_VERSION,
        'p_provider': 'deterministic-regression-fixture',
        'p_model': 'deterministic-regression-fixture',
        'p_ip_address': 'fictional-term-approvals-alignment',
    }).execute().data
    if completed['outcome'] != 'succeeded':
        raise RuntimeError('Could not complete fictional contract alignment.')

    # This legacy fixture directly moves the deal into Creating solely to verify
    # checklist visibility. Keep that synthetic state behind the same execution
    # gate production uses; migration 027 verifies the clear alignment above.
    admin.table('contracts').update({'status': 'executed'}).eq('id', contract['id']).execute()


def decide(deal_id: str, summary_id: str, token: str, decision: str = 'approved', comment: str | None = None):
    return call('POST', f'/deals/{deal_id}/approve-summary', token, {
        'summary_id': summary_id, 'decision': decision, 'comment': comment,
    })


def atomic_decide(deal_id: str, summary_id: str, actor_id: str) -> dict:
    # One client per worker models separate backend processes and avoids sharing
    # the sync HTTP transport; Postgres row locks remain the concurrency authority.
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return request_transition(
        deal_id,
        actor_id,
        'approval',
        'fictional-race',
        params={
            'gate_b': True, 'summary_id': summary_id, 'decision': 'approved',
            'comment': None, 'ip_address': 'fictional-race',
        },
        _client=client,
    )


def realtime_rls_visibility(summary_id: str, participant_id: str, outsider_id: str) -> tuple[bool, bool, list]:
    """Exercise the installed Realtime authorization function with real row data.

    This proves the database authorization used for websocket change delivery
    without relying on the dev project's external websocket delivery health.
    Synthetic subscriptions are run-unique and always removed.
    """
    approval_id = admin.table('term_approvals').select('id').eq('summary_id', summary_id).limit(1).single().execute().data['id']
    participant_subscription = str(uuid4())
    outsider_subscription = str(uuid4())
    subscriptions = f"'{participant_subscription}'::uuid, '{outsider_subscription}'::uuid"
    try:
        management_sql(f"""
            INSERT INTO realtime.subscription
                (subscription_id, entity, claims, action_filter)
            VALUES
                ('{participant_subscription}', 'public.term_approvals'::regclass,
                 jsonb_build_object('sub', '{participant_id}', 'role', 'authenticated'),
                 'INSERT'),
                ('{outsider_subscription}', 'public.term_approvals'::regclass,
                 jsonb_build_object('sub', '{outsider_id}', 'role', 'authenticated'),
                 'INSERT')
        """)
        result = management_sql(f"""
            WITH source_row AS (
                SELECT to_jsonb(t) AS record
                FROM public.term_approvals t
                WHERE t.id = '{approval_id}'::uuid
            ), wal AS (
                SELECT jsonb_build_object(
                    'schema', 'public',
                    'table', 'term_approvals',
                    'action', 'I',
                    'timestamp', clock_timestamp()::text,
                    'columns', (
                        SELECT jsonb_agg(jsonb_build_object(
                            'name', a.attname,
                            'type', format_type(a.atttypid, a.atttypmod),
                            'typeoid', a.atttypid,
                            'value', source_row.record -> a.attname
                        ) ORDER BY a.attnum)
                        FROM pg_attribute a
                        WHERE a.attrelid = 'public.term_approvals'::regclass
                          AND a.attnum > 0 AND NOT a.attisdropped
                    ),
                    'pk', jsonb_build_array(jsonb_build_object(
                        'name', 'id', 'type', 'uuid', 'typeoid', 2950,
                        'value', source_row.record -> 'id'
                    )),
                    'identity', '[]'::jsonb
                ) AS record
                FROM source_row
            )
            SELECT subscription_ids, errors
            FROM realtime.apply_rls((SELECT record FROM wal), 1048576)
        """)
    finally:
        management_sql(f'DELETE FROM realtime.subscription WHERE subscription_id IN ({subscriptions})')

    visible = {value for row in result for value in (row.get('subscription_ids') or [])}
    errors = [error for row in result for error in (row.get('errors') or [])]
    return participant_subscription in visible, outsider_subscription in visible, errors


def cleanup(ids: dict[str, str]) -> None:
    if not ids:
        return
    quoted = ','.join(f"'{uid}'" for uid in ids.values())
    management_sql(
        'SET session_replication_role = replica; '
        f'DELETE FROM audit_log WHERE actor_id IN ({quoted}); '
        'SET session_replication_role = origin;'
    )
    for row in admin.table('deals').select('id').in_('created_by', list(ids.values())).execute().data:
        admin.table('deals').delete().eq('id', row['id']).execute()
    memberships = admin.table('brand_members').select('brand_id').in_('profile_id', list(ids.values())).execute().data
    for brand_id in {row['brand_id'] for row in memberships}:
        admin.table('brands').delete().eq('id', brand_id).execute()
    for user in list(admin.auth.admin.list_users()):
        if user.id in ids.values():
            admin.auth.admin.delete_user(user.id)


def main() -> None:
    ids: dict[str, str] = {}
    try:
        for key, (email, name, account_type) in USERS.items():
            user = admin.auth.admin.create_user({'email': email, 'password': PASSWORD, 'email_confirm': True}).user
            ids[key] = user.id
            admin.table('profiles').insert({'id': user.id, 'email': email, 'display_name': name, 'account_type': account_type}).execute()
        brand_id = admin.table('brands').insert({'company_name': f'Fictional Gate B Brand {RUN_ID}', 'industry': 'Beauty'}).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids[key], 'brand_role': role, 'status': 'active'}
            for key, role in [('B', 'admin'), ('M', 'member'), ('K', 'member')]
        ]).execute()
        tokens = {key: token_for(data[0]) for key, data in USERS.items()}
        clients = {key: auth_client(data[0]) for key, data in USERS.items()}

        # Read boundary and field applicability.
        main_deal = create_deal(ids, brand_id, 'unanimity')
        main_summary = persist_summary(main_deal, ids, resolved_terms())
        participant_reads = [call('GET', f'/deals/{main_deal}/terms-summary', tokens[key]) for key in ('C', 'B', 'M', 'K')]
        review = participant_reads[0].json()['summary']
        check('creator/admin/maker/checker retrieve the same active summary', all(r.status_code == 200 and r.json()['summary']['id'] == main_summary for r in participant_reads))
        check('review returns exactly 22 safe fields and no raw provider output', len(review['fields']) == 22 and 'raw_output' not in participant_reads[0].text and 'provider' not in review)
        check('explicit-false conditional children are nonblocking/inapplicable', not review['unresolved_fields'] and all(not row['applicable'] and not row['blocks_approval'] for row in review['fields'] if row['key'] in {'exclusivity_duration_days', 'exclusivity_category', 'usage_rights_duration', 'usage_rights_channels', 'blackout_duration_timing'}))
        check('outsider cannot read summary or roster', call('GET', f'/deals/{main_deal}/terms-summary', tokens['U']).status_code == 403)
        forged = call('POST', f'/deals/{main_deal}/approve-summary', tokens['C'], {'summary_id': main_summary, 'decision': 'approved', 'profile_id': ids['B']})
        check('forged profile identifier is rejected by the strict API body', forged.status_code == 422)

        # Historical table-wide UPDATE grants must not bypass server stage/identity
        # ownership. A denied mutation must leave every Gate-B artifact unchanged.
        before_deal = admin.table('deals').select('stage,creator_id,created_by').eq('id', main_deal).single().execute().data
        before_audits = admin.table('audit_log').select('id').or_(f'entity_id.eq.{main_deal},entity_id.eq.{main_summary}').execute().data
        direct_stage_blocked = direct_identity_blocked = False
        try:
            clients['C'].table('deals').update({'stage': 'approval'}).eq('id', main_deal).execute()
        except Exception:
            direct_stage_blocked = True
        try:
            clients['C'].table('deals').update({'creator_id': ids['U'], 'created_by': ids['U']}).eq('id', main_deal).execute()
        except Exception:
            direct_identity_blocked = True
        after_deal = admin.table('deals').select('stage,creator_id,created_by').eq('id', main_deal).single().execute().data
        check('authenticated direct stage and deal-identity updates are denied', direct_stage_blocked and direct_identity_blocked)
        check('denied deal updates create no summary, transition, or audit mutation', after_deal == before_deal and admin.table('ai_summaries').select('status').eq('id', main_summary).single().execute().data['status'] == 'pending_approval' and not admin.table('deal_stage_transitions').select('id').eq('deal_id', main_deal).eq('to_stage', 'approval').execute().data and len(admin.table('audit_log').select('id').or_(f'entity_id.eq.{main_deal},entity_id.eq.{main_summary}').execute().data) == len(before_audits))

        # Own participant rows expose only last_read_at. Cross-deal/role/profile
        # pivots are denied at column privilege before RLS can be abused.
        private_deal = create_private_outsider_deal(ids, brand_id)
        own_row = admin.table('deal_participants').select('id,deal_id,profile_id,participant_role').eq('deal_id', main_deal).eq('profile_id', ids['C']).single().execute().data
        participant_mutations_blocked: list[bool] = []
        for mutation in (
            {'deal_id': private_deal},
            {'participant_role': 'brand_checker'},
            {'profile_id': ids['U']},
        ):
            try:
                clients['C'].table('deal_participants').update(mutation).eq('id', own_row['id']).execute()
                participant_mutations_blocked.append(False)
            except Exception:
                participant_mutations_blocked.append(True)
        read_at = '2026-08-28T12:34:56+00:00'
        clients['C'].table('deal_participants').update({'last_read_at': read_at}).eq('id', own_row['id']).execute()
        current_own_row = admin.table('deal_participants').select('id,deal_id,profile_id,participant_role,last_read_at').eq('id', own_row['id']).single().execute().data
        check('cross-deal pivot and participant role/profile mutations are denied', all(participant_mutations_blocked) and {key: current_own_row[key] for key in ('id', 'deal_id', 'profile_id', 'participant_role')} == own_row)
        check('own last_read_at update remains available', current_own_row['last_read_at'].startswith('2026-08-28T12:34:56'))

        direct_insert_blocked = direct_rpc_blocked = False
        try:
            clients['C'].table('term_approvals').insert({'summary_id': main_summary, 'profile_id': ids['C'], 'decision': 'approved'}).execute()
        except Exception:
            direct_insert_blocked = True
        try:
            clients['C'].rpc('apply_term_approval_gate_b', {
                'p_deal_id': main_deal, 'p_summary_id': main_summary, 'p_actor_id': ids['C'],
                'p_decision': 'approved', 'p_comment': None, 'p_ip_address': 'forged',
            }).execute()
        except Exception:
            direct_rpc_blocked = True
        check('authenticated direct approval INSERT and Gate-B RPC execution are denied', direct_insert_blocked and direct_rpc_blocked)

        realtime_result = decide(main_deal, main_summary, tokens['C'])
        participant_realtime_visible, outsider_realtime_visible, realtime_errors = realtime_rls_visibility(
            main_summary, ids['B'], ids['U']
        )
        outsider_direct_summary = clients['U'].table('ai_summaries').select('id').eq('id', main_summary).execute().data
        outsider_direct_approvals = clients['U'].table('term_approvals').select('id').eq('summary_id', main_summary).execute().data
        check('denied pivot leaves outsider without Gate-B API or direct read access', call('GET', f'/deals/{main_deal}/terms-summary', tokens['U']).status_code == 403 and outsider_direct_summary == [] and outsider_direct_approvals == [])
        check('Realtime RLS authorizes the participant event and excludes the denied-pivot outsider', realtime_result.status_code == 200 and participant_realtime_visible and not outsider_realtime_visible and not realtime_errors)

        # Wrong deal/version and server completeness checks.
        other_deal = create_deal(ids, brand_id, 'wrong-summary')
        other_summary = persist_summary(other_deal, ids, resolved_terms())
        check('wrong-deal summary identifier is rejected', decide(main_deal, other_summary, tokens['C']).status_code == 409)
        ambiguous_terms = resolved_terms()
        ambiguous_terms['payment_amount'] = {'status': 'ambiguous', 'value': None, 'evidence': evidence()}
        ambiguous_deal = create_deal(ids, brand_id, 'ambiguous')
        ambiguous_summary = persist_summary(ambiguous_deal, ids, ambiguous_terms)
        missing_terms = resolved_terms()
        missing_terms['payment_amount'] = not_discussed()
        missing_deal = create_deal(ids, brand_id, 'missing')
        missing_summary = persist_summary(missing_deal, ids, missing_terms)
        check('ambiguous applicable field is blocked server-side with no decision', decide(ambiguous_deal, ambiguous_summary, tokens['C']).status_code == 409 and not admin.table('term_approvals').select('id').eq('summary_id', ambiguous_summary).execute().data)
        check('applicable not-discussed field is blocked server-side with no decision', decide(missing_deal, missing_summary, tokens['C']).status_code == 409 and not admin.table('term_approvals').select('id').eq('summary_id', missing_summary).execute().data)

        v2_deal = create_deal(ids, brand_id, 'v2-platform-disclosure')
        v2_payload = resolved_terms_v2()
        v2_summary = persist_summary(
            v2_deal,
            ids,
            v2_payload,
            schema_version=CHAT_SCHEMA_VERSION_V2,
            prompt_version=CHAT_PROMPT_VERSION_V2,
        )
        v2_review = call('GET', f'/deals/{v2_deal}/terms-summary', tokens['C']).json()['summary']
        v2_disclosure = next(row for row in v2_review['fields'] if row['key'] == 'sponsored_content_disclosure')['value']
        immutable_before = admin.table('ai_summaries').select('structured_terms').eq('id', v2_summary).single().execute().data
        for key in ('C', 'B', 'M', 'K'):
            decide(v2_deal, v2_summary, tokens[key])
        immutable_after = admin.table('ai_summaries').select('structured_terms').eq('id', v2_summary).single().execute().data
        check(
            'v2 summary is reviewable/approvable by persisted version without rewriting immutable evidence',
            v2_review['schema_version'] == CHAT_SCHEMA_VERSION_V2
            and v2_disclosure == {
                'required': True,
                'platform_rules': [{'platform': 'Instagram', 'rule': 'Use #ad and the paid partnership label'}],
            }
            and admin.table('deals').select('stage').eq('id', v2_deal).single().execute().data['stage'] == 'approval'
            and immutable_before == immutable_after,
        )
        v3_deal = create_deal(ids, brand_id, 'v3-whitelisting-arrangements')
        v3_payload = resolved_terms_v3()
        v3_summary = persist_summary(
            v3_deal, ids, v3_payload,
            schema_version=CHAT_SCHEMA_VERSION_V3,
            prompt_version=CHAT_PROMPT_VERSION_V3,
        )
        v3_review = call('GET', f'/deals/{v3_deal}/terms-summary', tokens['C']).json()['summary']
        v3_whitelisting = next(row for row in v3_review['fields'] if row['key'] == 'whitelisting')
        for key in ('C', 'B', 'M', 'K'):
            decide(v3_deal, v3_summary, tokens[key])
        check(
            'v3 complete whitelisting arrangements are reviewable and approvable without rewriting evidence',
            v3_review['schema_version'] == CHAT_SCHEMA_VERSION_V3
            and v3_whitelisting['value'] == v3_payload['whitelisting']['value']
            and not v3_whitelisting['blocks_approval']
            and admin.table('deals').select('stage').eq('id', v3_deal).single().execute().data['stage'] == 'approval',
        )
        unsafe_evidence_deal = create_deal(ids, brand_id, 'v3-unsafe-whitelisting-evidence')
        unsafe_evidence_payload = resolved_terms_v3()
        unsafe_evidence_payload['whitelisting'] = {
            'status': 'ambiguous', 'value': None,
            'evidence': [{'message_id': 'fictional-message', 'quote': 'login:creator@example.test / FictionalPass123!'}],
        }
        unsafe_evidence_summary = persist_summary(
            unsafe_evidence_deal, ids, unsafe_evidence_payload,
            schema_version=CHAT_SCHEMA_VERSION_V3,
            prompt_version=CHAT_PROMPT_VERSION_V3,
        )
        unsafe_review = call('GET', f'/deals/{unsafe_evidence_deal}/terms-summary', tokens['C'])
        check(
            'credential-like ambiguous v3 evidence is neither displayed nor approvable',
            unsafe_review.status_code == 200
            and unsafe_review.json()['summary'] is None
            and 'FictionalPass123' not in unsafe_review.text
            and decide(unsafe_evidence_deal, unsafe_evidence_summary, tokens['C']).status_code == 409,
        )
        admin.table('ai_summaries').insert({
            'deal_id': v2_deal,
            'raw_output': {'fixture': 'unsupported newer row'},
            'structured_terms': {},
            'status': 'approved',
            'schema_version': 'chat-terms-22.v999',
            'prompt_version': 'unsupported.v999',
            'generated_at': '2099-01-01T00:00:00+00:00',
        }).execute()
        admin.table('ai_summaries').insert({
            'deal_id': v2_deal,
            'raw_output': {'fixture': 'cross-family newer row'},
            'structured_terms': v2_payload,
            'status': 'approved',
            'schema_version': CHAT_SCHEMA_VERSION_V2,
            'prompt_version': 'contract-terms-extraction.v2',
            'generated_at': '2100-01-01T00:00:00+00:00',
        }).execute()
        selected_after_bad_history = call('GET', f'/deals/{v2_deal}/terms-summary', tokens['C']).json()['summary']
        check('newer unsupported, malformed, or cross-family history cannot shadow the authorized approved v2 summary', selected_after_bad_history['id'] == v2_summary)

        # Append-only decisions, latest-derived roster, full current roster, race.
        first = decide(main_deal, main_summary, tokens['C'])
        duplicate = decide(main_deal, main_summary, tokens['C'])
        check('duplicate participant approval is idempotent and append-only', first.status_code == 200 and duplicate.status_code == 200 and duplicate.json()['idempotent'] is True and len(admin.table('term_approvals').select('id').eq('summary_id', main_summary).eq('profile_id', ids['C']).execute().data) == 1)
        decide(main_deal, main_summary, tokens['B'])
        decide(main_deal, main_summary, tokens['M'])
        pending = call('GET', f'/deals/{main_deal}/terms-summary', tokens['K']).json()['summary']['approvers']
        check('latest-decision roster shows three approved and Checker pending', sum(row['status'] == 'approved' for row in pending) == 3 and next(row for row in pending if row['profile_id'] == ids['K'])['status'] == 'pending')
        check('incomplete current roster leaves deal Chatting with no transition', admin.table('deals').select('stage').eq('id', main_deal).single().execute().data['stage'] == 'chatting' and not admin.table('deal_stage_transitions').select('id').eq('deal_id', main_deal).eq('to_stage', 'approval').execute().data)
        with ThreadPoolExecutor(max_workers=2) as pool:
            final_results = list(pool.map(lambda _: atomic_decide(main_deal, main_summary, ids['K']), range(2)))
        check('concurrent final approvals both resolve safely (one completion, one idempotent retry)', all(isinstance(row, dict) for row in final_results) and sum(bool(row['idempotent']) for row in final_results) == 1)
        transitions = admin.table('deal_stage_transitions').select('*').eq('deal_id', main_deal).eq('from_stage', 'chatting').eq('to_stage', 'approval').execute().data
        decision_rows = admin.table('term_approvals').select('*').eq('summary_id', main_summary).execute().data
        audits = admin.table('audit_log').select('action,metadata').or_(f'entity_id.eq.{main_deal},entity_id.eq.{main_summary}').execute().data
        check('final approval atomically creates one approved summary and one stage transition', admin.table('ai_summaries').select('status').eq('id', main_summary).single().execute().data['status'] == 'approved' and admin.table('deals').select('stage').eq('id', main_deal).single().execute().data['stage'] == 'approval' and len(transitions) == 1)
        check('one append-only latest approval exists for every required participant', len(decision_rows) == 4 and {row['profile_id'] for row in decision_rows} == {ids[key] for key in ('C', 'B', 'M', 'K')})
        check('final transaction writes one transition audit and one audit per Gate-B decision', sum(row['action'] == 'deal_summary_approved' for row in audits) == 1 and sum(row['action'] == 'term_summary_decision_recorded' for row in audits) == 4)
        expected_notification_profiles = {ids[key] for key in ('C', 'B', 'M')}
        notifications = admin.table('notifications').select('profile_id').eq('deal_id', main_deal).execute().data
        check('concurrent completion emits exactly one notification set', len(notifications) == 3 and {row['profile_id'] for row in notifications} == expected_notification_profiles)
        retry_final = decide(main_deal, main_summary, tokens['K'])
        retry_notifications = admin.table('notifications').select('profile_id').eq('deal_id', main_deal).execute().data
        check('post-completion retry is friendly/idempotent with no duplicate transition or notifications', retry_final.status_code == 200 and retry_final.json()['idempotent'] is True and len(admin.table('deal_stage_transitions').select('id').eq('deal_id', main_deal).eq('to_stage', 'approval').execute().data) == 1 and retry_notifications == notifications)
        approved_review = call('GET', f'/deals/{main_deal}/terms-summary', tokens['C']).json()['summary']
        mark_contract_aligned(main_deal, main_summary, ids['C'], tokens['C'])
        admin.table('deals').update({'stage': 'creating'}).eq('id', main_deal).execute()
        creating_review = call('GET', f'/deals/{main_deal}/terms-summary', tokens['C']).json()['summary']
        check('approver checklist remains readable in Approval and Creating', approved_review['status'] == 'approved' and creating_review['status'] == 'approved' and all(row['status'] == 'approved' for row in creating_review['approvers']))

        # Issue branch, bounded explanation, Gate-A reset, regeneration isolation.
        issue_deal = create_deal(ids, brand_id, 'issue-recovery')
        old_summary = persist_summary(issue_deal, ids, resolved_terms())
        check('issue requires a concrete explanation', decide(issue_deal, old_summary, tokens['B'], 'issue_raised', '   ').status_code == 422)
        decide(issue_deal, old_summary, tokens['C'])
        issue = decide(issue_deal, old_summary, tokens['B'], 'issue_raised', 'Please clarify the fictional posting date.')
        issue_retry = decide(issue_deal, old_summary, tokens['B'], 'issue_raised', 'Please clarify the fictional posting date.')
        issue_gate = admin.table('deal_summary_gates').select('*').eq('deal_id', issue_deal).single().execute().data
        check('issue is append-only/idempotent, marks old summary, and stays Chatting without transition', issue.status_code == 200 and issue_retry.status_code == 200 and issue_retry.json()['idempotent'] is True and admin.table('ai_summaries').select('status').eq('id', old_summary).single().execute().data['status'] == 'issue_raised' and admin.table('deals').select('stage').eq('id', issue_deal).single().execute().data['stage'] == 'chatting' and not admin.table('deal_stage_transitions').select('id').eq('deal_id', issue_deal).execute().data)
        check('issue safely resets every Gate-A generation field and manual override', issue_gate['request_status'] == 'idle' and issue_gate['generation_id'] is None and issue_gate['requested_by'] is None and issue_gate['confirmed_by'] is None and issue_gate['manual_overrides'] == [])
        new_summary = persist_summary(issue_deal, ids, resolved_terms())
        for key in ('B', 'M', 'K'):
            decide(issue_deal, new_summary, tokens[key])
        check('old-summary approval never counts toward regenerated-summary unanimity', admin.table('deals').select('stage').eq('id', issue_deal).single().execute().data['stage'] == 'chatting' and len(admin.table('term_approvals').select('id').eq('summary_id', new_summary).execute().data) == 3)
        check('stale old-summary decision cannot approve or revert the newer summary', decide(issue_deal, old_summary, tokens['M']).status_code == 409 and admin.table('ai_summaries').select('status').eq('id', new_summary).single().execute().data['status'] == 'pending_approval')
        check('creator final approval completes regenerated summary only', decide(issue_deal, new_summary, tokens['C']).status_code == 200 and admin.table('deals').select('stage').eq('id', issue_deal).single().execute().data['stage'] == 'approval' and admin.table('ai_summaries').select('status').eq('id', old_summary).single().execute().data['status'] == 'issue_raised')

        publication = management_sql("SELECT 1 AS present FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='term_approvals'")
        check('term_approvals is published for participant-RLS Realtime refresh hints', bool(publication))
    finally:
        print('\nCleaning up fictional Gate-B data...')
        cleanup(ids)
        print('  done')

    passed = sum(ok for _, ok in checks)
    print(f'\nRESULT: {passed}/{len(checks)} checks passed')
    if passed != len(checks):
        sys.exit(1)


if __name__ == '__main__':
    main()
