import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliverableDetailContextFence, parseDeliverableDetail } from '../src/lib/deliverable-detail-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draft = (overrides = {}) => ({ id: id(2), round_number: 1, lifecycle: 'awaiting_review', original_filename: 'fictional-draft.pdf', mime_type: 'application/pdf', size_bytes: 120, submitted_at: '2026-09-25T12:00:00Z', submitted_by_name: 'Fictional Creator', comment: null, decided_at: null, decided_by_name: null, can_download: true, ...overrides });
const payload = (overrides = {}) => ({ version: 1, as_of: '2026-09-25T12:00:00Z', deal_id: id(1), deliverable: { id: id(3), display_name: 'Deliverable 1', content_format: 'reel', platform: 'instagram', location: 'Fictional studio', posting_date: '2026-10-01', posting_window_start: null, posting_window_end: null, revision_current: 1, revision_max: 2, status: 'submitted', operational_attention: false, current_submission: draft(), submission_history: [draft()], history_truncated: false, approval: null, live_proof: { final_url: 'https://example.test/proof', host: 'example.test', title: 'Fictional proof', verification_status: 'verified', verified_at: '2026-09-25T12:00:00Z', flagged_at: null, confirmed_at: null } }, usage_rights: { present: true, has_usage_rights: true, channels: ['Website'], start_date: '2026-09-20', end_date: '2026-10-15', is_perpetual: false, status: 'expiring' }, allowed_actions: { can_download_drafts: true }, ...overrides });

test('strict parser accepts a bounded safe detail response', () => {
  const parsed = parseDeliverableDetail(payload());
  assert.equal(parsed.deliverable.liveProof?.host, 'example.test');
  assert.equal(parsed.usageRights.status, 'expiring');
});

test('parser rejects leaked fields, mismatched proof and invalid rights combinations', () => {
  assert.throws(() => parseDeliverableDetail({ ...payload(), source_summary: 'private' }));
  assert.throws(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, live_proof: { ...payload().deliverable.live_proof, host: 'redirect.test' } } })));
  assert.throws(() => parseDeliverableDetail(payload({ usage_rights: { ...payload().usage_rights, has_usage_rights: false } })));
});

test('parser rejects impossible revision progress and approval decision timestamps', () => {
  assert.throws(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, revision_current: 3, revision_max: 2 } })));
  const approval = { status: 'pending', maker_name: 'Fictional Maker', checker_name: 'Fictional Checker', round_number: 1, comment: null, created_at: '2026-09-25T12:00:00Z', decided_at: null };
  assert.doesNotThrow(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, approval } })));
  assert.throws(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, approval: { ...approval, decided_at: '2026-09-25T13:00:00Z' } } })));
  assert.throws(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, approval: { ...approval, status: 'approved' } } })));
  assert.doesNotThrow(() => parseDeliverableDetail(payload({ deliverable: { ...payload().deliverable, approval: { ...approval, status: 'rejected', decided_at: '2026-09-25T13:00:00Z' } } })));
});

test('context fencing rejects account, deal, refresh and unmount results', () => {
  const fence = new DeliverableDetailContextFence();
  const first = fence.begin('account-a:deal-a:deliverable-a');
  const changed = fence.begin('account-b:deal-b:deliverable-b');
  assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(changed), true);
  const refresh = fence.begin('account-b:deal-b:deliverable-b');
  assert.equal(fence.isCurrent(changed), false); assert.equal(fence.isCurrent(refresh), true);
  fence.invalidate(); assert.equal(fence.isCurrent(refresh), false);
});
