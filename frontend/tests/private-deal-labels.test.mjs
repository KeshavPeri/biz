import assert from 'node:assert/strict';
import test from 'node:test';

import {
  distinctPrivateDealLabels,
  filterDealsByPrivateLabel,
  labelsByDeal,
  normalizePrivateDealLabel,
  PrivateDealLabelContextFence,
} from '../src/lib/private-deal-label-state.ts';

test('normalizes new private labels and rejects unsafe or out-of-bounds input', () => {
  assert.equal(normalizePrivateDealLabel('  Q3   launches  '), 'Q3 launches');
  assert.equal(normalizePrivateDealLabel(' \n '), null);
  assert.equal(normalizePrivateDealLabel(`safe\u0000label`), null);
  assert.equal(normalizePrivateDealLabel(`safe\u202Elabel`), null);
  assert.equal(normalizePrivateDealLabel('a'.repeat(33)), null);
});

test('groups only bounded valid rows and builds stable distinct filters', () => {
  const rows = labelsByDeal([
    { id: '1', dealId: 'a', label: 'Priority' },
    { id: '2', dealId: 'a', label: 'Priority' },
    { id: '3', dealId: 'a', label: ' Q3' },
    { id: '4', dealId: 'b', label: 'alpha' },
    { id: '5', dealId: 'b', label: 'Beta' },
  ]);
  assert.deepEqual(rows.a.map((row) => row.label), ['Priority']);
  assert.deepEqual(distinctPrivateDealLabels(rows), ['alpha', 'Beta', 'Priority']);
});

test('filtering preserves the established deal activity order', () => {
  const deals = [{ dealId: 'newest' }, { dealId: 'older' }, { dealId: 'other' }];
  const labels = labelsByDeal([
    { id: '1', dealId: 'older', label: 'Priority' },
    { id: '2', dealId: 'newest', label: 'Priority' },
  ]);
  assert.deepEqual(filterDealsByPrivateLabel(deals, labels, 'Priority').map((deal) => deal.dealId), ['newest', 'older']);
  assert.deepEqual(filterDealsByPrivateLabel(deals, labels, null), deals);
});

test('late reads and mutations cannot cross account or deal editor contexts', () => {
  const fence = new PrivateDealLabelContextFence();
  fence.switchContext('account-a:deal-a');
  const read = fence.begin('account-a:deal-a');
  assert.equal(fence.isCurrent(read), true);
  fence.switchContext('account-b:deal-a');
  assert.equal(fence.isCurrent(read), false);
  const mutation = fence.begin('account-b:deal-a');
  fence.switchContext('account-b:deal-b');
  assert.equal(fence.isCurrent(mutation), false);
});
