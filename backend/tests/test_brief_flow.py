"""Development-Supabase acceptance checks for versioned creative briefs.

Uses run-unique fictional accounts, real Supabase JWTs/FastAPI auth, and safe
cleanup. Migration 028 must be applied first.
"""

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
from services.brief_service import create_brief  # noqa: E402
from services.stage_engine import DealError  # noqa: E402

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
MANAGEMENT_CREDENTIAL = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f'Brief-{RUN_ID}-Fictional!'
USERS = {
    'C': (f'brief.creator.{RUN_ID}@inflo.test', 'Fictional Brief Creator', 'creator'),
    'B': (f'brief.admin.{RUN_ID}@inflo.test', 'Fictional Brief Admin', 'brand'),
    'M': (f'brief.maker.{RUN_ID}@inflo.test', 'Fictional Brief Maker', 'brand'),
    'K': (f'brief.checker.{RUN_ID}@inflo.test', 'Fictional Brief Checker', 'brand'),
    'O': (f'brief.outsider.{RUN_ID}@inflo.test', 'Fictional Outside Brand User', 'brand'),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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


def service_role_can_truncate_briefs() -> bool:
    rows = management_sql(
        "SELECT has_table_privilege('service_role', 'public.briefs', 'TRUNCATE') AS allowed"
    )
    return bool(rows[0]['allowed'])


def call(method: str, path: str, actor: str, body: dict | None = None):
    return api.request(
        method,
        path,
        json=body,
        headers={'Authorization': f'Bearer {tokens[actor]}'},
    )


def auth_client(actor: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    email = USERS[actor][0]
    client.auth.sign_in_with_password({'email': email, 'password': PASSWORD})
    return client


def content(version: int) -> dict:
    return {
        'objective': f'Launch the fictional monsoon skincare story v{version}',
        'guidelines': 'Warm, candid routine; keep the product use clear.',
        'dos': ['Show the fictional product in natural light', 'Use the agreed disclosure'],
        'donts': ['Do not show competitor packaging'],
        'hashtags': ['#FictionalMonsoon', '#ad'],
        'caption_guidance': 'Explain the routine in the creator’s own voice.',
    }


def make_deal(stage: str, label: str) -> str:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['C'],
        'brand_id': brand_id,
        'deal_name': f'Fictional brief {label} {RUN_ID}',
        'direction': 'inbound',
        'created_by': ids['B'],
        'stage': stage,
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
        {'deal_id': deal_id, 'profile_id': ids['M'], 'participant_role': 'brand_maker'},
        {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
    ]).execute()
    deal_ids.append(deal_id)
    return deal_id


def concurrent_create(deal_id: str) -> tuple[str, int]:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    try:
        state = create_brief(deal_id, ids['B'], 1, content(2), 'fictional-race', _client=client)
        return ('ok', state['latest']['version'])
    except DealError as exc:
        return ('error', exc.status_code)


def cleanup() -> None:
    print('\nCleaning up fictional brief data...')
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
                'id': ids[key],
                'email': email,
                'display_name': name,
                'account_type': account_type,
            }).execute()
            tokens[key] = auth_client(key).auth.get_session().access_token

        brand_id = admin.table('brands').insert({
            'company_name': f'Fictional Monsoon Studio {RUN_ID}',
            'industry': 'Beauty',
        }).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['M'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['K'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['O'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()

        deal_id = make_deal('creating', 'campaign')
        wrong_stage_id = make_deal('approval', 'wrong stage')

        participant_reads = [call('GET', f'/deals/{deal_id}/briefs', actor) for actor in ('C', 'B', 'M', 'K')]
        check(
            'creator, admin, maker, and checker see the same safe empty state',
            all(response.status_code == 200 and response.json()['latest'] is None for response in participant_reads),
        )
        check('outsider API read is denied', call('GET', f'/deals/{deal_id}/briefs', 'O').status_code == 403)
        unknown_brief = str(uuid4())
        check(
            'outsider acknowledgment is the same 403 before any stage-dependent error',
            call('POST', f'/deals/{deal_id}/briefs/{unknown_brief}/acknowledge', 'O', {}).status_code == 403
            and call('POST', f'/deals/{wrong_stage_id}/briefs/{unknown_brief}/acknowledge', 'O', {}).status_code == 403,
        )
        check('wrong-stage brand write is a friendly conflict', call('POST', f'/deals/{wrong_stage_id}/briefs', 'B', {
            'expected_version': 0, 'content': content(1),
        }).status_code == 409)

        invalid = call('POST', f'/deals/{deal_id}/briefs', 'B', {
            'expected_version': 0,
            'content': {**content(1), 'objective': '   ', 'unexpected': 'blocked'},
        })
        check('strict malformed content is rejected with 422', invalid.status_code == 422)

        first = call('POST', f'/deals/{deal_id}/briefs', 'B', {
            'expected_version': 0, 'content': content(1),
        })
        first_state = first.json()
        first_id = first_state['latest']['id']
        check(
            'brand admin creates exact unacknowledged v1 with provenance',
            first.status_code == 200
            and first_state['latest']['version'] == 1
            and first_state['latest']['content'] == content(1)
            and first_state['latest']['created_by'] == ids['B']
            and not first_state['latest']['acknowledged_by_creator'],
        )

        check('creator cannot create a brief', call('POST', f'/deals/{deal_id}/briefs', 'C', {
            'expected_version': 1, 'content': content(2),
        }).status_code == 403)
        check('checker cannot create a brief', call('POST', f'/deals/{deal_id}/briefs', 'K', {
            'expected_version': 1, 'content': content(2),
        }).status_code == 403)
        check('non-participant brand user cannot create a brief', call('POST', f'/deals/{deal_id}/briefs', 'O', {
            'expected_version': 1, 'content': content(2),
        }).status_code == 403)

        with ThreadPoolExecutor(max_workers=2) as pool:
            race = list(pool.map(lambda _: concurrent_create(deal_id), range(2)))
        rows_after_race = admin.table('briefs').select('id,version').eq('deal_id', deal_id).execute().data
        check(
            'concurrent same-version writes accept one and return one clean 409',
            sorted(race) == [('error', 409), ('ok', 2)]
            and sorted(row['version'] for row in rows_after_race) == [1, 2],
        )
        second_id = next(row['id'] for row in rows_after_race if row['version'] == 2)
        check('duplicate stale version is rejected', call('POST', f'/deals/{deal_id}/briefs', 'B', {
            'expected_version': 1, 'content': content(2),
        }).status_code == 409)

        check('older version acknowledgment is rejected', call(
            'POST', f'/deals/{deal_id}/briefs/{first_id}/acknowledge', 'C', {}
        ).status_code == 409)
        check('brand cannot acknowledge', call(
            'POST', f'/deals/{deal_id}/briefs/{second_id}/acknowledge', 'B', {}
        ).status_code == 403)
        acknowledged = call('POST', f'/deals/{deal_id}/briefs/{second_id}/acknowledge', 'C', {})
        check(
            'named creator acknowledges the latest version',
            acknowledged.status_code == 200
            and acknowledged.json()['latest']['acknowledged_by_creator']
            and acknowledged.json()['latest']['acknowledged_by'] == ids['C'],
        )
        repeated = call('POST', f'/deals/{deal_id}/briefs/{second_id}/acknowledge', 'C', {})
        check('creator acknowledgment is idempotent', repeated.status_code == 200 and repeated.json()['outcome']['idempotent'])

        third = call('POST', f'/deals/{deal_id}/briefs', 'M', {
            'expected_version': 2, 'content': content(3),
        })
        history = third.json()['history']
        check(
            'brand maker creates v3 without mutating v2 acknowledgment',
            third.status_code == 200
            and [row['version'] for row in history] == [3, 2, 1]
            and not history[0]['acknowledged_by_creator']
            and history[1]['acknowledged_by_creator'],
        )

        participant_direct = auth_client('B')
        direct_insert_denied = direct_update_denied = False
        try:
            participant_direct.table('briefs').insert({
                'deal_id': deal_id,
                'version': 4,
                'content': content(4),
                'created_by': ids['B'],
            }).execute()
        except Exception:
            direct_insert_denied = True
        try:
            participant_direct.table('briefs').update({'content': content(99)}).eq('id', first_id).execute()
        except Exception:
            direct_update_denied = True
        check('authenticated participant INSERT and UPDATE are both denied', direct_insert_denied and direct_update_denied)

        outsider_rows = auth_client('O').table('briefs').select('id').eq('deal_id', deal_id).execute().data
        check('direct Supabase read remains participant-only', outsider_rows == [])
        service_read_rows = admin.table('briefs').select('id').eq('deal_id', deal_id).execute().data
        check('service role retains read-only brief access', len(service_read_rows) == 3)
        service_insert_denied = service_update_denied = service_delete_denied = False
        try:
            admin.table('briefs').insert({
                'deal_id': deal_id,
                'version': 4,
                'content': content(4),
                'created_by': ids['B'],
            }).execute()
        except Exception:
            service_insert_denied = True
        try:
            admin.table('briefs').update({
                'acknowledged_by_creator': True,
                'acknowledged_by': ids['C'],
                'acknowledged_at': '2026-08-29T00:00:00Z',
            }).eq('id', first_id).execute()
        except Exception:
            service_update_denied = True
        try:
            admin.table('briefs').delete().eq('id', first_id).execute()
        except Exception:
            service_delete_denied = True
        service_truncate_denied = not service_role_can_truncate_briefs()
        check(
            'service role direct INSERT, UPDATE, DELETE, and TRUNCATE are denied',
            service_insert_denied and service_update_denied and service_delete_denied and service_truncate_denied,
        )
        first_after_forge = admin.table('briefs').select(
            'version,acknowledged_by_creator,acknowledged_by,acknowledged_at'
        ).eq('id', first_id).single().execute().data
        check(
            'old acknowledgment cannot be forged and immutable history remains intact',
            first_after_forge == {
                'version': 1,
                'acknowledged_by_creator': False,
                'acknowledged_by': None,
                'acknowledged_at': None,
            },
        )

        audits = admin.table('audit_log').select('action,metadata,ip_address').eq('entity_type', 'brief').in_(
            'entity_id', [row['id'] for row in admin.table('briefs').select('id').eq('deal_id', deal_id).execute().data]
        ).execute().data
        check(
            'audit is exactly three creates plus one acknowledgment',
            len(audits) == 4
            and sum(row['action'] == 'creative_brief_created' for row in audits) == 3
            and sum(row['action'] == 'creative_brief_acknowledged' for row in audits) == 1,
        )
        check(
            'audit metadata contains ids/version only, never brief content',
            all('content' not in row['metadata'] and set(row['metadata']) == {'deal_id', 'brief_id', 'version', 'actor_id'} for row in audits),
        )
        safe_payload = call('GET', f'/deals/{deal_id}/briefs', 'K').json()
        check(
            'participant response exposes no audit, IP, or service-role fields',
            'audit' not in str(safe_payload).lower()
            and 'ip_address' not in str(safe_payload)
            and 'service_role' not in str(safe_payload),
        )

        cascade_deal = make_deal('creating', 'cascade cleanup')
        cascade_created = call('POST', f'/deals/{cascade_deal}/briefs', 'B', {
            'expected_version': 0, 'content': content(1),
        })
        cascade_brief_id = cascade_created.json()['latest']['id']
        admin.table('deals').delete().eq('id', cascade_deal).execute()
        cascade_rows = admin.table('briefs').select('id').eq('id', cascade_brief_id).execute().data
        check(
            'parent deal deletion retains legitimate FK cascade cleanup',
            cascade_created.status_code == 200 and cascade_rows == [],
        )

        admin.table('deals').update({'stage': 'posted'}).eq('id', deal_id).execute()
        check('brief history remains readable after Creating', call('GET', f'/deals/{deal_id}/briefs', 'C').status_code == 200)
        check('brand writes are blocked after Creating', call('POST', f'/deals/{deal_id}/briefs', 'B', {
            'expected_version': 3, 'content': content(4),
        }).status_code == 409)
        check('creator acknowledgment is blocked after Creating', call(
            'POST', f"/deals/{deal_id}/briefs/{history[0]['id']}/acknowledge", 'C', {}
        ).status_code == 409)
    finally:
        cleanup()

    failures = [label for label, ok in checks if not ok]
    print(f'\n{len(checks) - len(failures)}/{len(checks)} creative-brief checks passed')
    if failures:
        raise SystemExit('Failed: ' + '; '.join(failures))


if __name__ == '__main__':
    main()
