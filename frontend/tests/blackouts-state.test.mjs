import assert from 'node:assert/strict';
import test from 'node:test';
import { BlackoutContextFence, parseBlackoutSnapshot } from '../src/lib/blackouts-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n = 1, overrides = {}) => ({ id: `blackout:${id(n)}:2028-02-29:2028-03-01`, deal_id: id(n), deal_name: `Fictional Deal ${n}`, brand_name: `Fictional Brand ${n}`, timing: 'both', duration_days: 2, start_date: '2028-02-29', end_date: '2028-03-01', status: 'active', deal_path: `/deal/${id(n)}`, ...overrides });
const payload = (overrides = {}) => ({ version: 1, as_of: '2028-02-29T12:00:00Z', integrity_unavailable_count: 0, ranges: [row()], ...overrides });

test('strict parser accepts active, upcoming, multiple ranges, and integrity state', () => {
  assert.equal(parseBlackoutSnapshot(payload()).ranges[0].status, 'active');
  const upcoming = row(2, { id: `blackout:${id(2)}:2028-03-04:2028-03-05`, start_date: '2028-03-04', end_date: '2028-03-05', status: 'upcoming' });
  assert.deepEqual(parseBlackoutSnapshot(payload({ ranges: [row(), upcoming], integrity_unavailable_count: 1 })).ranges.map((item) => item.status), ['active', 'upcoming']);
});
test('strict parser rejects unknown, unsafe, invalid, duplicate, unordered, and oversized data', () => {
  assert.throws(() => parseBlackoutSnapshot({ ...payload(), source: 'private' }));
  assert.throws(() => parseBlackoutSnapshot(payload({ ranges: [row(1, { deal_path: 'https://unsafe.example' })] })));
  assert.throws(() => parseBlackoutSnapshot(payload({ ranges: [row(1, { deal_name: 'bad\nname' })] })));
  assert.throws(() => parseBlackoutSnapshot(payload({ ranges: [row(1, { status: 'upcoming' })] })));
  assert.throws(() => parseBlackoutSnapshot(payload({ ranges: [row(), row()] })));
  assert.throws(() => parseBlackoutSnapshot(payload({ ranges: Array.from({ length: 501 }, (_, index) => row(index + 1)) })));
});
test('context fence rejects stale account, superseded request, and unmounted result', () => { const fence = new BlackoutContextFence(); const first = fence.begin('one'); const next = fence.begin('one'); assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(next), true); fence.switchContext('two'); assert.equal(fence.isCurrent(next), false); const current = fence.begin('two'); fence.invalidate(); assert.equal(fence.isCurrent(current), false); });
