import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_TRACKER_FILTERS, TrackerContextFence, filterTrackerDeals, parseDealTrackerSnapshot,
  sortTrackerDeals, trackerIoRatio,
} from '../src/lib/tracker-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, overrides = {}) => ({
  id: id(n), name: `Deal ${n}`, status: 'green', reason_code: 'on_track', reason_label: 'On track',
  relevant_at: null, next_deadline: null, stage: 'chatting', deal_type: 'campaign',
  direction: n % 2 ? 'inbound' : 'outbound', created_at: `2026-09-${String(n).padStart(2, '0')}T00:00:00Z`,
  ...overrides,
});
const payload = (deals) => ({
  version: 1, as_of: '2026-09-24T12:00:00Z',
  summary: {
    active_deals: deals.length, action_needed: deals.filter((deal) => deal.status === 'red').length,
    payments_due_this_week: 2, next_deadline: '2026-09-25', overdue_deliverables: 1,
    inbound_deals: deals.filter((deal) => deal.direction === 'inbound').length,
    outbound_deals: deals.filter((deal) => deal.direction === 'outbound').length,
  },
  deals,
});

test('strict parser accepts the bounded v1 contract and maps every field', () => {
  const parsed = parseDealTrackerSnapshot(payload([row(1, {
    status: 'red', reason_code: 'payment_overdue', reason_label: 'Payment overdue',
    relevant_at: '2026-09-20T00:00:00Z', next_deadline: '2026-09-25', stage: 'payment',
  })]));
  assert.equal(parsed.deals[0].reasonCode, 'payment_overdue');
  assert.equal(parsed.summary.activeDeals, 1);
});

test('parser rejects extra keys, oversized arrays, invalid values, and inconsistent counts', () => {
  const extra = payload([row(1)]); extra.secret = 'must never pass';
  assert.throws(() => parseDealTrackerSnapshot(extra));
  assert.throws(() => parseDealTrackerSnapshot(payload([row(1, { name: 'x'.repeat(161) })])));
  assert.throws(() => parseDealTrackerSnapshot(payload([row(1, { next_deadline: '2026-02-30' })])));
  assert.throws(() => parseDealTrackerSnapshot(payload([row(1), row(1)])));
  assert.throws(() => parseDealTrackerSnapshot(payload(Array.from({ length: 501 }, (_, index) => row((index % 28) + 1)))));
  const mismatch = payload([row(1)]); mismatch.summary.action_needed = 1;
  assert.throws(() => parseDealTrackerSnapshot(mismatch));
});

test('sort is red-first, deadline-first, then stable name and id', () => {
  const parsed = parseDealTrackerSnapshot(payload([
    row(1, { name: 'Zulu', status: 'green' }),
    row(2, { name: 'Beta', status: 'red', reason_code: 'needs_attention', reason_label: 'Needs attention' }),
    row(3, { name: 'Alpha', status: 'red', reason_code: 'needs_attention', reason_label: 'Needs attention', next_deadline: '2026-09-28' }),
    row(4, { name: 'Amber', status: 'amber', reason_code: 'confirmation_waiting', reason_label: 'Waiting for confirmation' }),
  ]));
  assert.deepEqual(sortTrackerDeals(parsed.deals).map((deal) => deal.id), [id(3), id(2), id(4), id(1)]);
});

test('all status, stage, type, direction and inclusive created-date filters compose', () => {
  const parsed = parseDealTrackerSnapshot(payload([
    row(1, { status: 'red', reason_code: 'needs_attention', reason_label: 'Needs attention', stage: 'payment', deal_type: 'product', direction: 'inbound' }),
    row(2, { status: 'green', stage: 'creating', deal_type: 'campaign', direction: 'outbound' }),
  ]));
  const filters = { ...EMPTY_TRACKER_FILTERS, status: 'red', stage: 'payment', dealType: 'product', direction: 'inbound', createdFrom: '2026-09-01', createdTo: '2026-09-01' };
  assert.deepEqual(filterTrackerDeals(parsed.deals, filters).map((deal) => deal.id), [id(1)]);
  assert.equal(filterTrackerDeals(parsed.deals, { ...filters, createdFrom: '2026-09-02' }).length, 0);
});

test('I/O ratio is zero-safe', () => {
  const emptyPayload = payload([]);
  emptyPayload.summary = { ...emptyPayload.summary, payments_due_this_week: 0, next_deadline: null, overdue_deliverables: 0 };
  assert.equal(trackerIoRatio(parseDealTrackerSnapshot(emptyPayload)), '0:0');
});

test('context fence rejects prior account, superseded, and invalidated responses', () => {
  const fence = new TrackerContextFence();
  const first = fence.begin('account-a');
  const newer = fence.begin('account-a');
  assert.equal(fence.isCurrent(first), false);
  assert.equal(fence.isCurrent(newer), true);
  fence.switchContext('account-b');
  assert.equal(fence.isCurrent(newer), false);
  const current = fence.begin('account-b');
  fence.invalidate();
  assert.equal(fence.isCurrent(current), false);
});
