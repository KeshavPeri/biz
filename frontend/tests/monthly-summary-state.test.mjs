import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MonthlySummaryContextFence, parseMonthlyDealSummary, shiftUtcMonth,
} from '../src/lib/monthly-summary-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const group = (n, overrides = {}) => ({
  counterparty_id: id(n), counterparty_name: `Fictional Counterparty ${n}`, currency: 'INR',
  contracted: '1000.00', confirmed_received: '250.00', outstanding: '750.00',
  deal_count: 1, deliverable_count: 2, inbound_deals: 1, outbound_deals: 0,
  partial_unquantified_count: 1, ...overrides,
});
const total = (overrides = {}) => ({
  currency: 'INR', contracted: '1000.00', confirmed_received: '250.00', outstanding: '750.00',
  deal_count: 1, deliverable_count: 2, inbound_deals: 1, outbound_deals: 0,
  partial_unquantified_count: 1, ...overrides,
});
const payload = (overrides = {}) => ({
  version: 1, as_of: '2026-09-24T12:00:00Z', month: '2026-09-01',
  integrity_attention_count: 0, totals: [total()], groups: [group(1)], ...overrides,
});

test('strict parser accepts exact decimal strings and maps bounded group facts', () => {
  const parsed = parseMonthlyDealSummary(payload());
  assert.equal(parsed.groups[0].confirmedReceived, '250.00');
  assert.equal(parsed.totals[0].outstanding, '750.00');
  assert.equal(parsed.groups[0].counterpartyId, id(1));
});

test('parser rejects unknown keys, malformed identity, dates, money, and text', () => {
  assert.throws(() => parseMonthlyDealSummary({ ...payload(), secret: true }));
  assert.throws(() => parseMonthlyDealSummary(payload({ month: '2026-09-02' })));
  assert.throws(() => parseMonthlyDealSummary(payload({ as_of: 'not-an-instant' })));
  assert.throws(() => parseMonthlyDealSummary(payload({ as_of: '2026-02-29T12:00:00Z' })));
  assert.throws(() => parseMonthlyDealSummary(payload({ as_of: '2026-04-31T12:00:00+05:30' })));
  assert.equal(parseMonthlyDealSummary(payload({ as_of: '2028-02-29T12:00:00Z' })).asOf, '2028-02-29T12:00:00Z');
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1, { counterparty_id: 'unsafe' })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1, { contracted: '1e3' })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1, { counterparty_name: 'x'.repeat(161) })] })));
});

test('parser rejects duplicate keys, excess rows, and inconsistent arithmetic', () => {
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1), group(1)], totals: [total({ contracted: '2000.00', confirmed_received: '500.00', outstanding: '1500.00', deal_count: 2, deliverable_count: 4, inbound_deals: 2, partial_unquantified_count: 2 })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1, { outstanding: '749.99' })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: [group(1, { inbound_deals: 0 })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ groups: Array.from({ length: 501 }, (_, index) => group((index % 999) + 1)) })));
  assert.throws(() => parseMonthlyDealSummary(payload({ totals: [total({ deal_count: 2 })] })));
  assert.throws(() => parseMonthlyDealSummary(payload({ totals: [total({ currency: 'USD', contracted: '0.00', confirmed_received: '0.00', outstanding: '0.00', deal_count: 0, deliverable_count: 0, inbound_deals: 0, partial_unquantified_count: 0 })], groups: [] })));
});

test('multiple currencies reconcile independently without a grand total', () => {
  const parsed = parseMonthlyDealSummary(payload({
    totals: [total(), total({ currency: 'USD', contracted: '25.00', confirmed_received: '0.00', outstanding: '25.00', partial_unquantified_count: 0 })],
    groups: [group(1), group(2, { currency: 'USD', contracted: '25.00', confirmed_received: '0.00', outstanding: '25.00', partial_unquantified_count: 0 })],
  }));
  assert.deepEqual(parsed.totals.map((row) => row.currency), ['INR', 'USD']);
});

test('UTC month navigation crosses year boundaries deterministically', () => {
  assert.equal(shiftUtcMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftUtcMonth('2026-12-01', 1), '2027-01-01');
  assert.throws(() => shiftUtcMonth('2026-12-02', 1));
});

test('context fence rejects prior account, month, superseded, and unmounted responses', () => {
  const fence = new MonthlySummaryContextFence();
  const september = fence.begin('account-a');
  const october = fence.begin('account-a');
  assert.equal(fence.isCurrent(september), false);
  assert.equal(fence.isCurrent(october), true);
  fence.switchContext('account-b');
  assert.equal(fence.isCurrent(october), false);
  const current = fence.begin('account-b');
  fence.invalidate();
  assert.equal(fence.isCurrent(current), false);
});
