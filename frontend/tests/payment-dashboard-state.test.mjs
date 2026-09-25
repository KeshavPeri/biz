import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PAYMENT_FILTERS, PaymentDashboardContextFence, parsePaymentDashboardPage,
  paymentFilterKey, summarizePaymentRows, validPaymentFilterDraft,
} from '../src/lib/payment-dashboard-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const filters = (overrides = {}) => ({
  deal_id: null, counterparty_id: null, due_from: null, due_to: null,
  bucket: null, state: null, limit: 2, ...overrides,
});
const row = (n, overrides = {}) => ({
  obligation_id: id(n), deal_id: id(100 + n), deal_name: `Fictional Deal ${n}`,
  counterparty_id: id(200 + n), counterparty_name: `Fictional Counterparty ${n}`,
  item_kind: 'single', milestone_sequence: null, milestone_trigger: null,
  amount: '1000.00', currency: 'INR', due_date: '2026-09-20', due_date_pending: false,
  canonical_state: 'not_paid_in_window', history_bucket: 'overdue',
  creator_receipt_confirmed: false, creator_receipt_confirmed_at: null,
  source_deal_id: id(100 + n), ...overrides,
});
const total = (overrides = {}) => ({
  currency: 'INR', obligation_total: '1000.00', confirmed_received: '0.00',
  obligation_count: 1, received_count: 0, pending_count: 0, overdue_count: 1,
  bad_debt_count: 0, partial_unquantified_count: 0, ...overrides,
});
const payload = (overrides = {}) => ({
  version: 1, as_of: '2026-09-25T12:00:00Z', viewer_kind: 'creator',
  filters: filters(), filter_options: {
    deals: [{ id: id(101), label: 'Fictional Deal 1' }],
    counterparties: [{ id: id(201), label: 'Fictional Counterparty 1' }],
  },
  next_cursor: null, totals: [total()], rows: [row(1)], ...overrides,
});

test('strict page parser accepts exact page reconciliation and safe options', () => {
  const parsed = parsePaymentDashboardPage(payload());
  assert.equal(parsed.rows[0].amount, '1000.00');
  assert.equal(parsed.totals[0].obligationTotal, '1000.00');
  assert.equal(parsed.filterOptions.deals[0].id, id(101));
});

test('strict parser accepts an unknown-date milestone only with its pending flag', () => {
  const unknownMilestone = row(1, {
    item_kind: 'milestone', milestone_sequence: 1,
    milestone_trigger: 'Fictional pending checkpoint', due_date: null, due_date_pending: true,
    history_bucket: 'pending',
  });
  const parsed = parsePaymentDashboardPage(payload({
    rows: [unknownMilestone], totals: [total({ pending_count: 1, overdue_count: 0 })],
  }));
  assert.equal(parsed.rows[0].dueDate, null);
  assert.equal(parsed.rows[0].dueDatePending, true);
});

test('parser rejects unknown keys, malformed identifiers, dates, money, cursors, and unsafe text', () => {
  assert.throws(() => parsePaymentDashboardPage({ ...payload(), secret: 'raw-payment-data' }));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { obligation_id: 'unsafe' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { due_date: '2026-02-29' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { amount: '1e3' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ next_cursor: 'x'.repeat(1025) })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { deal_name: 'x\nunsafe' })] })));
});

test('parser rejects impossible receipt, bucket, milestone and due-date combinations', () => {
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { history_bucket: 'received' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { canonical_state: 'bad_debt' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { item_kind: 'milestone' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { due_date: null, due_date_pending: false })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1, { creator_receipt_confirmed: true })] })));
});

test('parser rejects duplicates, wrong ordering and totals that do not reconcile', () => {
  assert.throws(() => parsePaymentDashboardPage(payload({ rows: [row(1), row(1)], totals: [total({ obligation_total: '2000.00', obligation_count: 2, overdue_count: 2 })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({
    rows: [row(1), row(2, { canonical_state: 'bad_debt', history_bucket: 'bad_debt' })],
    totals: [total({ obligation_total: '2000.00', obligation_count: 2, overdue_count: 1, bad_debt_count: 1 })],
  })));
  assert.throws(() => parsePaymentDashboardPage(payload({ totals: [total({ obligation_total: '999.99' })] })));
  assert.throws(() => parsePaymentDashboardPage(payload({ totals: [total({ received_count: 1 })] })));
});

test('multiple currencies remain separate and accumulated facts use exact integer cents', () => {
  const usd = row(2, { amount: '0.10', currency: 'USD', canonical_state: 'paid_full', history_bucket: 'received', creator_receipt_confirmed: true, creator_receipt_confirmed_at: '2026-09-20T12:00:00Z' });
  const parsed = parsePaymentDashboardPage(payload({
    rows: [row(1), usd],
    totals: [total(), total({ currency: 'USD', obligation_total: '0.10', confirmed_received: '0.10', received_count: 1, overdue_count: 0 })],
  }));
  assert.deepEqual(summarizePaymentRows(parsed.rows).map((item) => [item.currency, item.obligationTotal]), [['INR', '1000.00'], ['USD', '0.10']]);
});

test('filter validation rejects invalid ranges and incompatible shortcut/state pairs', () => {
  assert.equal(validPaymentFilterDraft({ ...DEFAULT_PAYMENT_FILTERS, dueFrom: '2026-09-30', dueTo: '2026-09-01' }), false);
  assert.equal(validPaymentFilterDraft({ ...DEFAULT_PAYMENT_FILTERS, bucket: 'received', state: 'disputed' }), false);
  assert.equal(validPaymentFilterDraft({ ...DEFAULT_PAYMENT_FILTERS, bucket: 'bad_debt', state: 'bad_debt' }), true);
});

test('context fence rejects account, filter, superseded and unmounted responses', () => {
  const fence = new PaymentDashboardContextFence();
  const first = fence.begin(`account-a:${paymentFilterKey(DEFAULT_PAYMENT_FILTERS)}`);
  const filtered = fence.begin(`account-a:${paymentFilterKey({ ...DEFAULT_PAYMENT_FILTERS, bucket: 'overdue' })}`);
  assert.equal(fence.isCurrent(first), false);
  assert.equal(fence.isCurrent(filtered), true);
  fence.switchContext(`account-b:${paymentFilterKey(DEFAULT_PAYMENT_FILTERS)}`);
  assert.equal(fence.isCurrent(filtered), false);
  const current = fence.begin(`account-b:${paymentFilterKey(DEFAULT_PAYMENT_FILTERS)}`);
  fence.invalidate();
  assert.equal(fence.isCurrent(current), false);
});
