import assert from 'node:assert/strict';
import test from 'node:test';

import { ExclusivityContextFence, parseExclusivitySnapshot } from '../src/lib/exclusivity-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n = 1, overrides = {}) => ({
  deal_id: id(n), deal_name: `Fictional Deal ${n}`, brand_name: `Fictional Brand ${n}`,
  creator_name: `Fictional Creator ${n}`, category: 'Fictional skincare', start_date: '2028-02-27',
  end_date: '2028-03-15', status: 'active', deal_path: `/deal/${id(n)}`, ...overrides,
});
const payload = (overrides = {}) => ({
  version: 1, as_of: '2028-02-29T12:00:00Z', integrity_unavailable_count: 0, clauses: [row()], ...overrides,
});

test('strict parser accepts active, first-expiring, expiry-day, expired, and integrity states', () => {
  assert.equal(parseExclusivitySnapshot(payload()).clauses[0].status, 'active');
  assert.equal(parseExclusivitySnapshot(payload({ clauses: [row(1, { end_date: '2028-03-14', status: 'expiring' })] })).clauses[0].status, 'expiring');
  assert.equal(parseExclusivitySnapshot(payload({ clauses: [row(1, { end_date: '2028-02-29', status: 'expiring' })] })).clauses[0].status, 'expiring');
  assert.equal(parseExclusivitySnapshot(payload({ clauses: [row(1, { end_date: '2028-02-28', status: 'expired' })] })).clauses[0].status, 'expired');
  assert.equal(parseExclusivitySnapshot(payload({ clauses: [], integrity_unavailable_count: 2 })).integrityUnavailableCount, 2);
});

test('strict parser rejects unknown keys, unsafe values, impossible status, duplicates, and overflow', () => {
  assert.throws(() => parseExclusivitySnapshot({ ...payload(), secret: true }));
  assert.throws(() => parseExclusivitySnapshot(payload({ as_of: '2026-02-29T12:00:00Z' })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [row(1, { deal_path: 'https://unsafe.example' })] })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [row(1, { category: 'bad\nvalue' })] })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [row(1, { start_date: '2028-03-16' })] })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [row(1, { status: 'expiring' })] })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [row(), row()] })));
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: Array.from({ length: 101 }, (_, index) => row(index + 1)) })));
});

test('parser requires exact deterministic Expiring, Active, Expired ordering', () => {
  const expiring = row(1, { end_date: '2028-03-10', status: 'expiring' });
  const active = row(2, { end_date: '2028-03-20', status: 'active' });
  const expired = row(3, { start_date: '2028-02-01', end_date: '2028-02-20', status: 'expired' });
  assert.deepEqual(parseExclusivitySnapshot(payload({ clauses: [expiring, active, expired] })).clauses.map((item) => item.status), ['expiring', 'active', 'expired']);
  assert.throws(() => parseExclusivitySnapshot(payload({ clauses: [active, expiring, expired] })));
});

test('context fence rejects stale account, superseded response, and unmounted request', () => {
  const fence = new ExclusivityContextFence(); const first = fence.begin('account-a'); const second = fence.begin('account-a');
  assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(second), true);
  fence.switchContext('account-b'); assert.equal(fence.isCurrent(second), false);
  const current = fence.begin('account-b'); fence.invalidate(); assert.equal(fence.isCurrent(current), false);
});
