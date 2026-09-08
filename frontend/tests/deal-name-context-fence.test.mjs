import assert from 'node:assert/strict';
import test from 'node:test';

import { DealNameContextFence } from '../src/lib/deal-name-context-fence.ts';

test('late rename responses cannot cross account, deal, or displayed-version context', () => {
  const fence = new DealNameContextFence();
  fence.switchContext('account-a:deal-a');
  const ticket = fence.begin('account-a:deal-a', 3);

  assert.equal(fence.isCurrent(ticket, 3), true);
  assert.equal(fence.isCurrent(ticket, 4), false);
  assert.equal(fence.isIdentityCurrent(ticket), true);

  fence.switchContext('account-a:deal-b');
  assert.equal(fence.isCurrent(ticket, 3), false);
  assert.equal(fence.isIdentityCurrent(ticket), false);

  fence.switchContext('account-b:deal-a');
  assert.equal(fence.isCurrent(ticket, 3), false);
});
