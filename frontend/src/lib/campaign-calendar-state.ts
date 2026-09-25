export const CALENDAR_PRIVATE_LABELS = ['Idea', 'In Progress', 'Filmed', 'Approved', 'Scheduled'] as const;
export type CalendarPrivateLabel = (typeof CALENDAR_PRIVATE_LABELS)[number];

export const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const CALENDAR_EVENT_KINDS = ['scheduled_post', 'actual_post', 'payment_due', 'rights_expiry'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export type CampaignCalendarEvent = {
  id: string;
  dealId: string;
  dealName: string;
  kind: CalendarEventKind;
  state: string;
  startDate: string;
  endDate: string;
  occurredAt: string | null;
  label: string;
  creatorLabel: CalendarPrivateLabel | null;
  sourceDealId: string;
};

export type CampaignCalendarRange = {
  id: string;
  dealId: string;
  dealName: string;
  kind: 'blackout';
  startDate: string;
  endDate: string;
  label: string;
  sourceDealId: string;
};

export type CampaignCalendarSnapshot = {
  version: 1;
  asOf: string;
  viewerKind: 'creator' | 'brand';
  startDate: string;
  endDate: string;
  unscheduled: { paymentDueCount: number; integrityIssueCount: number };
  events: CampaignCalendarEvent[];
  ranges: CampaignCalendarRange[];
};

export type CalendarWindow = { startDate: string; endDate: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_ID = /^(scheduled_post|actual_post|payment_due|rights_expiry):([0-9a-f-]{36})$/i;
const RANGE_ID = /^blackout:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/i;
const EVENT_STATES = [
  'pending', 'draft', 'submitted', 'approved', 'revision_requested', 'posted',
  'confirmed', 'paid_full', 'paid_partial', 'not_paid_in_window',
  'not_paid_delayed', 'bad_debt', 'disputed', 'refunded', 'active', 'expired',
] as const;

function invalid(): never { throw new Error('invalid campaign calendar response'); }

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}

function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function instant(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}

function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}

function boundedInteger(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) invalid();
  return value as number;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

function utcDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function isoDate(value: Date): string { return value.toISOString().slice(0, 10); }

export function addUtcDays(value: string, days: number): string {
  const date = utcDate(calendarDate(value));
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function utcToday(now = new Date()): string {
  return `${now.getUTCFullYear().toString().padStart(4, '0')}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export function campaignCalendarWindow(view: CalendarView, anchorDate: string): CalendarWindow {
  const anchor = utcDate(calendarDate(anchorDate));
  if (view === 'day') return { startDate: anchorDate, endDate: anchorDate };
  if (view === 'week') {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    const startDate = addUtcDays(anchorDate, -mondayOffset);
    return { startDate, endDate: addUtcDays(startDate, 6) };
  }
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const startDate = addUtcDays(isoDate(first), -first.getUTCDay());
  return { startDate, endDate: addUtcDays(startDate, 41) };
}

export function shiftCalendarAnchor(view: CalendarView, anchorDate: string, direction: -1 | 1): string {
  if (view === 'day') return addUtcDays(anchorDate, direction);
  if (view === 'week') return addUtcDays(anchorDate, direction * 7);
  const anchor = utcDate(calendarDate(anchorDate));
  return isoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1)));
}

export function calendarRangeHeading(view: CalendarView, anchorDate: string, window: CalendarWindow): string {
  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(utcDate(value));
  if (view === 'day') return format(anchorDate, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return format(anchorDate, { month: 'long', year: 'numeric' });
  return `${format(window.startDate, { day: 'numeric', month: 'short' })} – ${format(window.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function parseCampaignCalendarSnapshot(
  value: unknown,
  expectedWindow?: CalendarWindow,
): CampaignCalendarSnapshot {
  const root = exactRecord(value, ['version', 'as_of', 'viewer_kind', 'start_date', 'end_date', 'unscheduled', 'events', 'ranges']);
  if (root.version !== 1 || (root.viewer_kind !== 'creator' && root.viewer_kind !== 'brand')) invalid();
  const startDate = calendarDate(root.start_date);
  const endDate = calendarDate(root.end_date);
  const days = Math.round((utcDate(endDate).valueOf() - utcDate(startDate).valueOf()) / 86_400_000) + 1;
  if (days < 1 || days > 42 || (expectedWindow && (startDate !== expectedWindow.startDate || endDate !== expectedWindow.endDate))) invalid();
  if (!Array.isArray(root.events) || root.events.length > 1000 || !Array.isArray(root.ranges) || root.ranges.length > 500) invalid();
  const unscheduled = exactRecord(root.unscheduled, ['payment_due_count', 'integrity_issue_count']);
  const viewerKind = root.viewer_kind;

  const events = root.events.map((raw): CampaignCalendarEvent => {
    const row = exactRecord(raw, [
      'id', 'deal_id', 'deal_name', 'kind', 'state', 'start_date', 'end_date',
      'occurred_at', 'label', 'creator_label', 'source_deal_id',
    ]);
    if (typeof row.kind !== 'string' || !CALENDAR_EVENT_KINDS.includes(row.kind as CalendarEventKind)) invalid();
    const kind = row.kind as CalendarEventKind;
    const idMatch = typeof row.id === 'string' ? EVENT_ID.exec(row.id) : null;
    if (!idMatch || idMatch[1] !== kind || !UUID.test(idMatch[2])) invalid();
    const dealId = uuid(row.deal_id);
    if (uuid(row.source_deal_id) !== dealId) invalid();
    const rowStart = calendarDate(row.start_date);
    const rowEnd = calendarDate(row.end_date);
    if (rowStart > rowEnd || rowEnd < startDate || rowStart > endDate) invalid();
    if (typeof row.state !== 'string' || !EVENT_STATES.includes(row.state as (typeof EVENT_STATES)[number])) invalid();
    const occurredAt = instant(row.occurred_at, true);
    if (kind === 'actual_post') {
      if (!occurredAt || occurredAt.slice(0, 10) !== rowStart || rowStart !== rowEnd || row.state !== 'confirmed') invalid();
    } else if (occurredAt !== null) invalid();
    let creatorLabel: CalendarPrivateLabel | null = null;
    if (row.creator_label !== null) {
      if (viewerKind !== 'creator' || !['scheduled_post', 'actual_post'].includes(kind)
          || !CALENDAR_PRIVATE_LABELS.includes(row.creator_label as CalendarPrivateLabel)) invalid();
      creatorLabel = row.creator_label as CalendarPrivateLabel;
    }
    return {
      id: row.id as string, dealId, dealName: safeText(row.deal_name, 160), kind,
      state: row.state, startDate: rowStart, endDate: rowEnd, occurredAt,
      label: safeText(row.label, 160), creatorLabel, sourceDealId: dealId,
    };
  });

  const ranges = root.ranges.map((raw): CampaignCalendarRange => {
    const row = exactRecord(raw, ['id', 'deal_id', 'deal_name', 'kind', 'start_date', 'end_date', 'label', 'source_deal_id']);
    if (row.kind !== 'blackout') invalid();
    const match = typeof row.id === 'string' ? RANGE_ID.exec(row.id) : null;
    if (!match || !UUID.test(match[1])) invalid();
    const dealId = uuid(row.deal_id);
    const rowStart = calendarDate(row.start_date);
    const rowEnd = calendarDate(row.end_date);
    if (match[1].toLowerCase() !== dealId.toLowerCase() || match[2] !== rowStart || match[3] !== rowEnd
        || uuid(row.source_deal_id) !== dealId || rowStart > rowEnd || rowStart < startDate || rowEnd > endDate) invalid();
    return {
      id: row.id as string, dealId, dealName: safeText(row.deal_name, 160), kind: 'blackout',
      startDate: rowStart, endDate: rowEnd, label: safeText(row.label, 80), sourceDealId: dealId,
    };
  });
  if (new Set(events.map((item) => item.id)).size !== events.length
      || new Set(ranges.map((item) => item.id)).size !== ranges.length) invalid();
  const orderKey = (item: CampaignCalendarEvent) => `${item.startDate}|${item.endDate}|${item.kind}|${item.dealId}|${item.id}`;
  if (events.some((item, index) => index > 0 && orderKey(events[index - 1]) > orderKey(item))) invalid();

  return {
    version: 1, asOf: instant(root.as_of) as string, viewerKind, startDate, endDate,
    unscheduled: {
      paymentDueCount: boundedInteger(unscheduled.payment_due_count, 1000),
      integrityIssueCount: boundedInteger(unscheduled.integrity_issue_count, 500),
    },
    events, ranges,
  };
}

export function calendarItemsForDate(snapshot: CampaignCalendarSnapshot, date: string) {
  calendarDate(date);
  return {
    events: snapshot.events.filter((event) => event.startDate <= date && event.endDate >= date),
    ranges: snapshot.ranges.filter((range) => range.startDate <= date && range.endDate >= date),
  };
}

export function calendarDates(window: CalendarWindow): string[] {
  calendarDate(window.startDate); calendarDate(window.endDate);
  const values: string[] = [];
  for (let value = window.startDate; value <= window.endDate; value = addUtcDays(value, 1)) values.push(value);
  return values;
}

export class CampaignCalendarContextFence {
  private context = '';
  private generation = 0;
  switchContext(context: string) {
    if (context !== this.context) { this.context = context; this.generation += 1; }
  }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) {
    return ticket.context === this.context && ticket.generation === this.generation;
  }
}
