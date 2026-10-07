import assert from 'node:assert/strict';
import test from 'node:test';

import { campaignCategory, ConflictWarningFence, parseConflictWarning, runConnectWithSessionFence } from '../src/lib/exclusivity-conflict-warning.ts';

const item = { brand: 'Fictional Rival', category: 'skincare', expiry: '2028-02-29' };
const payload = { version: 1, digest: 'a'.repeat(64), conflicts: [item] };

test('campaign category keeps display text after edge trim and rejects unsafe input', () => {
  assert.equal(campaignCategory('  Skin Care  '), 'Skin Care');
  for (const value of ['', '  ', 'x'.repeat(201), 'skin\ncare', 'skin\u202ecare']) {
    assert.throws(() => campaignCategory(value));
  }
});

test('strict structured warning parses bounded details and rejects private or malformed data', () => {
  assert.deepEqual(parseConflictWarning(payload).conflicts, [item]);
  assert.throws(() => parseConflictWarning({ ...payload, source_summary_id: 'private' }));
  assert.throws(() => parseConflictWarning({ ...payload, digest: 'forged' }));
  assert.throws(() => parseConflictWarning({ ...payload, conflicts: [] }));
  assert.throws(() => parseConflictWarning({ ...payload, conflicts: Array(51).fill(item) }));
  assert.throws(() => parseConflictWarning({ ...payload, conflicts: [{ ...item, expiry: '2026-02-29' }] }));
  assert.throws(() => parseConflictWarning({ ...payload, conflicts: [{ ...item, brand: 'bad\u202erival' }] }));
});

test('warning fence invalidates account, deal, category, request and close changes', () => {
  const fence = new ConflictWarningFence();
  const first = fence.begin('creator-a:deal-a:skincare');
  const newer = fence.begin('creator-a:deal-a:skincare');
  assert.equal(fence.isCurrent(first), false);
  assert.equal(fence.isCurrent(newer), true);
  fence.switchContext('creator-a:deal-b:skincare');
  assert.equal(fence.isCurrent(newer), false);
  const next = fence.begin('creator-a:deal-b:beauty');
  fence.invalidate();
  assert.equal(fence.isCurrent(next), false);
  const switched = fence.begin('creator-b:deal-b:beauty');
  assert.equal(fence.isCurrent(switched), true);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('category edit during delayed session lookup prevents connect mutation', async () => {
  const fence = new ConflictWarningFence();
  const session = deferred();
  let sends = 0;
  const pending = runConnectWithSessionFence(
    fence,
    'brand-a:skincare',
    () => session.promise,
    async () => { sends += 1; return 'sent'; },
  );
  fence.invalidate(); // ConnectSheet.changeCategory invalidates before updating the category.
  session.resolve('creator-a');
  assert.deepEqual(await pending, { state: 'stale' });
  assert.equal(sends, 0);
});

test('close and reopen during delayed session lookup cannot send or publish the old request', async () => {
  const fence = new ConflictWarningFence();
  const oldSession = deferred();
  let oldSends = 0;
  const oldPending = runConnectWithSessionFence(
    fence,
    'brand-a:skincare',
    () => oldSession.promise,
    async () => { oldSends += 1; return 'old'; },
  );
  fence.invalidate(); // close
  fence.invalidate(); // reopen
  const nextPending = runConnectWithSessionFence(
    fence,
    'brand-a:beauty',
    async () => 'creator-a',
    async () => 'next',
  );
  oldSession.resolve('creator-a');
  assert.deepEqual(await oldPending, { state: 'stale' });
  assert.equal(oldSends, 0);
  assert.deepEqual(await nextPending, { state: 'result', result: 'next' });
});
