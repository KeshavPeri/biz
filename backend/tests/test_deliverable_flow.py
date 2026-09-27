"""Development-Supabase acceptance checks for canonical deliverables.

Uses run-unique fictional users, real JWT/FastAPI authorization, independent
service clients for concurrency, and safe parent-cascade cleanup. Migration 029
must be applied first.
"""

from __future__ import annotations

import copy
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
from services.deliverable_service import get_deliverables, materialize_for_creating_entry  # noqa: E402
from services.stage_engine import DealError  # noqa: E402
from services.term_extraction import PROMPT_VERSION, SCHEMA_VERSION, TermsExtraction  # noqa: E402

SUPABASE_URL = os.environ['SUPABASE_URL']
ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
MANAGEMENT_CREDENTIAL = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f'Deliverables-{RUN_ID}-Fictional!'
USERS = {
    'C': (f'deliverable.creator.{RUN_ID}@inflo.test', 'Fictional Deliverable Creator', 'creator'),
    'B': (f'deliverable.admin.{RUN_ID}@inflo.test', 'Fictional Deliverable Admin', 'brand'),
    'K': (f'deliverable.checker.{RUN_ID}@inflo.test', 'Fictional Deliverable Checker', 'brand'),
    'O': (f'deliverable.outsider.{RUN_ID}@inflo.test', 'Fictional Deliverable Outsider', 'brand'),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
checks: list[tuple[str, bool]] = []
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
deal_ids: list[str] = []
brand_id: str | None = None


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


def call(method: str, path: str, actor: str):
    return api.request(method, path, headers={'Authorization': f'Bearer {tokens[actor]}'})


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.auth.sign_in_with_password({'email': USERS[actor][0], 'password': PASSWORD})
    return client


def found(value: object) -> dict:
    return {
        'status': 'found',
        'value': value,
        'evidence': [{'message_id': 'fictional-message', 'quote': 'fictional agreed term'}],
    }


def not_discussed() -> dict:
    return {'status': 'not_discussed', 'value': None, 'evidence': []}


def terms(count: int = 2) -> dict:
    formats = ['Reel', 'Story'][:count]
    timings = [
        {'deliverable_index': 1, 'posting_date': '2026-09-15', 'window_start': None, 'window_end': None},
        {'deliverable_index': 2, 'posting_date': None, 'window_start': '2026-09-20', 'window_end': '2026-09-22'},
    ][:count]
    value = {
        'payment_amount': found({'amount': 64000, 'currency': 'INR'}),
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
        'content_format_per_deliverable': found([
            {'deliverable_index': index, 'content_format': content_format}
            for index, content_format in enumerate(formats, 1)
        ]),
        'platform_per_deliverable': found([
            {'deliverable_index': index, 'platform': 'Instagram'}
            for index in range(1, count + 1)
        ]),
        'posting_window_per_deliverable': found(timings),
        'sponsored_content_disclosure': found({'required': True, 'platform_rules': ['Use #ad']}),
        'content_ownership': found('creator'),
        'deliverable_count': found(count),
        'location_per_deliverable': found([
            {'deliverable_index': index, 'location': f'Fictional studio {index}'}
            for index in range(1, count + 1)
        ]),
        'milestone_schedule': not_discussed(),
    }
    TermsExtraction.model_validate(value)
    return value


def make_deal(stage: str, label: str, structured_terms: dict, *, generated_at: str | None = None) -> tuple[str, str]:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['C'],
        'brand_id': brand_id,
        'deal_name': f'Fictional deliverables {label} {RUN_ID}',
        'direction': 'inbound',
        'created_by': ids['B'],
        'stage': stage,
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
        {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
    ]).execute()
    summary_row = {
        'deal_id': deal_id,
        'raw_output': {'source': 'fictional acceptance fixture'},
        'structured_terms': structured_terms,
        'status': 'approved',
        'schema_version': SCHEMA_VERSION,
        'prompt_version': PROMPT_VERSION,
    }
    if generated_at:
        summary_row['generated_at'] = generated_at
    summary_id = admin.table('ai_summaries').insert(summary_row).execute().data[0]['id']
    if stage == 'creating':
        admin.table('contracts').insert({
            'deal_id': deal_id,
            'version': 1,
            'storage_path': f'{deal_id}/fictional-executed-v1.pdf',
            'generated_from_summary_id': summary_id,
            'status': 'executed',
            'draft_source_sha256': 'd' * 64,
        }).execute()
    deal_ids.append(deal_id)
    return deal_id, summary_id


def concurrent_read(deal_id: str) -> tuple[str, tuple[str, ...] | int]:
    client = create_client(SUPABASE_URL, SERVICE_KEY)
    try:
        state = get_deliverables(deal_id, ids['C'], _client=client)
        return ('ok', tuple(row['id'] for row in state['deliverables']))
    except DealError as exc:
        return ('error', exc.status_code)


def cleanup() -> None:
    print('\nCleaning up fictional deliverable data...')
    user_ids = list(ids.values())
    if user_ids:
        quoted = ','.join(f"'{user_id}'" for user_id in user_ids)
        management_sql(
            'SET session_replication_role = replica; '
            f'DELETE FROM audit_log WHERE actor_id IN ({quoted}); '
            'SET session_replication_role = origin;'
        )
    for deal_id in deal_ids:
        admin.table('deals').delete().eq('id', deal_id).execute()
    if brand_id:
        admin.table('brands').delete().eq('id', brand_id).execute()
    for user_id in user_ids:
        admin.auth.admin.delete_user(user_id)
    print('  cleanup complete')


def main() -> None:
    global brand_id
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {'email': email, 'password': PASSWORD, 'email_confirm': True}
            ).user.id
            admin.table('profiles').insert({
                'id': ids[key], 'email': email, 'display_name': name, 'account_type': account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table('brands').insert({
            'company_name': f'Fictional Deliverable Studio {RUN_ID}', 'industry': 'Media',
        }).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['K'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['O'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()

        multi_deal, multi_summary = make_deal('creating', 'multi', terms(2))
        outsider = call('GET', f'/deals/{multi_deal}/deliverables', 'O')
        check('outsider is denied before source or stage details', outsider.status_code == 403)

        with ThreadPoolExecutor(max_workers=2) as pool:
            race = list(pool.map(lambda _: concurrent_read(multi_deal), range(2)))
        canonical = admin.table('deliverables').select('*').eq('deal_id', multi_deal).order('sequence').execute().data
        check(
            'concurrent initialization returns one identical complete set',
            all(row[0] == 'ok' for row in race)
            and race[0][1] == race[1][1]
            and len(canonical) == 2
            and [row['sequence'] for row in canonical] == [1, 2],
        )
        check(
            'approved date and inclusive window map losslessly with canonical enums',
            canonical[0]['content_format'] == 'reel'
            and canonical[0]['platform'] == 'instagram'
            and canonical[0]['posting_date'] == '2026-09-15'
            and canonical[0]['posting_window_start'] is None
            and canonical[1]['content_format'] == 'story'
            and canonical[1]['posting_date'] is None
            and canonical[1]['posting_window_start'] == '2026-09-20'
            and canonical[1]['posting_window_end'] == '2026-09-22'
            and [row['location'] for row in canonical] == ['Fictional studio 1', 'Fictional studio 2'],
        )
        check(
            'every row starts pending at round zero with exact provenance and empty proof fields',
            all(
                row['revision_max'] == 2
                and row['revision_current'] == 0
                and row['status'] == 'pending'
                and row['source_summary_id'] == multi_summary
                and row['approved_content_url'] is None
                and row['live_post_url'] is None
                and row['post_metadata'] is None
                for row in canonical
            ),
        )

        participant_payloads = [call('GET', f'/deals/{multi_deal}/deliverables', actor) for actor in ('C', 'B', 'K')]
        shared_rows = [
            [{key: value for key, value in row.items() if key != 'available_actions'} for row in response.json()['deliverables']]
            for response in participant_payloads
        ]
        check(
            'all participant roles receive the same stable ordered safe plan',
            all(response.status_code == 200 for response in participant_payloads)
            and all(rows == shared_rows[0] for rows in shared_rows[1:])
            and [row['display_name'] for row in participant_payloads[0].json()['deliverables']] == ['Deliverable 1', 'Deliverable 2'],
        )
        safe_text = str(participant_payloads[0].json()).lower()
        check(
            'API hides raw summary, provenance, audit, IP, proof, and later-slice controls',
            all(term not in safe_text for term in ('structured_terms', 'source_summary_id', 'audit', 'ip_address', 'approved_content_url', 'live_post_url'))
            and all(row['available_actions']['can_submit_content'] for row in participant_payloads[0].json()['deliverables'])
            and all(
                not row['available_actions']['can_request_revision']
                and not row['available_actions']['can_approve_content']
                and not row['available_actions']['can_submit_live_url']
                for payload in participant_payloads for row in payload.json()['deliverables']
            ),
        )

        audit_rows = admin.table('audit_log').select('action,metadata').eq('entity_id', multi_deal).eq(
            'action', 'canonical_deliverables_materialized'
        ).execute().data
        check(
            'retries and concurrency create exactly one minimal audit entry',
            len(audit_rows) == 1
            and set(audit_rows[0]['metadata']) == {'deal_id', 'source_summary_id', 'deliverable_count'},
        )

        one_deal, _ = make_deal('creating', 'single', terms(1))
        single = call('GET', f'/deals/{one_deal}/deliverables', 'C')
        check(
            'one-deliverable approved summary produces exactly one complete row',
            single.status_code == 200
            and len(single.json()['deliverables']) == 1
            and single.json()['deliverables'][0]['posting_date'] == '2026-09-15',
        )

        direct = auth_client('B')
        direct_insert = direct_update = direct_delete = False
        try:
            direct.table('deliverables').insert({
                'deal_id': multi_deal, 'sequence': 3, 'content_format': 'reel', 'platform': 'instagram',
                'posting_date': '2026-09-30', 'source_summary_id': multi_summary,
            }).execute()
        except Exception:
            direct_insert = True
        try:
            direct.table('deliverables').update({'status': 'approved'}).eq('id', canonical[0]['id']).execute()
        except Exception:
            direct_update = True
        try:
            direct.table('deliverables').delete().eq('id', canonical[0]['id']).execute()
        except Exception:
            direct_delete = True
        check('authenticated direct INSERT, UPDATE, and DELETE are denied', direct_insert and direct_update and direct_delete)
        check(
            'participant SELECT remains visible and outsider RLS SELECT remains empty',
            len(direct.table('deliverables').select('id').eq('deal_id', multi_deal).execute().data) == 2
            and auth_client('O').table('deliverables').select('id').eq('deal_id', multi_deal).execute().data == [],
        )

        service_insert = service_update = service_delete = False
        try:
            admin.table('deliverables').insert({
                'deal_id': multi_deal, 'sequence': 3, 'content_format': 'reel', 'platform': 'instagram',
                'posting_date': '2026-09-30', 'source_summary_id': multi_summary,
            }).execute()
        except Exception:
            service_insert = True
        try:
            admin.table('deliverables').update({'status': 'approved'}).eq('id', canonical[0]['id']).execute()
        except Exception:
            service_update = True
        try:
            admin.table('deliverables').delete().eq('id', canonical[0]['id']).execute()
        except Exception:
            service_delete = True
        truncate_allowed = management_sql(
            "SELECT has_table_privilege('service_role', 'public.deliverables', 'TRUNCATE') AS allowed"
        )[0]['allowed']
        check(
            'ordinary service client cannot bypass the atomic write boundary',
            service_insert and service_update and service_delete and not truncate_allowed,
        )

        wrong_stage, _ = make_deal('approval', 'wrong-stage', terms(1))
        check('participant read before Creating is a friendly conflict', call(
            'GET', f'/deals/{wrong_stage}/deliverables', 'C'
        ).status_code == 409)
        check('outsider receives 403 even when the deal is in the wrong stage', call(
            'GET', f'/deals/{wrong_stage}/deliverables', 'O'
        ).status_code == 403)

        approval_deal, approval_summary = make_deal('approval', 'future-entry', terms(2))
        admin.table('contracts').insert({
            'deal_id': approval_deal,
            'version': 1,
            'storage_path': f'{approval_deal}/fictional-executed.pdf',
            'generated_from_summary_id': approval_summary,
            'status': 'executed',
            'draft_source_sha256': 'a' * 64,
        }).execute()
        future = materialize_for_creating_entry(admin, approval_deal, ids['B'], 'fictional-future-entry')
        check(
            'future Creating entry initializes the exact set before stage completion',
            future['outcome'] == 'created'
            and len(admin.table('deliverables').select('id').eq('deal_id', approval_deal).execute().data) == 2,
        )

        invalid_cases: list[tuple[str, dict]] = []
        malformed = terms(2)
        malformed['posting_window_per_deliverable']['value'][1]['window_end'] = None
        invalid_cases.append(('malformed timing', malformed))
        missing_index = terms(2)
        missing_index['platform_per_deliverable']['value'].pop()
        invalid_cases.append(('missing index', missing_index))
        duplicate_index = terms(2)
        duplicate_index['platform_per_deliverable']['value'][1]['deliverable_index'] = 1
        invalid_cases.append(('duplicate index', duplicate_index))
        count_mismatch = terms(2)
        count_mismatch['deliverable_count']['value'] = 1
        invalid_cases.append(('count mismatch', count_mismatch))
        unknown_enum = terms(1)
        unknown_enum['platform_per_deliverable']['value'][0]['platform'] = 'Unknown network'
        invalid_cases.append(('unknown enum', unknown_enum))
        unsupported = terms(1)
        unsupported['platform_per_deliverable']['value'][0]['platform'] = "Brand's own channel (UGC)"
        invalid_cases.append(('valid parser enum without database mapping', unsupported))

        invalid_ok = True
        for label, payload in invalid_cases:
            invalid_deal, _ = make_deal('creating', label, payload)
            response = call('GET', f'/deals/{invalid_deal}/deliverables', 'C')
            rows = admin.table('deliverables').select('id').eq('deal_id', invalid_deal).execute().data
            invalid_ok = invalid_ok and response.status_code == 409 and rows == []
        check('malformed, index, count, and enum failures create no rows', invalid_ok)

        partial_deal, _ = make_deal('creating', 'partial-conflict', terms(2))
        first_partial = call('GET', f'/deals/{partial_deal}/deliverables', 'C')
        partial_rows = admin.table('deliverables').select('id,sequence').eq('deal_id', partial_deal).order('sequence').execute().data
        management_sql(f"DELETE FROM deliverables WHERE id = '{partial_rows[1]['id']}'")
        conflict = call('GET', f'/deals/{partial_deal}/deliverables', 'C')
        preserved = admin.table('deliverables').select('id,sequence').eq('deal_id', partial_deal).execute().data
        check(
            'a partial canonical set is preserved and reported without repair',
            first_partial.status_code == 200
            and conflict.status_code == 409
            and preserved == [partial_rows[0]],
        )

        cascade_deal, _ = make_deal('creating', 'cascade', terms(1))
        cascade = call('GET', f'/deals/{cascade_deal}/deliverables', 'C').json()['deliverables'][0]['id']
        admin.table('deals').delete().eq('id', cascade_deal).execute()
        check(
            'parent deal cleanup retains legitimate FK cascade behavior',
            admin.table('deliverables').select('id').eq('id', cascade).execute().data == [],
        )
    finally:
        cleanup()

    failures = [label for label, ok in checks if not ok]
    print(f'\n{len(checks) - len(failures)}/{len(checks)} canonical-deliverable checks passed')
    if failures:
        raise SystemExit('Failed: ' + '; '.join(failures))


if __name__ == '__main__':
    main()
