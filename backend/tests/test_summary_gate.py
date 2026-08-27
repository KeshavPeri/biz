"""Development-DB end-to-end checks for Phase 9 tasks 9.9 + 9.10.

Run only against the development Supabase project:
    python backend/tests/test_summary_gate.py

Uses fictional accounts and deletes them in finally. It covers the server route,
RBAC, audit trail and row-locked/idempotent persisted Gate-A state.
"""

import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR.parent / '.env')

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services import ai_service  # noqa: E402

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ACCESS_TOKEN = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
PASSWORD = 'Chaturthi2026!Inflo'
USERS = {
    'B': ('gate.brand@inflo.test', 'Brand Admin', 'brand'),
    'C': ('gate.creator@inflo.test', 'Creator', 'creator'),
    'C2': ('gate.creator2@inflo.test', 'Creator Two', 'creator'),
    'M': ('gate.maker@inflo.test', 'Brand Maker', 'brand'),
    'K': ('gate.checker@inflo.test', 'Brand Checker', 'brand'),
    'U': ('gate.outsider@inflo.test', 'Outsider', 'creator'),
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
        headers={'Authorization': f'Bearer {ACCESS_TOKEN}'}, json={'query': sql}, timeout=60,
    )
    response.raise_for_status()


def token(email: str) -> str:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY).auth.sign_in_with_password(
        {'email': email, 'password': PASSWORD}
    ).session.access_token


def call(path: str, access_token: str, method: str = 'post'):
    return getattr(api, method)(path, headers={'Authorization': f'Bearer {access_token}'})


def cleanup() -> None:
    users = [u for u in admin.auth.admin.list_users() if u.email in {x[0] for x in USERS.values()}]
    ids = [u.id for u in users]
    if not ids:
        return
    quoted = ','.join(f"'{uid}'" for uid in ids)
    mgmt_sql('SET session_replication_role = replica; ' + f'DELETE FROM audit_log WHERE actor_id IN ({quoted}); ' + 'SET session_replication_role = origin;')
    deals = admin.table('deals').select('id,brand_id').in_('created_by', ids).execute().data
    for deal in deals:
        admin.table('deals').delete().eq('id', deal['id']).execute()
    brands = admin.table('brand_members').select('brand_id').in_('profile_id', ids).execute().data
    for brand in {row['brand_id'] for row in brands}:
        admin.table('brands').delete().eq('id', brand).execute()
    for user in users:
        admin.auth.admin.delete_user(user.id)


def main() -> None:
    cleanup()
    ids: dict[str, str] = {}
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user({'email': email, 'password': PASSWORD, 'email_confirm': True}).user.id
            admin.table('profiles').insert({'id': ids[key], 'email': email, 'display_name': name, 'account_type': account_type}).execute()
        brand_id = admin.table('brands').insert({'company_name': 'Gate Test Brand', 'industry': 'Beauty'}).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['M'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['K'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()
        deal_id = admin.table('deals').insert({'creator_id': ids['C'], 'brand_id': brand_id, 'deal_name': 'Gate test', 'direction': 'inbound', 'created_by': ids['B'], 'stage': 'chatting'}).execute().data[0]['id']
        admin.table('deal_participants').insert([
            {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
            {'deal_id': deal_id, 'profile_id': ids['C2'], 'participant_role': 'creator'},
            {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
            {'deal_id': deal_id, 'profile_id': ids['M'], 'participant_role': 'brand_maker'},
            {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
        ]).execute()
        tokens = {key: token(info[0]) for key, info in USERS.items()}

        initial = call(f'/deals/{deal_id}/summary-checklist', tokens['C'], 'get').json()
        check('exact 12 fields and all are initially missing', len(initial['checklist']) == 12 and len(initial['missing_fields']) == 12)
        check('incomplete checklist blocks request', call(f'/deals/{deal_id}/request-summary', tokens['C']).status_code == 409)
        check('outsider blocked from status', call(f'/deals/{deal_id}/summary-checklist', tokens['U'], 'get').status_code == 403)
        check('checker cannot propose override', call(f'/deals/{deal_id}/summary-checklist/payment_amount/override', tokens['K']).status_code == 403)

        # Parser is intentionally pending in Phase 9; two-sided overrides make
        # every minimum field complete and verify audit history at the same time.
        for field in (row['key'] for row in initial['checklist']):
            check(f'{field}: creator can propose override', call(f'/deals/{deal_id}/summary-checklist/{field}/override', tokens['C']).status_code == 200)
            check(f'{field}: brand confirms opposite-side override', call(f'/deals/{deal_id}/summary-checklist/{field}/confirm-override', tokens['B']).status_code == 200)
        complete = call(f'/deals/{deal_id}/summary-checklist', tokens['C'], 'get').json()
        check('completed overrides clear all missing fields', complete['missing_fields'] == [] and complete['summary_request_allowed'] is True)
        audits = admin.table('audit_log').select('action').eq('entity_id', deal_id).execute().data
        check('override proposals and confirmations are audit-logged', sum(row['action'] == 'checklist_override_proposed' for row in audits) == 12 and sum(row['action'] == 'checklist_override_confirmed' for row in audits) == 12)

        check('checker cannot request Gate A', call(f'/deals/{deal_id}/request-summary', tokens['K']).status_code == 403)
        first = call(f'/deals/{deal_id}/request-summary', tokens['C'])
        duplicate = call(f'/deals/{deal_id}/request-summary', tokens['C'])
        check('creator can request and duplicate is idempotent', first.status_code == 200 and duplicate.json().get('idempotent') is True)
        check('self confirmation rejected', call(f'/deals/{deal_id}/confirm-summary-request', tokens['C']).status_code == 403)
        check('same-side confirmation rejected', call(f'/deals/{deal_id}/confirm-summary-request', tokens['C2']).status_code == 403)
        check('checker cannot confirm Gate A', call(f'/deals/{deal_id}/confirm-summary-request', tokens['K']).status_code == 403)
        check('other side can say not yet', call(f'/deals/{deal_id}/summary-request-not-yet', tokens['B']).status_code == 200)
        check('brand can make fresh request after not-yet', call(f'/deals/{deal_id}/request-summary', tokens['B']).status_code == 200)

        calls = 0
        original = ai_service.request_terms_summary_generation

        async def counted_generation(gate_deal_id: str, generation_id: str, ip_address: str):
            nonlocal calls
            calls += 1
            del gate_deal_id, ip_address
            return {
                'id': '00000000-0000-0000-0000-000000000001',
                'generation_id': generation_id,
                'status': 'pending_approval',
                'schema_version': 'chat-terms-22.v1',
                'prompt_version': 'chat-terms-extraction.v1',
                'provider': 'fake',
                'model': 'fake-model',
                'generated_at': '2026-08-27T00:00:00Z',
                'idempotent': calls > 1,
            }

        ai_service.request_terms_summary_generation = counted_generation
        try:
            confirmed = call(f'/deals/{deal_id}/confirm-summary-request', tokens['C'])
            duplicate_confirmation = call(f'/deals/{deal_id}/confirm-summary-request', tokens['C'])
        finally:
            ai_service.request_terms_summary_generation = original
        check('opposite side confirms and a retry re-enters the idempotent persistence seam', confirmed.status_code == 200 and duplicate_confirmation.status_code == 200 and calls == 2 and duplicate_confirmation.json().get('idempotent') is True)
        check('Gate-A orchestration itself performs no stage transition', admin.table('deals').select('stage').eq('id', deal_id).execute().data[0]['stage'] == 'chatting')
    finally:
        cleanup()


if __name__ == '__main__':
    main()
