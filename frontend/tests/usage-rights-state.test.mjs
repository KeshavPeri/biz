import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUsageRightsSnapshot, UsageRightsContextFence } from '../src/lib/usage-rights-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n = 1, overrides = {}) => ({
  deal_id: id(n), deal_name: `Fictional Deal ${n}`, counterparty_name: `Fictional Counterparty ${n}`,
  direction: 'inbound', stage: 'closed', rights_presence: 'present', channels: ['Fictional web'],
  start_date: '2028-02-27', end_date: '2028-03-02', is_perpetual: false, status: 'expiring', deal_path: `/deal/${id(n)}`,
  ...overrides,
});
const payload = (overrides = {}) => ({ version: 1, as_of: '2028-02-29T12:00:00Z', deals: [row()], ...overrides });

test('strict parser accepts canonical finite, none, perpetual, expired, and unavailable facts', () => {
  assert.equal(parseUsageRightsSnapshot(payload()).deals[0].endDate, '2028-03-02');
  assert.equal(parseUsageRightsSnapshot(payload({ deals: [row(1, { rights_presence: 'none', channels: [], start_date: null, end_date: null, is_perpetual: false, status: 'none' })] })).deals[0].status, 'none');
  assert.equal(parseUsageRightsSnapshot(payload({ deals: [row(1, { is_perpetual: true, end_date: null, status: 'perpetual' })] })).deals[0].status, 'perpetual');
  assert.equal(parseUsageRightsSnapshot(payload({ deals: [row(1, { status: 'expired' })] })).deals[0].status, 'expired');
  assert.equal(parseUsageRightsSnapshot(payload({ deals: [row(1, { rights_presence: 'unavailable', channels: [], start_date: null, end_date: null, is_perpetual: false, status: 'unavailable' })] })).deals[0].status, 'unavailable');
});

test('strict parser rejects unknown keys, unsafe paths, duplicates, impossible facts, and overflow', () => {
  assert.throws(() => parseUsageRightsSnapshot({ ...payload(), secret: true }));
  assert.throws(() => parseUsageRightsSnapshot(payload({ as_of: '2026-02-29T12:00:00Z' })));
  assert.throws(() => parseUsageRightsSnapshot(payload({ deals: [row(1, { deal_path: 'https://unsafe.example' })] })));
  assert.throws(() => parseUsageRightsSnapshot(payload({ deals: [row(), row()] })));
  assert.throws(() => parseUsageRightsSnapshot(payload({ deals: [row(1, { channels: ['same', 'same'] })] })));
  assert.throws(() => parseUsageRightsSnapshot(payload({ deals: [row(1, { is_perpetual: true, end_date: '2028-03-02', status: 'perpetual' })] })));
  assert.throws(() => parseUsageRightsSnapshot(payload({ deals: Array.from({ length: 101 }, (_, index) => row(index + 1)) })));
});

test('parser preserves valid server ordering for Unicode case-fold differences', () => {
  const ligature = row(1, { deal_name: 'ﬀ' });
  const plain = row(2, { deal_name: 'g' });
  assert.deepEqual(parseUsageRightsSnapshot(payload({ deals: [ligature, plain] })).deals.map((item) => item.dealName), ['ﬀ', 'g']);
});

test('context fence rejects a stale account, superseded response, and unmounted request', () => {
  const fence = new UsageRightsContextFence(); const first = fence.begin('account-a'); const second = fence.begin('account-a');
  assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(second), true);
  fence.switchContext('account-b'); assert.equal(fence.isCurrent(second), false);
  const current = fence.begin('account-b'); fence.invalidate(); assert.equal(fence.isCurrent(current), false);
});
