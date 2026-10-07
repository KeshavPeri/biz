import assert from 'node:assert/strict';
import test from 'node:test';

import { WhitelistingContextFence, parseWhitelistingSnapshot } from '../src/lib/whitelisting-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const arrangement = (overrides = {}) => ({
  platform: 'instagram', account_label: 'Fictional Studio Account', start_date: '2028-02-20',
  end_date: '2028-03-10', status: 'active', budget: { amount: '1000.25', currency: 'INR' }, ...overrides,
});
const deal = (n = 1, overrides = {}) => ({
  deal_id: id(n), deal_name: `Fictional Deal ${n}`, counterparty_name: `Fictional Counterparty ${n}`,
  direction: 'inbound', stage: 'creating', presence: 'enabled', arrangements: [arrangement()],
  deal_path: `/deal/${id(n)}`, ...overrides,
});
const payload = (overrides = {}) => ({ version: 1, as_of: '2028-02-29T12:00:00Z', deals: [deal()], ...overrides });

test('strict parser accepts enabled, not-enabled, unavailable, exact budgets, and UTC boundaries', () => {
  const active = arrangement({ start_date: '2028-02-29', end_date: '2028-02-29', budget: { amount: '0', currency: 'USD' } });
  const upcoming = arrangement({ account_label: 'Upcoming Account', start_date: '2028-03-01', end_date: '2028-03-02', status: 'upcoming', budget: null });
  const expired = arrangement({ account_label: 'Expired Account', start_date: '2028-02-01', end_date: '2028-02-28', status: 'expired', budget: { amount: '999999999999999999999.123456789', currency: 'INR' } });
  const parsed = parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [active, upcoming, expired] }), deal(2, { presence: 'not_enabled', arrangements: [] }), deal(3, { presence: 'unavailable', arrangements: [] })] }));
  assert.deepEqual(parsed.deals.map((item) => item.presence), ['enabled', 'not_enabled', 'unavailable']);
  assert.equal(parsed.deals[0].arrangements[2].budget.amount, '999999999999999999999.123456789');
});

test('strict parser rejects unknown keys, unsafe shapes, invalid values, duplicates, stale status, ordering, and overflow', () => {
  assert.throws(() => parseWhitelistingSnapshot({ ...payload(), secret: true }));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { deal_path: 'https://unsafe.example' })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [arrangement({ account_label: 'bad\nlabel' })] })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [arrangement({ start_date: '2028-03-11' })] })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [arrangement({ status: 'expired' })] })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [arrangement({ budget: { amount: '01.20', currency: 'INR' } })] })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { presence: 'not_enabled' })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [arrangement(), arrangement()] })] })));
  const upcoming = arrangement({ start_date: '2028-03-01', end_date: '2028-03-10', status: 'upcoming' });
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(1, { arrangements: [upcoming, arrangement()] })] })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: Array.from({ length: 101 }, (_, index) => deal(index + 1)) })));
  assert.throws(() => parseWhitelistingSnapshot(payload({ deals: [deal(2), deal(1)] })));
});

test('context fence rejects stale account, superseded response, and unmounted request', () => {
  const fence = new WhitelistingContextFence(); const first = fence.begin('account-a'); const second = fence.begin('account-a');
  assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(second), true);
  fence.switchContext('account-b'); assert.equal(fence.isCurrent(second), false);
  const current = fence.begin('account-b'); fence.invalidate(); assert.equal(fence.isCurrent(current), false);
});
