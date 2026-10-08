import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOTIFICATION_PAGE_SIZE, NotificationContextFence, NotificationHintHub, appendNotificationPage,
  groupNotifications, isUuid, notificationBadge, notificationBadgeLabel,
  notificationCursorFilter, notificationHintMatches, pageCursor, parseNotification, parseReadableDealSources, reconcileVerifiedRead,
  shouldMarkNotificationRead,
} from '../src/lib/notification-state.ts';

const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const account = uuid(1);
const other = uuid(2);
const deal = uuid(3);
const tie = '2026-10-08T10:00:00.000Z';
function raw(n, override = {}) {
  return { id: uuid(n + 100), profile_id: account, tier: 'important', title: '<script>plain text</script>',
    body: 'https://example.test/deal/unsafe', deal_id: deal, read: false,
    created_at: tie, ...override };
}
const row = (n, override = {}) => parseNotification(raw(n, override), account);

test('strict parser rejects foreign, malformed and unsafe row shapes', () => {
  assert.equal(row(1).title, '<script>plain text</script>');
  for (const bad of [
    { profile_id: other }, { id: '../deal/x' }, { deal_id: '/deal/evil' },
    { tier: 'urgent' }, { created_at: 'yesterday' }, { read: 'false' },
    { title: { html: 'bad' } }, { body: null }, { profile_id: null },
  ]) assert.throws(() => parseNotification(raw(1, bad), account));
  assert.throws(() => parseNotification([raw(1)], account));
});

test('tied keyset boundaries traverse 103 unread IDs once despite newer insert', () => {
  const all = Array.from({ length: 103 }, (_, i) => row(i + 1));
  const newest = [...all].sort((a, b) => b.id.localeCompare(a.id));
  const first = newest.slice(0, NOTIFICATION_PAGE_SIZE);
  const cursor = pageCursor(first);
  assert.equal(notificationCursorFilter('newest', cursor), `created_at.lt.${tie},and(created_at.eq.${tie},id.lt.${cursor.id})`);
  const afterInsert = [row(999), ...newest];
  const second = afterInsert.filter((r) => r.createdAt < cursor.createdAt || (r.createdAt === cursor.createdAt && r.id < cursor.id)).slice(0, NOTIFICATION_PAGE_SIZE);
  const thirdCursor = pageCursor(second);
  const third = afterInsert.filter((r) => r.createdAt < thirdCursor.createdAt || (r.createdAt === thirdCursor.createdAt && r.id < thirdCursor.id));
  const merged = appendNotificationPage(appendNotificationPage(first, second), [second[0], ...third]);
  assert.equal(merged.length, 103);
  assert.equal(new Set(merged.map((r) => r.id)).size, 103);
  assert.equal(merged.some((r) => r.id === uuid(1099)), false);
});

test('oldest first unread traversal remains bounded past 100 and keeps read history separate', () => {
  const all = Array.from({ length: 103 }, (_, i) => row(i + 1));
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const first = sorted.slice(0, 50);
  const cursor = pageCursor(first);
  assert.equal(notificationCursorFilter('oldest-unread', cursor), `created_at.gt.${tie},and(created_at.eq.${tie},id.gt.${cursor.id})`);
  const second = sorted.filter((r) => r.id > cursor.id).slice(0, 50);
  const third = sorted.filter((r) => r.id > pageCursor(second).id);
  assert.deepEqual([first.length, second.length, third.length], [50, 50, 3]);
  assert.equal(appendNotificationPage(appendNotificationPage(first, second), third).length, 103);
  assert.throws(() => notificationCursorFilter('newest', { createdAt: tie, id: '../evil' }));
});

test('deal grouping appends into stable first-seen group and hides inaccessible sources', () => {
  const inaccessible = uuid(4);
  const rows = [row(1), row(2, { deal_id: null }), row(3, { deal_id: inaccessible }), row(4)];
  const groups = groupNotifications(rows, { [deal]: { id: deal, name: 'Fictional Deal' } });
  assert.deepEqual(groups.map((g) => g.title), ['Fictional Deal', 'General / Unavailable source']);
  assert.deepEqual(groups[0].rows.map((r) => r.id), [uuid(101), uuid(104)]);
  assert.equal(groups[1].source, null);
  assert.deepEqual(groups[1].rows.map((r) => r.id), [uuid(102), uuid(103)]);
  assert.equal(isUuid('../deal/evil'), false);
});

test('soft-deleted or foreign deal sources stay generic and cannot open a deal', () => {
  const deleted = uuid(5);
  const sources = parseReadableDealSources([
    { id: deal, deal_name: 'Current Deal', deleted_at: null },
    { id: deleted, deal_name: 'Former Private Deal', deleted_at: tie },
    { id: other, deal_name: 'Unrequested Deal', deleted_at: null },
  ], [deal, deleted]);
  assert.deepEqual(Object.keys(sources), [deal]);
  const groups = groupNotifications([row(1, { deal_id: deleted }), row(2, { deal_id: deal })], sources);
  assert.equal(groups[0].title, 'General / Unavailable source');
  assert.equal(groups[0].source, null);
  assert.equal(groups[1].title, 'Current Deal');
  assert.throws(() => parseReadableDealSources({ id: deal }, [deal]));
});

test('badge distinguishes unknown, zero and exact 100+ accessibility count', () => {
  assert.equal(notificationBadge(null), null);
  assert.equal(notificationBadge(0), null);
  assert.equal(notificationBadge(1), '1');
  assert.equal(notificationBadge(99), '99');
  assert.equal(notificationBadge(100), '99+');
  assert.equal(notificationBadgeLabel(101), 'Notifications, 101 unread');
  assert.match(notificationBadgeLabel(null), /unavailable/);
});

test('only active visible own unread rows qualify for an RPC attempt', () => {
  const notice = row(1);
  assert.equal(shouldMarkNotificationRead(notice, account, true, true, false), true);
  for (const [acct, visible, active, attempted] of [
    [account, false, true, false], [account, true, false, false],
    [other, true, true, false], [account, true, true, true],
  ]) assert.equal(shouldMarkNotificationRead(notice, acct, visible, active, attempted), false);
  assert.equal(shouldMarkNotificationRead({ ...notice, read: true }, account, true, true, false), false);
});

test('read reconciliation preserves loaded 103-row traversal and requires verified true state', () => {
  const rows = Array.from({ length: 103 }, (_, i) => row(i + 1));
  const originalIds = rows.map((item) => item.id);
  assert.equal(reconcileVerifiedRead(rows, row(1, { read: false })), rows);
  const verified = row(1, { read: true });
  const updated = reconcileVerifiedRead(rows, verified);
  assert.deepEqual(updated.map((item) => item.id), originalIds);
  assert.equal(updated.length, 103);
  assert.equal(updated[0].read, true);
  assert.equal(updated[1].read, false);
  assert.deepEqual(reconcileVerifiedRead(rows, { ...verified, profileId: other }), rows);
});

test('account, token, order and superseded request fence late completions', () => {
  const fence = new NotificationContextFence();
  fence.switchContext(`${account}:token-a:newest`);
  const first = fence.begin();
  const second = fence.begin();
  assert.equal(fence.isCurrent(`${account}:token-a:newest`, first), false);
  assert.equal(fence.isCurrent(`${account}:token-a:newest`, second), true);
  fence.switchContext(`${account}:token-b:newest`);
  assert.equal(fence.isContextCurrent(`${account}:token-a:newest`), false);
  fence.switchContext(`${other}:token-b:newest`);
  assert.equal(fence.isCurrent(`${account}:token-b:newest`, second), false);
  fence.invalidate();
  assert.equal(fence.isCurrent(`${other}:token-b:newest`, second), false);
});

test('late mark-read count cannot overwrite newer refresh badge result', async () => {
  const fence = new NotificationContextFence();
  const key = `${account}:token-a:newest`;
  fence.switchContext(key);
  let settleOld;
  const oldResponse = new Promise((resolve) => { settleOld = resolve; });
  let badge = null;
  const oldGeneration = fence.begin();
  const oldCompletion = oldResponse.then((count) => {
    if (fence.isCurrent(key, oldGeneration)) badge = count;
  });
  const refreshGeneration = fence.begin();
  await Promise.resolve(3).then((count) => {
    if (fence.isCurrent(key, refreshGeneration)) badge = count;
  });
  settleOld(8);
  await oldCompletion;
  assert.equal(badge, 3);
  fence.invalidate();
  assert.equal(fence.isCurrent(key, refreshGeneration), false);
});

test('Realtime hints accept only current recipient INSERT or UPDATE, never content', () => {
  assert.equal(notificationHintMatches(account, 'INSERT', { profile_id: account, title: '<script>' }), true);
  assert.equal(notificationHintMatches(account, 'UPDATE', { profile_id: account }), true);
  assert.equal(notificationHintMatches(account, 'DELETE', { profile_id: account }), false);
  assert.equal(notificationHintMatches(account, 'INSERT', { profile_id: other }), false);
  assert.equal(notificationHintMatches(account, 'INSERT', null), false);
});

test('one live channel is shared, rotated and cleaned; late hints cannot leak', () => {
  const hub = new NotificationHintHub();
  let opens = 0; let closes = 0; let first = 0; let second = 0;
  const emissions = [];
  const start = (emit) => { opens++; emissions.push(emit); return () => { closes++; }; };
  const shared = () => second++;
  const stopFirst = hub.subscribe(`${account}:token-a`, () => first++, start);
  const stopSecond = hub.subscribe(`${account}:token-a`, shared, start);
  assert.equal(opens, 1);
  emissions[0](); assert.deepEqual([first, second], [1, 1]);
  stopFirst(); emissions[0](); assert.deepEqual([first, second], [1, 2]);
  const stopRotated = hub.subscribe(`${account}:token-b`, shared, start);
  assert.equal(closes, 1); assert.equal(opens, 2);
  emissions[0](); assert.equal(second, 2);
  emissions[1](); assert.equal(second, 3);
  stopSecond(); // old subscription cannot close the current channel or remove a reused callback.
  assert.equal(closes, 1);
  emissions[1](); assert.equal(second, 4);
  stopRotated(); assert.equal(closes, 2);
  emissions[1](); assert.equal(second, 4);
});
