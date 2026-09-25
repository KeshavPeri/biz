import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CampaignCalendarContextFence, calendarDates, calendarItemsForDate,
  campaignCalendarWindow, parseCampaignCalendarSnapshot, shiftCalendarAnchor, utcToday,
} from '../src/lib/campaign-calendar-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (kind = 'scheduled_post', n = 1, overrides = {}) => ({
  id: `${kind}:${id(n)}`, deal_id: id(100 + n), deal_name: `Fictional Campaign ${n}`,
  kind, state: kind === 'actual_post' ? 'confirmed' : kind === 'rights_expiry' ? 'active' : 'pending',
  start_date: '2026-09-25', end_date: '2026-09-25',
  occurred_at: kind === 'actual_post' ? '2026-09-25T12:00:00Z' : null,
  label: 'Instagram · Reel', creator_label: kind === 'scheduled_post' ? 'Scheduled' : null,
  source_deal_id: id(100 + n), ...overrides,
});
const range = (overrides = {}) => ({
  id: `blackout:${id(101)}:2026-09-24:2026-09-26`, deal_id: id(101),
  deal_name: 'Fictional Campaign 1', kind: 'blackout', start_date: '2026-09-24',
  end_date: '2026-09-26', label: 'Blackout period', source_deal_id: id(101), ...overrides,
});
const payload = (overrides = {}) => ({
  version: 1, as_of: '2026-09-25T12:00:00Z', viewer_kind: 'creator',
  start_date: '2026-09-20', end_date: '2026-09-26',
  unscheduled: { payment_due_count: 1, integrity_issue_count: 0 },
  events: [event()], ranges: [range()], ...overrides,
});

test('strict parser accepts bounded events, blackout ranges and creator labels', () => {
  const parsed = parseCampaignCalendarSnapshot(payload(), { startDate: '2026-09-20', endDate: '2026-09-26' });
  assert.equal(parsed.viewerKind, 'creator');
  assert.equal(parsed.events[0].creatorLabel, 'Scheduled');
  assert.equal(calendarItemsForDate(parsed, '2026-09-25').ranges.length, 1);
  assert.equal(parsed.unscheduled.paymentDueCount, 1);
});

test('brand payload has the same shape but can never carry a private label', () => {
  const brand = payload({ viewer_kind: 'brand', events: [event('scheduled_post', 1, { creator_label: null })] });
  assert.equal(parseCampaignCalendarSnapshot(brand).events[0].creatorLabel, null);
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ viewer_kind: 'brand' })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('payment_due', 1, { creator_label: 'Scheduled' })] })));
});

test('parser rejects unknown keys, malformed identifiers, dates, instants and unsafe text', () => {
  assert.throws(() => parseCampaignCalendarSnapshot({ ...payload(), secret: 'source-url' }));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('scheduled_post', 1, { deal_id: 'unsafe' })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('scheduled_post', 1, { start_date: '2026-02-29' })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('actual_post', 1, { occurred_at: 'not-an-instant' })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('scheduled_post', 1, { label: 'unsafe\nlabel' })] })));
});

test('parser rejects unauthorized shapes, duplicates, inconsistent identity and unsorted rows', () => {
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event(), event()] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ ranges: [range(), range()] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('actual_post', 1, { occurred_at: null })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('payment_due', 1, { id: `scheduled_post:${id(1)}` })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ ranges: [range({ end_date: '2026-09-27' })] })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ events: [event('scheduled_post', 2), event('scheduled_post', 1)] })));
});

test('parser enforces one to forty-two inclusive UTC dates and the requested context', () => {
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ start_date: '2026-09-27', end_date: '2026-09-26' })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload({ start_date: '2026-09-01', end_date: '2026-10-13' })));
  assert.throws(() => parseCampaignCalendarSnapshot(payload(), { startDate: '2026-09-19', endDate: '2026-09-25' }));
  const fortyTwo = payload({ start_date: '2026-08-30', end_date: '2026-10-10' });
  assert.equal(parseCampaignCalendarSnapshot(fortyTwo).endDate, '2026-10-10');
});

test('day, Monday week and complete six-week month windows remain UTC stable', () => {
  assert.deepEqual(campaignCalendarWindow('day', '2026-01-01'), { startDate: '2026-01-01', endDate: '2026-01-01' });
  assert.deepEqual(campaignCalendarWindow('week', '2026-01-01'), { startDate: '2025-12-29', endDate: '2026-01-04' });
  const leapMonth = campaignCalendarWindow('month', '2028-02-29');
  assert.deepEqual(leapMonth, { startDate: '2028-01-30', endDate: '2028-03-11' });
  assert.equal(calendarDates(leapMonth).length, 42);
  assert.equal(shiftCalendarAnchor('month', '2028-03-31', -1), '2028-02-01');
  assert.equal(shiftCalendarAnchor('week', '2026-01-01', 1), '2026-01-08');
  assert.equal(utcToday(new Date('2026-09-25T23:59:59-07:00')), '2026-09-26');
});

test('context fence rejects account, view, range, refresh and unmounted responses', () => {
  const fence = new CampaignCalendarContextFence();
  const first = fence.begin('account-a:month:2026-08-30:2026-10-10');
  const viewChanged = fence.begin('account-a:week:2026-09-21:2026-09-27');
  assert.equal(fence.isCurrent(first), false);
  assert.equal(fence.isCurrent(viewChanged), true);
  fence.switchContext('account-b:week:2026-09-21:2026-09-27');
  assert.equal(fence.isCurrent(viewChanged), false);
  const refresh = fence.begin('account-b:week:2026-09-21:2026-09-27');
  const superseded = fence.begin('account-b:week:2026-09-21:2026-09-27');
  assert.equal(fence.isCurrent(refresh), false);
  assert.equal(fence.isCurrent(superseded), true);
  fence.invalidate();
  assert.equal(fence.isCurrent(superseded), false);
});
