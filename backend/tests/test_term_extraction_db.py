"""Development-Supabase verification for B4-002 persistence, recovery, and RLS.

Uses fictional accounts and chat only. Migration 025 must already be applied.
"""

import asyncio
import json
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
from services import ai_service  # noqa: E402
from services.term_extraction import (  # noqa: E402
    CURRENT_CHAT_PROMPT_VERSION,
    CURRENT_CHAT_SCHEMA_VERSION,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    TermsExtraction,
    TermsExtractionV2,
)


SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
management_credential = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
fictional_passphrase = '-'.join(('B4', '002', 'Fictional', '2026!'))
RUN_ID = uuid4().hex[:8]
USERS = {
    'B': (f'b4002.brand.{RUN_ID}@inflo.test', 'Fictional B4 Brand Admin', 'brand'),
    'C': (f'b4002.creator.{RUN_ID}@inflo.test', 'Fictional B4 Creator', 'creator'),
    'K': (f'b4002.checker.{RUN_ID}@inflo.test', 'Fictional B4 Checker', 'brand'),
    'U': (f'b4002.outsider.{RUN_ID}@inflo.test', 'Fictional B4 Outsider', 'creator'),
}
api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def check(label: str, condition: bool) -> None:
    print(f"{'PASS' if condition else 'FAIL'} - {label}")
    if not condition:
        raise AssertionError(label)


def mgmt_sql(sql: str) -> None:
    response = httpx.post(
        f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query',
        headers={'Authorization': f'Bearer {management_credential}'},
        json={'query': sql},
        timeout=60,
    )
    response.raise_for_status()


def access_token(email: str) -> str:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY).auth.sign_in_with_password(
        {'email': email, 'password': fictional_passphrase}
    ).session.access_token


def authenticated_client(email: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.auth.sign_in_with_password({'email': email, 'password': fictional_passphrase})
    return client


def call(path: str, token: str):
    return api.post(path, headers={'Authorization': f'Bearer {token}'})


def clean_payload() -> dict:
    return {
        key: {'status': 'not_discussed', 'value': None, 'evidence': []}
        for key in TermsExtractionV2.model_fields
    }


class FakeProvider:
    name = 'fake'
    model = 'fake-b4-002'

    def __init__(self, responses: list[str], on_generate=None):
        self.responses = list(responses)
        self.requests = []
        self.on_generate = on_generate

    async def generate(self, request):
        self.requests.append(request)
        if self.on_generate:
            self.on_generate()
        return ai_service.AIResult(self.responses.pop(0), self.name, self.model)


def create_deal(ids: dict[str, str], brand_id: str, name: str, stage: str = 'chatting') -> str:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['C'],
        'brand_id': brand_id,
        'deal_name': name,
        'direction': 'inbound',
        'created_by': ids['B'],
        'stage': stage,
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
        {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
    ]).execute()
    admin.table('messages').insert([
        {'id': str(uuid4()), 'deal_id': deal_id, 'sender_id': ids['B'], 'body': 'Fictional offer: one Reel for INR 50000.', 'created_at': '2026-08-25T10:00:00+00:00'},
        {'id': str(uuid4()), 'deal_id': deal_id, 'sender_id': ids['C'], 'body': 'Fictional reply: understood; no private data.', 'created_at': '2026-08-25T10:01:00+00:00'},
        {'id': str(uuid4()), 'deal_id': deal_id, 'sender_id': ids['C'], 'body': 'Deleted fictional text.', 'created_at': '2026-08-25T10:02:00+00:00', 'deleted_at': '2026-08-25T10:03:00+00:00'},
    ]).execute()
    return deal_id


def make_gate_ready(deal_id: str, ids: dict[str, str]) -> str:
    admin.rpc('apply_summary_gate_action', {
        'p_deal_id': deal_id,
        'p_action': 'request',
        'p_actor_id': ids['B'],
        'p_actor_side': 'brand',
        'p_ip_address': 'test',
    }).execute()
    result = admin.rpc('apply_summary_gate_action', {
        'p_deal_id': deal_id,
        'p_action': 'confirm',
        'p_actor_id': ids['C'],
        'p_actor_side': 'creator',
        'p_ip_address': 'test',
    }).execute().data
    return result['generation_id']


def atomic_persist(deal_id: str, generation_id: str, payload: dict) -> dict:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return client.rpc('persist_chat_ai_summary', {
        'p_deal_id': deal_id,
        'p_generation_id': generation_id,
        'p_raw_output': payload,
        'p_structured_terms': payload,
        'p_schema_version': SCHEMA_VERSION,
        'p_prompt_version': PROMPT_VERSION,
        'p_provider': 'fake',
        'p_model': 'fake-b4-002',
        'p_ip_address': 'test',
    }).execute().data


def cleanup(ids: dict[str, str]) -> None:
    if not ids:
        return
    quoted = ','.join(f"'{uid}'" for uid in ids.values())
    mgmt_sql(
        'SET session_replication_role = replica; '
        f'DELETE FROM audit_log WHERE actor_id IN ({quoted}); '
        'SET session_replication_role = origin;'
    )
    deals = admin.table('deals').select('id').in_('created_by', list(ids.values())).execute().data
    for deal in deals:
        admin.table('deals').delete().eq('id', deal['id']).execute()
    memberships = admin.table('brand_members').select('brand_id').in_('profile_id', list(ids.values())).execute().data
    for brand_id in {row['brand_id'] for row in memberships}:
        admin.table('brands').delete().eq('id', brand_id).execute()
    for user in list(admin.auth.admin.list_users()):
        if user.id in ids.values():
            admin.auth.admin.delete_user(user.id)


def main() -> None:
    ids: dict[str, str] = {}
    original_generation = ai_service.request_terms_summary_generation
    try:
        for key, (email, name, account_type) in USERS.items():
            user = admin.auth.admin.create_user({'email': email, 'password': fictional_passphrase, 'email_confirm': True}).user
            ids[key] = user.id
            admin.table('profiles').insert({'id': user.id, 'email': email, 'display_name': name, 'account_type': account_type}).execute()
        brand_id = admin.table('brands').insert({'company_name': f'Fictional B4 Brand {RUN_ID}', 'industry': 'Beauty'}).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['K'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()
        tokens = {key: access_token(info[0]) for key, info in USERS.items()}
        payload = clean_payload()
        valid_json = json.dumps(payload)

        route_deal = create_deal(ids, brand_id, f'Fictional route persistence {RUN_ID}')
        overrides = [
            {'field_key': key, 'status': 'confirmed'}
            for key in ai_service.MINIMUM_FIELD_KEYS
        ]
        admin.table('deal_summary_gates').insert({'deal_id': route_deal, 'manual_overrides': overrides}).execute()
        check('non-participant cannot request or confirm Gate A', call(f'/deals/{route_deal}/request-summary', tokens['U']).status_code == 403 and call(f'/deals/{route_deal}/confirm-summary-request', tokens['U']).status_code == 403)
        check('authorized participant can request confirmed Gate A', call(f'/deals/{route_deal}/request-summary', tokens['B']).status_code == 200)

        provider = FakeProvider([valid_json])

        async def fake_generation(deal_id: str, generation_id: str, ip_address: str):
            return await original_generation(deal_id, generation_id, ip_address, provider=provider)

        ai_service.request_terms_summary_generation = fake_generation
        first = call(f'/deals/{route_deal}/confirm-summary-request', tokens['C'])
        second = call(f'/deals/{route_deal}/confirm-summary-request', tokens['C'])
        check('confirmed Gate A returns safe pending-summary identity and v2 provenance', first.status_code == 200 and first.json()['summary']['status'] == 'pending_approval' and first.json()['summary']['schema_version'] == CURRENT_CHAT_SCHEMA_VERSION and 'raw_output' not in first.text)
        check('successful retry returns the same row without another provider call', second.status_code == 200 and second.json()['summary']['id'] == first.json()['summary']['id'] and second.json()['idempotent'] is True and len(provider.requests) == 1)
        summary_id = first.json()['summary']['id']
        persisted = admin.table('ai_summaries').select('*').eq('id', summary_id).single().execute().data
        check('validated raw/canonical JSON and non-secret v2 provenance are persisted', persisted['raw_output'] == payload and persisted['structured_terms'] == payload and persisted['prompt_version'] == CURRENT_CHAT_PROMPT_VERSION and persisted['provider'] == 'fake')

        creator = authenticated_client(USERS['C'][0])
        brand = authenticated_client(USERS['B'][0])
        checker = authenticated_client(USERS['K'][0])
        outsider = authenticated_client(USERS['U'][0])
        check('creator, brand, and Checker can read the pending summary under RLS', all(client.table('ai_summaries').select('id').eq('id', summary_id).execute().data for client in (creator, brand, checker)))
        check('outsider cannot read the pending summary under RLS', outsider.table('ai_summaries').select('id').eq('id', summary_id).execute().data == [])
        try:
            outsider.table('deal_participants').insert({
                'deal_id': route_deal,
                'profile_id': ids['U'],
                'participant_role': 'creator',
            }).execute()
            outsider_self_add_blocked = False
        except Exception:
            outsider_self_add_blocked = True
        check('outsider cannot self-enroll then inherit participant summary reads', outsider_self_add_blocked and outsider.table('ai_summaries').select('id').eq('id', summary_id).execute().data == [])
        creator.table('deal_participants').update({'last_read_at': '2026-08-27T00:00:00+00:00'}).eq('deal_id', route_deal).eq('profile_id', ids['C']).execute()
        check('backend-added legitimate participant retains own read-marker update and summary read', creator.table('ai_summaries').select('id').eq('id', summary_id).execute().data[0]['id'] == summary_id)
        try:
            outsider.table('ai_summaries').insert({
                'deal_id': route_deal,
                'raw_output': payload,
                'structured_terms': payload,
            }).execute()
            client_insert_blocked = False
        except Exception:
            client_insert_blocked = True
        try:
            creator.rpc('persist_chat_ai_summary', {
                'p_deal_id': route_deal, 'p_generation_id': first.json()['summary']['generation_id'],
                'p_raw_output': payload, 'p_structured_terms': payload,
                'p_schema_version': SCHEMA_VERSION, 'p_prompt_version': PROMPT_VERSION,
                'p_provider': 'fake', 'p_model': 'fake-b4-002', 'p_ip_address': 'test',
            }).execute()
            client_rpc_blocked = False
        except Exception:
            client_rpc_blocked = True
        check('authenticated clients cannot insert summaries or invoke persistence RPC', client_insert_blocked and client_rpc_blocked)

        failure_deal = create_deal(ids, brand_id, f'Fictional safe recovery {RUN_ID}')
        failure_generation = make_gate_ready(failure_deal, ids)
        failing = FakeProvider(['not json', '{}'])

        async def failing_generation(deal_id: str, generation_id: str, ip_address: str):
            return await original_generation(deal_id, generation_id, ip_address, provider=failing)

        ai_service.request_terms_summary_generation = failing_generation
        failed = call(f'/deals/{failure_deal}/confirm-summary-request', tokens['C'])
        failure_audits = admin.table('audit_log').select('action,metadata').eq('action', 'chat_terms_summary_persisted').execute().data
        check('second invalid output maps to safe 502 and persists no summary or success audit', failed.status_code == 502 and len(failing.requests) == 2 and admin.table('ai_summaries').select('id').eq('deal_id', failure_deal).execute().data == [] and not any((row.get('metadata') or {}).get('deal_id') == failure_deal for row in failure_audits))
        check('failed event remains confirmed, chatting, and retryable with same generation identity', admin.table('deal_summary_gates').select('request_status,generation_id').eq('deal_id', failure_deal).single().execute().data == {'request_status': 'ready_for_generation', 'generation_id': failure_generation} and admin.table('deals').select('stage').eq('id', failure_deal).single().execute().data['stage'] == 'chatting')

        recovered_provider = FakeProvider([valid_json])

        async def recovered_generation(deal_id: str, generation_id: str, ip_address: str):
            return await original_generation(deal_id, generation_id, ip_address, provider=recovered_provider)

        ai_service.request_terms_summary_generation = recovered_generation
        recovered = call(f'/deals/{failure_deal}/confirm-summary-request', tokens['C'])
        check('retry of the same confirmed event can recover and persist once', recovered.status_code == 200 and recovered.json()['summary']['generation_id'] == failure_generation and len(recovered_provider.requests) == 1)

        raced_deal = create_deal(ids, brand_id, f'Fictional persistence race {RUN_ID}')
        raced_generation = make_gate_ready(raced_deal, ids)
        raced_provider = FakeProvider(
            [valid_json],
            on_generate=lambda: admin.table('deals').update({'stage': 'approval'}).eq('id', raced_deal).execute(),
        )

        async def raced_generation_call(deal_id: str, generation_id: str, ip_address: str):
            return await original_generation(deal_id, generation_id, ip_address, provider=raced_provider)

        ai_service.request_terms_summary_generation = raced_generation_call
        raced = call(f'/deals/{raced_deal}/confirm-summary-request', tokens['C'])
        check('wrong-stage persistence race maps to stable safe HTTP 409', raced.status_code == 409 and 'B4002' not in raced.text and 'summary deal' not in raced.text and admin.table('ai_summaries').select('id').eq('deal_id', raced_deal).execute().data == [])

        concurrency_deal = create_deal(ids, brand_id, f'Fictional atomic concurrency {RUN_ID}')
        concurrency_generation = make_gate_ready(concurrency_deal, ids)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: atomic_persist(concurrency_deal, concurrency_generation, payload), range(4)))
        result_ids = {row['id'] for row in results}
        rows = admin.table('ai_summaries').select('id').eq('deal_id', concurrency_deal).eq('generation_id', concurrency_generation).execute().data
        atomic_audits = admin.table('audit_log').select('metadata').eq('action', 'chat_terms_summary_persisted').execute().data
        check('concurrent completions return one logical summary row', len(result_ids) == 1 and len(rows) == 1)
        check('atomic first-writer persistence creates one metadata-only success audit', sum((row.get('metadata') or {}).get('generation_id') == concurrency_generation for row in atomic_audits) == 1)

        try:
            atomic_persist(concurrency_deal, str(uuid4()), payload)
            forged_blocked = False
        except Exception:
            forged_blocked = True
        check('forged generation identity is rejected by Postgres', forged_blocked and len(admin.table('ai_summaries').select('id').eq('deal_id', concurrency_deal).execute().data) == 1)

        all_summary_ids = [summary_id, recovered.json()['summary']['id'], next(iter(result_ids))]
        check('no term approvals are created prematurely', admin.table('term_approvals').select('id').in_('summary_id', all_summary_ids).execute().data == [])
        no_authority_tables = ('deal_terms', 'deliverables', 'briefs', 'exclusivity_clauses', 'usage_rights', 'whitelisting_arrangements', 'blackout_windows', 'disclosure_requirements', 'payments')
        check('no canonical terms, rights, deliverables, briefs, payments, or milestones are written', all(admin.table(table).select('id').in_('deal_id', [route_deal, failure_deal, concurrency_deal, raced_deal]).execute().data == [] for table in no_authority_tables))
        check('successful summary deals remain chatting and Gate B creates no stage transition', all(row['stage'] == 'chatting' for row in admin.table('deals').select('stage').in_('id', [route_deal, failure_deal, concurrency_deal]).execute().data))
    finally:
        ai_service.request_terms_summary_generation = original_generation
        cleanup(ids)


if __name__ == '__main__':
    main()
