"""Development-Supabase acceptance checks for private content submissions.

Uses fictional users, real JWT/API calls, private Storage, concurrent requests,
and safe cleanup. Migration 030 must be applied first.
"""

from __future__ import annotations

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
from services.content_service import cleanup_expired_uploads  # noqa: E402
from services.term_extraction import PROMPT_VERSION, SCHEMA_VERSION, TermsExtraction  # noqa: E402

SUPABASE_URL = os.environ['SUPABASE_URL']
ANON_KEY = os.environ['SUPABASE_ANON_KEY']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
MANAGEMENT_CREDENTIAL = os.environ['SUPABASE_ACCESS_TOKEN']
PROJECT_REF = re.search(r'https://([a-z0-9]+)\.supabase\.co', SUPABASE_URL).group(1)
RUN_ID = uuid4().hex[:10]
PASSWORD = f'Content-{RUN_ID}-Fictional!'
USERS = {
    'C': (f'content.creator.{RUN_ID}@inflo.test', 'Fictional Content Creator', 'creator'),
    'B': (f'content.admin.{RUN_ID}@inflo.test', 'Fictional Content Admin', 'brand'),
    'M': (f'content.maker.{RUN_ID}@inflo.test', 'Fictional Content Maker', 'brand'),
    'K': (f'content.checker.{RUN_ID}@inflo.test', 'Fictional Content Checker', 'brand'),
    'O': (f'content.outsider.{RUN_ID}@inflo.test', 'Fictional Content Outsider', 'brand'),
}

api = TestClient(app)
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)
checks: list[tuple[str, bool]] = []
ids: dict[str, str] = {}
tokens: dict[str, str] = {}
clients: dict[str, Client] = {}
deal_ids: list[str] = []
object_paths: set[str] = set()
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


def call(method: str, path: str, actor: str, payload: dict | None = None):
    return api.request(
        method,
        path,
        headers={'Authorization': f'Bearer {tokens[actor]}'},
        json=payload,
    )


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


def terms(count: int = 2, revision_max: int = 2) -> dict:
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
        'revision_rounds_max': found(revision_max),
        'creative_guidance': found({'kind': 'creator_discretion', 'text': 'Fictional launch'}),
        'content_format_per_deliverable': found([
            {'deliverable_index': index, 'content_format': ['Reel', 'Story'][index - 1]}
            for index in range(1, count + 1)
        ]),
        'platform_per_deliverable': found([
            {'deliverable_index': index, 'platform': 'Instagram'} for index in range(1, count + 1)
        ]),
        'posting_window_per_deliverable': found([
            {'deliverable_index': index, 'posting_date': f'2026-09-{14 + index:02d}', 'window_start': None, 'window_end': None}
            for index in range(1, count + 1)
        ]),
        'sponsored_content_disclosure': found({'required': True, 'platform_rules': ['Use #ad']}),
        'content_ownership': found('creator'),
        'deliverable_count': found(count),
        'location_per_deliverable': not_discussed(),
        'milestone_schedule': not_discussed(),
    }
    TermsExtraction.model_validate(value)
    return value


def make_deal(label: str, count: int = 2, revision_max: int = 2) -> str:
    deal_id = admin.table('deals').insert({
        'creator_id': ids['C'],
        'brand_id': brand_id,
        'deal_name': f'Fictional content {label} {RUN_ID}',
        'direction': 'inbound',
        'created_by': ids['B'],
        'stage': 'creating',
    }).execute().data[0]['id']
    admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': ids['C'], 'participant_role': 'creator'},
        {'deal_id': deal_id, 'profile_id': ids['B'], 'participant_role': 'brand_admin'},
        {'deal_id': deal_id, 'profile_id': ids['M'], 'participant_role': 'brand_maker'},
        {'deal_id': deal_id, 'profile_id': ids['K'], 'participant_role': 'brand_checker'},
    ]).execute()
    summary = admin.table('ai_summaries').insert({
        'deal_id': deal_id,
        'raw_output': {'source': 'fictional acceptance fixture'},
        'structured_terms': terms(count, revision_max),
        'status': 'approved',
        'schema_version': SCHEMA_VERSION,
        'prompt_version': PROMPT_VERSION,
    }).execute().data[0]
    admin.table('contracts').insert({
        'deal_id': deal_id,
        'version': 1,
        'storage_path': f'{deal_id}/executed-fictional-v1.pdf',
        'generated_from_summary_id': summary['id'],
        'status': 'executed',
        'draft_source_sha256': '0' * 64,
    }).execute()
    deal_ids.append(deal_id)
    return deal_id


def prepare(deal_id: str, deliverable_id: str, name: str, mime: str, size: int, actor: str = 'C'):
    return call('POST', f'/deals/{deal_id}/deliverables/{deliverable_id}/content/prepare', actor, {
        'original_filename': name,
        'mime_type': mime,
        'size_bytes': size,
    })


def upload(actor: str, path: str, data: bytes, mime: str) -> None:
    object_paths.add(path)
    clients[actor].storage.from_('content-drafts').upload(
        path,
        data,
        file_options={'content-type': mime, 'upsert': 'false'},
    )


def submit(deal_id: str, deliverable_id: str, prepared: dict, actor: str = 'C'):
    return call('POST', f'/deals/{deal_id}/deliverables/{deliverable_id}/content/submit', actor, {
        'reservation_id': prepared['reservation_id'],
        'expected_round': prepared['round_number'],
    })


def cleanup() -> None:
    print('\nCleaning up fictional content data...')
    if object_paths:
        try:
            admin.storage.from_('content-drafts').remove(list(object_paths))
        except Exception:
            pass
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
    pdf1 = b'%PDF-1.4\n' + b'fictional-draft-one\n' * 80
    pdf2 = b'%PDF-1.4\n' + b'fictional-draft-two\n' * 80
    try:
        for key, (email, name, account_type) in USERS.items():
            ids[key] = admin.auth.admin.create_user(
                {'email': email, 'password': PASSWORD, 'email_confirm': True}
            ).user.id
            admin.table('profiles').insert({
                'id': ids[key], 'email': email, 'display_name': name, 'account_type': account_type,
            }).execute()
            clients[key] = auth_client(key)
            tokens[key] = clients[key].auth.get_session().access_token

        brand_id = admin.table('brands').insert({
            'company_name': f'Fictional Content Studio {RUN_ID}', 'industry': 'Media',
        }).execute().data[0]['id']
        admin.table('brand_members').insert([
            {'brand_id': brand_id, 'profile_id': ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['M'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['K'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': brand_id, 'profile_id': ids['O'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()

        deal_id = make_deal('multi')
        initial = call('GET', f'/deals/{deal_id}/deliverables', 'C')
        deliverables = initial.json()['deliverables']
        first, second = deliverables[0]['id'], deliverables[1]['id']
        check('multi-deliverable Creating view starts at Round 0 of Y',
              initial.status_code == 200 and len(deliverables) == 2
              and all(row['revision_current'] == 0 and row['available_actions']['can_submit_content'] for row in deliverables))

        outsider_prepare = prepare(deal_id, first, 'draft.pdf', 'application/pdf', len(pdf1), 'O')
        brand_prepare = prepare(deal_id, first, 'draft.pdf', 'application/pdf', len(pdf1), 'B')
        check('only the named creator can prepare an upload', outsider_prepare.status_code == 403 and brand_prepare.status_code == 403)
        check('unsupported type and oversized file have stable 415/413 errors',
              prepare(deal_id, first, 'draft.exe', 'application/octet-stream', 10).status_code == 415
              and prepare(deal_id, first, 'huge.mp4', 'video/mp4', 104857601).status_code == 413)

        bounded_deal = make_deal('bounded-reservations', count=1)
        bounded_deliverable = call('GET', f'/deals/{bounded_deal}/deliverables', 'C').json()['deliverables'][0]['id']
        bounded = [
            prepare(bounded_deal, bounded_deliverable, f'waiting-{index}.pdf', 'application/pdf', len(pdf1))
            for index in range(10)
        ]
        bounded_overflow = prepare(
            bounded_deal, bounded_deliverable, 'waiting-overflow.pdf', 'application/pdf', len(pdf1)
        )
        check('live unbound reservations are capped per creator and deliverable',
              all(response.status_code == 200 for response in bounded) and bounded_overflow.status_code == 409)

        abandoned_deal = make_deal('abandoned-upload', count=1)
        abandoned_deliverable = call('GET', f'/deals/{abandoned_deal}/deliverables', 'C').json()['deliverables'][0]['id']
        abandoned = prepare(
            abandoned_deal, abandoned_deliverable, 'abandoned-network.pdf', 'application/pdf', len(pdf1)
        ).json()
        upload('C', abandoned['upload_path'], pdf1, 'application/pdf')
        management_sql(
            "UPDATE content_draft_uploads SET created_at = now() - interval '2 hours', "
            "expires_at = now() - interval '1 hour' "
            f"WHERE deal_id IN ('{bounded_deal}', '{abandoned_deal}')"
        )
        abandoned_folder, abandoned_name = abandoned['upload_path'].rsplit('/', 1)
        existed_before_cleanup = any(
            item['name'] == abandoned_name
            for item in admin.storage.from_('content-drafts').list(abandoned_folder)
        )
        cleanup_result = cleanup_expired_uploads(limit=25)
        abandoned_rows = management_sql(
            f"SELECT id FROM content_draft_uploads WHERE id = '{abandoned['reservation_id']}'"
        )
        exists_after_cleanup = any(
            item['name'] == abandoned_name
            for item in admin.storage.from_('content-drafts').list(abandoned_folder)
        )
        check('expired abandoned upload and reservation are removed by bounded server cleanup',
              existed_before_cleanup and cleanup_result['claimed'] == 11
              and cleanup_result['removed'] == 11 and cleanup_result['released'] == 0
              and abandoned_rows == [] and not exists_after_cleanup)

        guessed = f'{deal_id}/{first}/{ids["C"]}/{uuid4()}.pdf'
        pivot_denied = False
        try:
            upload('C', guessed, pdf1, 'application/pdf')
        except Exception:
            pivot_denied = True
        check('unprepared and arbitrary Storage path pivots are denied', pivot_denied)

        mismatched = prepare(deal_id, first, 'mismatch.pdf', 'application/pdf', len(pdf1)).json()
        upload('C', mismatched['upload_path'], pdf1, 'image/png')
        check('stored metadata mismatch is rejected with 415', submit(deal_id, first, mismatched).status_code == 415)
        clients['C'].storage.from_('content-drafts').remove([mismatched['upload_path']])

        spoofed_bytes = b'not really a pdf' * 100
        spoofed = prepare(deal_id, first, 'spoof.pdf', 'application/pdf', len(spoofed_bytes)).json()
        upload('C', spoofed['upload_path'], spoofed_bytes, 'application/pdf')
        check('file signature is checked instead of trusting extension or MIME metadata',
              submit(deal_id, first, spoofed).status_code == 415)
        clients['C'].storage.from_('content-drafts').remove([spoofed['upload_path']])

        prepared_a = prepare(deal_id, first, 'round-one-a.pdf', 'application/pdf', len(pdf1)).json()
        prepared_b = prepare(deal_id, first, 'round-one-b.pdf', 'application/pdf', len(pdf1)).json()
        upload('C', prepared_a['upload_path'], pdf1, 'application/pdf')
        upload('C', prepared_b['upload_path'], pdf1, 'application/pdf')
        with ThreadPoolExecutor(max_workers=2) as pool:
            raced = list(pool.map(lambda prepared: submit(deal_id, first, prepared), [prepared_a, prepared_b]))
        revision_rows = admin.table('revisions').select('*').eq('deliverable_id', first).execute().data
        first_revision = revision_rows[0]
        check('concurrent submissions create one immutable round and one winner',
              sorted(response.status_code for response in raced) == [200, 409]
              and len(revision_rows) == 1 and first_revision['round_number'] == 1
              and first_revision['lifecycle'] == 'awaiting_review'
              and first_revision['submitted_by'] == ids['C'])
        winning = prepared_a if raced[0].status_code == 200 else prepared_b
        retry = submit(deal_id, first, winning)
        check('retrying the bound reservation is idempotent without another audit',
              retry.status_code == 200 and retry.json()['idempotent'] is True
              and len(admin.table('audit_log').select('id').eq('entity_id', first).eq('action', 'content_draft_submitted').execute().data) == 1)

        participant_states = [call('GET', f'/deals/{deal_id}/deliverables', actor) for actor in ('C', 'B', 'K')]
        safe_text = str(participant_states[0].json()).lower()
        check('participants share stable history without internal object paths',
              all(response.status_code == 200 for response in participant_states)
              and all(
                  response.json()['deliverables'][0]['submission_history']
                  == participant_states[0].json()['deliverables'][0]['submission_history']
                  for response in participant_states[1:]
              )
              and 'content-drafts' not in safe_text and 'submitted_content_url' not in safe_text
              and first_revision['submitted_content_url'] not in safe_text)
        raw_select_denied = True
        for actor in ('C', 'B', 'K'):
            try:
                clients[actor].table('revisions').select('*').eq('deliverable_id', first).execute()
                raw_select_denied = False
            except Exception:
                pass
        check('real participant JWTs cannot select raw revision rows or object paths', raw_select_denied)
        c_first = participant_states[0].json()['deliverables'][0]
        b_first = participant_states[1].json()['deliverables'][0]
        k_first = participant_states[2].json()['deliverables'][0]
        check('creator, brand reviewer, and checker receive exact action permissions',
              not c_first['available_actions']['can_submit_content']
              and b_first['available_actions']['can_request_revision']
              and b_first['available_actions']['can_approve_content']
              and not k_first['available_actions']['can_request_revision']
              and not c_first['available_actions']['can_approve_content']
              and not k_first['available_actions']['can_approve_content'])

        revision_id = first_revision['id']
        download = call('GET', f'/deals/{deal_id}/deliverables/{first}/content/{revision_id}/download', 'K')
        outsider_download = call('GET', f'/deals/{deal_id}/deliverables/{first}/content/{revision_id}/download', 'O')
        wrong_download = call('GET', f'/deals/{deal_id}/deliverables/{second}/content/{revision_id}/download', 'B')
        check('signed download is participant-authorized and bound to the exact deliverable',
              download.status_code == 200 and download.json()['url'].startswith('http')
              and outsider_download.status_code == 403 and wrong_download.status_code == 404
              and first_revision['submitted_content_url'] not in str(download.json()))
        check('private signed URL resolves while direct participant listing stays unavailable',
              api.get(download.json()['url']).status_code == 200
              and clients['B'].storage.from_('content-drafts').list(f'{deal_id}/{first}').__len__() == 0)

        direct_insert = direct_update = direct_delete = False
        try:
            clients['B'].table('revisions').insert({
                'deliverable_id': first, 'round_number': 9,
                'submitted_content_url': 'forged', 'decision': 'approved',
            }).execute()
        except Exception:
            direct_insert = True
        try:
            clients['B'].table('revisions').update({'decision': 'approved'}).eq('id', revision_id).execute()
        except Exception:
            direct_update = True
        try:
            clients['C'].table('revisions').delete().eq('id', revision_id).execute()
        except Exception:
            direct_delete = True
        check('authenticated direct revision INSERT, UPDATE, and DELETE are denied', direct_insert and direct_update and direct_delete)
        check('bound content object cannot be overwritten or deleted by the creator', _bound_object_denied(clients['C'], first_revision['submitted_content_url'], pdf2))

        blank = call('POST', f'/deals/{deal_id}/deliverables/{first}/content/request-revision', 'B', {
            'revision_id': revision_id, 'comment': ' ',
        })
        creator_review = call('POST', f'/deals/{deal_id}/deliverables/{first}/content/request-revision', 'C', {
            'revision_id': revision_id, 'comment': 'Please revise this.',
        })
        checker_review = call('POST', f'/deals/{deal_id}/deliverables/{first}/content/request-revision', 'K', {
            'revision_id': revision_id, 'comment': 'Please revise this.',
        })
        check('revision explanation is required and non-reviewer roles are denied',
              blank.status_code == 422 and creator_review.status_code == 403 and checker_review.status_code == 403)

        revision_payload = {'revision_id': revision_id, 'comment': 'Please tighten the opening and retain the agreed disclosure.'}
        with ThreadPoolExecutor(max_workers=2) as pool:
            decisions = list(pool.map(lambda _: call(
                'POST', f'/deals/{deal_id}/deliverables/{first}/content/request-revision', 'B', revision_payload
            ), range(2)))
        decided = admin.table('revisions').select('*').eq('id', revision_id).execute().data[0]
        first_after_revision = call('GET', f'/deals/{deal_id}/deliverables', 'C').json()['deliverables'][0]
        check('concurrent identical revision requests decide once without incrementing the round',
              all(response.status_code == 200 for response in decisions)
              and {response.json()['idempotent'] for response in decisions} == {False, True}
              and decided['lifecycle'] == 'revision_requested'
              and decided['round_number'] == 1
              and first_after_revision['revision_current'] == 1
              and first_after_revision['status'] == 'in_revision'
              and first_after_revision['available_actions']['can_submit_content'])
        check('the required explanation is visible and exactly one decision audit exists',
              first_after_revision['current_submission']['comment'] == revision_payload['comment']
              and len(admin.table('audit_log').select('id').eq('entity_id', first).eq('action', 'content_revision_requested').execute().data) == 1)

        round_two = prepare(deal_id, first, 'round-two.pdf', 'application/pdf', len(pdf2)).json()
        upload('C', round_two['upload_path'], pdf2, 'application/pdf')
        submitted_two = submit(deal_id, first, round_two)
        second_revision = admin.table('revisions').select('*').eq('deliverable_id', first).eq('round_number', 2).execute().data[0]
        check('creator submits the next append-only round without mutating round one',
              submitted_two.status_code == 200 and second_revision['lifecycle'] == 'awaiting_review'
              and admin.table('revisions').select('comment,lifecycle').eq('id', revision_id).execute().data[0]
              == {'comment': revision_payload['comment'], 'lifecycle': 'revision_requested'})

        exhausted = call('POST', f'/deals/{deal_id}/deliverables/{first}/content/request-revision', 'M', {
            'revision_id': second_revision['id'], 'comment': 'The final contracted round still needs the agreed ending card.',
        })
        exhausted_deal = admin.table('deals').select('stage').eq('id', deal_id).execute().data[0]
        exhausted_row = admin.table('deliverables').select('*').eq('id', first).execute().data[0]
        check('exhaustion pauses for ops while the deal remains Creating with no dispute or cancellation',
              exhausted.status_code == 200 and exhausted.json()['ops_attention'] is True
              and exhausted_deal['stage'] == 'creating' and exhausted_row['status'] == 'in_revision'
              and exhausted_row['content_ops_attention'] is True
              and exhausted_row['content_ops_reason'] == 'revision_rounds_exhausted'
              and prepare(deal_id, first, 'round-three.pdf', 'application/pdf', len(pdf1)).status_code == 409)
        exhaustion_audits = admin.table('audit_log').select('action,metadata').eq('entity_id', first).eq(
            'action', 'content_revision_rounds_exhausted'
        ).execute().data
        check('exhaustion records one metadata-only audit and no Payment dispute',
              len(exhaustion_audits) == 1
              and set(exhaustion_audits[0]['metadata']) == {'deal_id', 'deliverable_id', 'round_number', 'reason'}
              and admin.table('disputes').select('id').eq('deal_id', deal_id).execute().data == [])

        second_ready = prepare(deal_id, second, 'second-deliverable.pdf', 'application/pdf', len(pdf1))
        check('one exhausted deliverable does not corrupt another deliverable lifecycle',
              second_ready.status_code == 200 and second_ready.json()['round_number'] == 1)

        service_insert = service_update = service_delete = False
        try:
            admin.table('revisions').insert({
                'deliverable_id': second, 'round_number': 9,
                'submitted_content_url': 'forged', 'lifecycle': 'approved', 'decision': 'approved',
            }).execute()
        except Exception:
            service_insert = True
        try:
            admin.table('revisions').update({'comment': 'forged'}).eq('id', revision_id).execute()
        except Exception:
            service_update = True
        try:
            admin.table('revisions').delete().eq('id', revision_id).execute()
        except Exception:
            service_delete = True
        check('ordinary service client cannot bypass backend-only revision RPCs',
              service_insert and service_update and service_delete)
    finally:
        cleanup()

    failures = [label for label, ok in checks if not ok]
    print(f'\n{len(checks) - len(failures)}/{len(checks)} content-flow checks passed')
    if failures:
        raise SystemExit('Failed: ' + '; '.join(failures))


def _bound_object_denied(client: Client, path: str, replacement: bytes) -> bool:
    overwrite_denied = delete_denied = False
    try:
        client.storage.from_('content-drafts').upload(
            path, replacement, file_options={'content-type': 'application/pdf', 'upsert': 'true'}
        )
    except Exception:
        overwrite_denied = True
    try:
        result = client.storage.from_('content-drafts').remove([path])
        delete_denied = not result
    except Exception:
        delete_denied = True
    return overwrite_denied and delete_denied


if __name__ == '__main__':
    main()
