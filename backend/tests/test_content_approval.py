"""Development-Supabase acceptance checks for exact content approval.

Exercises direct and checker-gated approval through real JWT/FastAPI calls,
including stale payloads, concurrency, role removal, response privacy, and safe
fictional cleanup. Migration 032 must be applied first.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import test_content_flow as fixture


extra_brand_ids: list[str] = []


def create_deal(label: str, participant_roles: list[tuple[str, str]], *, brand: str | None = None) -> str:
    brand_value = brand or fixture.brand_id
    deal_id = fixture.admin.table('deals').insert({
        'creator_id': fixture.ids['C'],
        'brand_id': brand_value,
        'deal_name': f'Fictional approval {label} {fixture.RUN_ID}',
        'direction': 'inbound',
        'created_by': fixture.ids['B'],
        'stage': 'creating',
    }).execute().data[0]['id']
    fixture.admin.table('deal_participants').insert([
        {'deal_id': deal_id, 'profile_id': fixture.ids[key], 'participant_role': role}
        for key, role in participant_roles
    ]).execute()
    summary = fixture.admin.table('ai_summaries').insert({
        'deal_id': deal_id,
        'raw_output': {'source': 'fictional content-approval acceptance fixture'},
        'structured_terms': fixture.terms(count=1, revision_max=3),
        'status': 'approved',
        'schema_version': fixture.SCHEMA_VERSION,
        'prompt_version': fixture.PROMPT_VERSION,
    }).execute().data[0]
    fixture.admin.table('contracts').insert({
        'deal_id': deal_id,
        'version': 1,
        'storage_path': f'{deal_id}/executed-fictional-v1.pdf',
        'generated_from_summary_id': summary['id'],
        'status': 'executed',
        'draft_source_sha256': '0' * 64,
    }).execute()
    fixture.deal_ids.append(deal_id)
    return deal_id


def submit_one(deal_id: str, label: str) -> tuple[str, dict]:
    deliverable_id = fixture.call('GET', f'/deals/{deal_id}/deliverables', 'C').json()['deliverables'][0]['id']
    content = b'%PDF-1.4\n' + f'fictional-{label}\n'.encode() * 80
    prepared = fixture.prepare(
        deal_id, deliverable_id, f'{label}.pdf', 'application/pdf', len(content)
    ).json()
    fixture.upload('C', prepared['upload_path'], content, 'application/pdf')
    submitted = fixture.submit(deal_id, deliverable_id, prepared)
    if submitted.status_code != 200:
        raise RuntimeError(f'Could not create approval fixture: {submitted.status_code} {submitted.text}')
    revision = fixture.admin.table('revisions').select('*').eq(
        'id', submitted.json()['revision_id']
    ).single().execute().data
    return deliverable_id, revision


def approve(deal_id: str, deliverable_id: str, revision_id: str, actor: str = 'M'):
    return fixture.call(
        'POST',
        f'/deals/{deal_id}/deliverables/{deliverable_id}/content/approve',
        actor,
        {'revision_id': revision_id},
    )


def decide(request_id: str, actor: str, decision: str, comment: str | None = None):
    payload = {'decision': decision}
    if comment is not None:
        payload['comment'] = comment
    return fixture.call('POST', f'/maker-checker/requests/{request_id}/decide', actor, payload)


def set_gate(requires_checker: bool) -> None:
    fixture.admin.table('maker_checker_config').upsert({
        'brand_id': fixture.brand_id,
        'action_type': 'content_approval',
        'requires_checker': requires_checker,
    }, on_conflict='brand_id,action_type').execute()


def main() -> None:
    try:
        for key, (email, name, account_type) in fixture.USERS.items():
            fixture.ids[key] = fixture.admin.auth.admin.create_user({
                'email': email, 'password': fixture.PASSWORD, 'email_confirm': True,
            }).user.id
            fixture.admin.table('profiles').insert({
                'id': fixture.ids[key], 'email': email, 'display_name': name,
                'account_type': account_type,
            }).execute()
            fixture.clients[key] = fixture.auth_client(key)
            fixture.tokens[key] = fixture.clients[key].auth.get_session().access_token

        fixture.brand_id = fixture.admin.table('brands').insert({
            'company_name': f'Fictional Approval Studio {fixture.RUN_ID}', 'industry': 'Media',
        }).execute().data[0]['id']
        fixture.admin.table('brand_members').insert([
            {'brand_id': fixture.brand_id, 'profile_id': fixture.ids['B'], 'brand_role': 'admin', 'status': 'active'},
            {'brand_id': fixture.brand_id, 'profile_id': fixture.ids['M'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': fixture.brand_id, 'profile_id': fixture.ids['K'], 'brand_role': 'member', 'status': 'active'},
            {'brand_id': fixture.brand_id, 'profile_id': fixture.ids['O'], 'brand_role': 'member', 'status': 'active'},
        ]).execute()

        # Solo brands have no checker rule and execute the exact approval directly.
        solo_brand = fixture.admin.table('brands').insert({
            'company_name': f'Fictional Solo Brand {fixture.RUN_ID}', 'industry': 'Food',
        }).execute().data[0]['id']
        extra_brand_ids.append(solo_brand)
        fixture.admin.table('brand_members').insert({
            'brand_id': solo_brand, 'profile_id': fixture.ids['B'],
            'brand_role': 'admin', 'status': 'active',
        }).execute()
        solo_deal = create_deal(
            'solo-direct', [('C', 'creator'), ('B', 'brand_admin')], brand=solo_brand,
        )
        solo_deliverable, solo_revision = submit_one(solo_deal, 'solo-round-one')
        with ThreadPoolExecutor(max_workers=2) as pool:
            direct = list(pool.map(
                lambda _: approve(solo_deal, solo_deliverable, solo_revision['id'], 'B'), range(2)
            ))
        solo_row = fixture.admin.table('deliverables').select('*').eq(
            'id', solo_deliverable
        ).single().execute().data
        solo_revision_after = fixture.admin.table('revisions').select('*').eq(
            'id', solo_revision['id']
        ).single().execute().data
        fixture.check(
            'solo/direct approval is atomic and retry-idempotent',
            all(response.status_code == 200 for response in direct)
            and {response.json()['idempotent'] for response in direct} == {False, True}
            and solo_row['status'] == 'approved'
            and solo_row['approved_content_url'] == solo_revision['submitted_content_url']
            and solo_revision_after['lifecycle'] == 'approved'
            and solo_revision_after['decided_by'] == fixture.ids['B'],
        )
        direct_audits = fixture.admin.table('audit_log').select('metadata').eq(
            'entity_id', solo_deliverable
        ).eq('action', 'content_approved_direct').execute().data
        solo_view = fixture.call('GET', f'/deals/{solo_deal}/deliverables', 'C').json()['deliverables'][0]
        fixture.check(
            'direct approval records one metadata-only audit and no posting/stage action',
            len(direct_audits) == 1
            and set(direct_audits[0]['metadata']) == {
                'deal_id', 'deliverable_id', 'revision_id', 'round_number', 'requires_checker'
            }
            and solo_view['status'] == 'approved'
            and not solo_view['available_actions']['can_submit_live_url']
            and fixture.admin.table('deals').select('stage').eq('id', solo_deal).single().execute().data['stage'] == 'creating'
            and solo_row['live_post_url'] is None,
        )
        path_select_denied = star_select_denied = False
        try:
            fixture.clients['B'].table('deliverables').select(
                'id,approved_content_url'
            ).eq('id', solo_deliverable).execute()
        except Exception:
            path_select_denied = True
        try:
            fixture.clients['B'].table('deliverables').select('*').eq(
                'id', solo_deliverable
            ).execute()
        except Exception:
            star_select_denied = True
        safe_deliverable = fixture.clients['B'].table('deliverables').select(
            'id,status'
        ).eq('id', solo_deliverable).single().execute().data
        fixture.check(
            'real participant JWT cannot select the approved object path or wildcard row',
            path_select_denied and star_select_denied
            and safe_deliverable == {'id': solo_deliverable, 'status': 'approved'}
            and solo_revision['submitted_content_url'] not in str([response.json() for response in direct]),
        )

        set_gate(True)
        held_deal = fixture.make_deal('checker-held', count=1, revision_max=3)
        held_deliverable, held_revision = submit_one(held_deal, 'held-round-one')
        with ThreadPoolExecutor(max_workers=2) as pool:
            held_calls = list(pool.map(
                lambda _: approve(held_deal, held_deliverable, held_revision['id'], 'M'), range(2)
            ))
        if not all(response.status_code == 200 for response in held_calls):
            raise RuntimeError(
                'Checker hold fixture failed: '
                + repr([(response.status_code, response.text) for response in held_calls])
            )
        held_payloads = [response.json() for response in held_calls]
        request_id = held_payloads[0]['request_id']
        fixture.check(
            'configured approval creates one exact-submission hold and retries reuse it',
            all(response.status_code == 200 for response in held_calls)
            and {payload['idempotent'] for payload in held_payloads} == {False, True}
            and len({payload['request_id'] for payload in held_payloads}) == 1
            and fixture.admin.table('maker_checker_requests').select('id').eq(
                'deal_id', held_deal
            ).eq('action_type', 'content_approval').eq('status', 'pending').execute().data.__len__() == 1,
        )
        competing = approve(held_deal, held_deliverable, held_revision['id'], 'B')
        generic = fixture.call('POST', '/maker-checker/initiate', 'M', {
            'deal_id': held_deal, 'action_type': 'content_approval',
        })
        fixture.check(
            'a different maker cannot replace the live hold and generic initiation is closed',
            competing.status_code == 409 and generic.status_code == 409,
        )

        participant_views = {
            actor: fixture.call('GET', f'/deals/{held_deal}/deliverables', actor)
            for actor in ('C', 'B', 'M', 'K')
        }
        safe_text = str({actor: response.json() for actor, response in participant_views.items()}).lower()
        held_view = participant_views['C'].json()['deliverables'][0]['content_approval']
        checker_view = participant_views['K'].json()['deliverables'][0]
        fixture.check(
            'held state exposes safe maker/checker/round identity with checker-only actions',
            all(response.status_code == 200 for response in participant_views.values())
            and held_view['status'] == 'pending'
            and held_view['maker_name'] == fixture.USERS['M'][1]
            and held_view['round_number'] == 1
            and checker_view['content_approval']['can_decide']
            and not participant_views['C'].json()['deliverables'][0]['content_approval']['can_decide']
            and not participant_views['M'].json()['deliverables'][0]['available_actions']['can_approve_content'],
        )
        fixture.check(
            'participant responses hide held payloads, paths, IPs, and audit internals',
            'action_payload' not in safe_text
            and 'submitted_object_path' not in safe_text
            and 'maker_ip_address' not in safe_text
            and held_revision['submitted_content_url'].lower() not in safe_text
            and 'audit_log' not in safe_text,
        )

        fixture.check(
            'maker, creator, outsider, and wrong checker cannot decide the hold',
            decide(request_id, 'M', 'approve').status_code == 403
            and decide(request_id, 'C', 'approve').status_code == 403
            and decide(request_id, 'O', 'approve').status_code == 403
            and fixture.admin.table('maker_checker_requests').select('status').eq(
                'id', request_id
            ).single().execute().data['status'] == 'pending',
        )

        direct_rpc_denied = direct_request_write_denied = private_payload_denied = False
        try:
            fixture.clients['M'].rpc('approve_content_submission', {
                'p_deal_id': held_deal, 'p_deliverable_id': held_deliverable,
                'p_revision_id': held_revision['id'], 'p_actor_id': fixture.ids['M'],
                'p_ip_address': 'forged',
            }).execute()
        except Exception:
            direct_rpc_denied = True
        try:
            fixture.clients['K'].table('maker_checker_requests').update({
                'status': 'approved'
            }).eq('id', request_id).execute()
        except Exception:
            direct_request_write_denied = True
        try:
            fixture.clients['K'].table('held_content_approval_payloads').select('*').execute()
        except Exception:
            private_payload_denied = True
        fixture.check(
            'authenticated direct RPC/request writes and private payload reads are denied',
            direct_rpc_denied and direct_request_write_denied and private_payload_denied,
        )

        # The held snapshot survives a later config change. Decision still rechecks
        # the assigned checker and the exact active submission.
        set_gate(False)
        held_after_disable = approve(held_deal, held_deliverable, held_revision['id'], 'M')
        held_after_disable_row = fixture.admin.table('deliverables').select(
            'status,approved_content_url'
        ).eq('id', held_deliverable).single().execute().data
        held_after_disable_revision = fixture.admin.table('revisions').select(
            'lifecycle'
        ).eq('id', held_revision['id']).single().execute().data
        fixture.check(
            'an existing exact hold wins before disabled config can select the direct path',
            held_after_disable.status_code == 200
            and held_after_disable.json()['status'] == 'held'
            and held_after_disable.json()['idempotent'] is True
            and held_after_disable.json()['request_id'] == request_id
            and held_after_disable_row == {'status': 'submitted', 'approved_content_url': None}
            and held_after_disable_revision['lifecycle'] == 'awaiting_review'
            and fixture.admin.table('maker_checker_requests').select('status').eq(
                'id', request_id
            ).single().execute().data['status'] == 'pending',
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            decisions = list(pool.map(lambda _: decide(request_id, 'K', 'approve'), range(2)))
        released = fixture.admin.table('deliverables').select('*').eq(
            'id', held_deliverable
        ).single().execute().data
        released_revision = fixture.admin.table('revisions').select('*').eq(
            'id', held_revision['id']
        ).single().execute().data
        fixture.check(
            'snapshot-held concurrent decisions produce one terminal approval',
            sorted(response.status_code for response in decisions) == [200, 409]
            and released['status'] == 'approved'
            and released['approved_content_url'] == held_revision['submitted_content_url']
            and released_revision['lifecycle'] == 'approved'
            and released_revision['decided_by'] == fixture.ids['M'],
        )
        request_audits = fixture.admin.table('audit_log').select('action,metadata').eq(
            'entity_id', request_id
        ).execute().data
        fixture.check(
            'maker initiation and checker release retain separate metadata-only provenance',
            [row['action'] for row in request_audits].count('maker_checker.request_created') == 1
            and [row['action'] for row in request_audits].count('maker_checker.approved') == 1
            and all('submitted_object_path' not in row['metadata'] for row in request_audits),
        )
        released_retry = approve(held_deal, held_deliverable, held_revision['id'], 'M')
        fixture.check(
            'maker retry after checker release is idempotent and preserves held provenance',
            released_retry.status_code == 200
            and released_retry.json()['idempotent'] is True
            and released_retry.json()['requires_checker'] is True
            and released_retry.json()['request_id'] == request_id,
        )

        # A held action becomes non-executable as soon as revision lifecycle moves.
        set_gate(True)
        stale_deal = fixture.make_deal('stale-held', count=1, revision_max=3)
        stale_deliverable, stale_revision = submit_one(stale_deal, 'stale-round-one')
        stale_hold = approve(stale_deal, stale_deliverable, stale_revision['id'], 'M').json()
        revision_request = fixture.call(
            'POST', f'/deals/{stale_deal}/deliverables/{stale_deliverable}/content/request-revision', 'B',
            {'revision_id': stale_revision['id'], 'comment': 'Please revise the fictional opening.'},
        )
        new_deliverable, new_revision = submit_one(stale_deal, 'stale-round-two')
        stale_decision = decide(stale_hold['request_id'], 'K', 'approve')
        fresh_hold = approve(stale_deal, new_deliverable, new_revision['id'], 'M')
        fixture.check(
            'revision request/resubmission makes the older held payload stale and non-executable',
            revision_request.status_code == 200
            and stale_decision.status_code == 409
            and fresh_hold.status_code == 200
            and fresh_hold.json()['status'] == 'held'
            and fresh_hold.json()['request_id'] != stale_hold['request_id']
            and fixture.admin.table('revisions').select('lifecycle').eq(
                'id', new_revision['id']
            ).single().execute().data['lifecycle'] == 'awaiting_review',
        )

        missing_deal = create_deal(
            'missing-checker',
            [('C', 'creator'), ('B', 'brand_admin'), ('M', 'brand_maker')],
        )
        missing_deliverable, missing_revision = submit_one(missing_deal, 'missing-checker')
        fixture.check(
            'configured approval fails closed when no active checker is assigned',
            approve(missing_deal, missing_deliverable, missing_revision['id'], 'M').status_code == 409,
        )

        reassigned_deal = fixture.make_deal('reassigned-checker', count=1, revision_max=3)
        reassigned_deliverable, reassigned_revision = submit_one(reassigned_deal, 'reassigned')
        reassigned_hold = approve(
            reassigned_deal, reassigned_deliverable, reassigned_revision['id'], 'M'
        ).json()
        fixture.admin.table('deal_participants').update({
            'participant_role': 'brand_maker'
        }).eq('deal_id', reassigned_deal).eq('profile_id', fixture.ids['K']).execute()
        fixture.admin.table('deal_participants').insert({
            'deal_id': reassigned_deal, 'profile_id': fixture.ids['O'],
            'participant_role': 'brand_checker',
        }).execute()
        fixture.check(
            'removed/reassigned checker roles cannot release an existing request',
            decide(reassigned_hold['request_id'], 'K', 'approve').status_code == 403
            and decide(reassigned_hold['request_id'], 'O', 'approve').status_code == 403,
        )

        reject_deal = fixture.make_deal('checker-reject', count=1, revision_max=3)
        reject_deliverable, reject_revision = submit_one(reject_deal, 'reject-round-one')
        reject_hold = approve(reject_deal, reject_deliverable, reject_revision['id'], 'M').json()
        invalid_reject = decide(reject_hold['request_id'], 'K', 'reject', ' ')
        valid_reject = decide(
            reject_hold['request_id'], 'K', 'reject',
            'The maker approval needs another internal brand review.',
        )
        rejected_row = fixture.admin.table('deliverables').select('*').eq(
            'id', reject_deliverable
        ).single().execute().data
        rejected_revision = fixture.admin.table('revisions').select('*').eq(
            'id', reject_revision['id']
        ).single().execute().data
        creator_rejected = fixture.call('GET', f'/deals/{reject_deal}/deliverables', 'C').json()['deliverables'][0]
        maker_rejected = fixture.call('GET', f'/deals/{reject_deal}/deliverables', 'B').json()['deliverables'][0]
        fixture.check(
            'checker rejection requires an explanation and changes only the held request',
            invalid_reject.status_code == 422 and valid_reject.status_code == 200
            and rejected_row['status'] == 'submitted'
            and rejected_row['revision_current'] == 1
            and not rejected_row['content_ops_attention']
            and rejected_revision['lifecycle'] == 'awaiting_review'
            and rejected_revision['decision'] is None
            and rejected_row['approved_content_url'] is None,
        )
        fixture.check(
            'rejection is visible while creator stays read-only and maker choices reopen',
            creator_rejected['content_approval']['status'] == 'rejected'
            and creator_rejected['content_approval']['comment'] == 'The maker approval needs another internal brand review.'
            and not creator_rejected['available_actions']['can_submit_content']
            and not creator_rejected['available_actions']['can_approve_content']
            and maker_rejected['available_actions']['can_request_revision']
            and maker_rejected['available_actions']['can_approve_content'],
        )
        fresh_after_reject = approve(reject_deal, reject_deliverable, reject_revision['id'], 'B')
        fixture.check(
            'eligible maker/admin can initiate a fresh approval after checker rejection',
            fresh_after_reject.status_code == 200
            and fresh_after_reject.json()['status'] == 'held'
            and fresh_after_reject.json()['request_id'] != reject_hold['request_id'],
        )

        wrong_deliverable = approve(
            reject_deal, stale_deliverable, reject_revision['id'], 'B'
        )
        fixture.check(
            'wrong-deal/deliverable approval identity is rejected without mutation',
            wrong_deliverable.status_code in {404, 409}
            and fixture.admin.table('revisions').select('lifecycle').eq(
                'id', reject_revision['id']
            ).single().execute().data['lifecycle'] == 'awaiting_review',
        )
    finally:
        for deal_id in fixture.deal_ids:
            try:
                fixture.admin.table('deals').delete().eq('id', deal_id).execute()
            except Exception:
                pass
        for brand in extra_brand_ids:
            try:
                fixture.admin.table('brands').delete().eq('id', brand).execute()
            except Exception:
                pass
        fixture.cleanup()

    failures = [label for label, ok in fixture.checks if not ok]
    print(f'\n{len(fixture.checks) - len(failures)}/{len(fixture.checks)} content-approval checks passed')
    if failures:
        raise SystemExit('Failed: ' + '; '.join(failures))


if __name__ == '__main__':
    main()
