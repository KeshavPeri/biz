export const TRACKER_STATUSES = ['red', 'amber', 'green'] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

export const TRACKER_REASON_CODES = [
  'needs_attention',
  'payment_disputed',
  'payment_overdue',
  'deliverable_overdue',
  'confirmation_overdue',
  'connection_expired',
  'confirmation_waiting',
  'deliverable_due_soon',
  'payment_due_soon',
  'connection_expiring',
  'on_track',
] as const;
export type TrackerReasonCode = (typeof TRACKER_REASON_CODES)[number];

export const TRACKER_STAGES = [
  'pending', 'chatting', 'approval', 'creating', 'posted', 'payment',
] as const;
export const TRACKER_DEAL_TYPES = ['campaign', 'product', 'experience'] as const;
export const TRACKER_DIRECTIONS = ['inbound', 'outbound'] as const;

export type DealTrackerRow = {
  id: string;
  name: string;
  status: TrackerStatus;
  reasonCode: TrackerReasonCode;
  reasonLabel: string;
  relevantAt: string | null;
  nextDeadline: string | null;
  stage: (typeof TRACKER_STAGES)[number];
  dealType: (typeof TRACKER_DEAL_TYPES)[number];
  direction: (typeof TRACKER_DIRECTIONS)[number];
  createdAt: string;
};

export type DealTrackerSnapshot = {
  version: 1;
  asOf: string;
  summary: {
    activeDeals: number;
    actionNeeded: number;
    paymentsDueThisWeek: number;
    nextDeadline: string | null;
    overdueDeliverables: number;
    inboundDeals: number;
    outboundDeals: number;
  };
  deals: DealTrackerRow[];
};

export type TrackerFilters = {
  status: TrackerStatus | null;
  stage: DealTrackerRow['stage'] | null;
  dealType: DealTrackerRow['dealType'] | null;
  direction: DealTrackerRow['direction'] | null;
  createdFrom: string | null;
  createdTo: string | null;
};

export const EMPTY_TRACKER_FILTERS: TrackerFilters = {
  status: null, stage: null, dealType: null, direction: null,
  createdFrom: null, createdTo: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function calendarDate(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DATE.test(value)) throw new Error('invalid tracker response');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('invalid tracker response');
  }
  return value;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid tracker response');
  const found = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) {
    throw new Error('invalid tracker response');
  }
  return value as Record<string, unknown>;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('invalid tracker response');
  return value as T;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('invalid tracker response');
  return value as number;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('invalid tracker response');
  }
  return value;
}

function instant(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid tracker response');
  }
  return value;
}

export function parseDealTrackerSnapshot(value: unknown): DealTrackerSnapshot {
  const root = record(value, ['version', 'as_of', 'summary', 'deals']);
  if (root.version !== 1 || !Array.isArray(root.deals) || root.deals.length > 500) throw new Error('invalid tracker response');
  const summary = record(root.summary, [
    'active_deals', 'action_needed', 'payments_due_this_week', 'next_deadline',
    'overdue_deliverables', 'inbound_deals', 'outbound_deals',
  ]);
  const deals = root.deals.map((raw): DealTrackerRow => {
    const row = record(raw, [
      'id', 'name', 'status', 'reason_code', 'reason_label', 'relevant_at',
      'next_deadline', 'stage', 'deal_type', 'direction', 'created_at',
    ]);
    if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new Error('invalid tracker response');
    return {
      id: row.id,
      name: text(row.name, 160),
      status: member(row.status, TRACKER_STATUSES),
      reasonCode: member(row.reason_code, TRACKER_REASON_CODES),
      reasonLabel: text(row.reason_label, 80),
      relevantAt: instant(row.relevant_at, true),
      nextDeadline: calendarDate(row.next_deadline, true),
      stage: member(row.stage, TRACKER_STAGES),
      dealType: member(row.deal_type, TRACKER_DEAL_TYPES),
      direction: member(row.direction, TRACKER_DIRECTIONS),
      createdAt: instant(row.created_at) as string,
    };
  });
  const activeDeals = integer(summary.active_deals);
  const actionNeeded = integer(summary.action_needed);
  const inboundDeals = integer(summary.inbound_deals);
  const outboundDeals = integer(summary.outbound_deals);
  if (deals.length !== activeDeals || deals.filter((row) => row.status === 'red').length !== actionNeeded || inboundDeals + outboundDeals !== activeDeals) {
    throw new Error('invalid tracker response');
  }
  if (new Set(deals.map((row) => row.id)).size !== deals.length) throw new Error('invalid tracker response');
  return {
    version: 1,
    asOf: instant(root.as_of) as string,
    summary: {
      activeDeals,
      actionNeeded,
      paymentsDueThisWeek: integer(summary.payments_due_this_week),
      nextDeadline: calendarDate(summary.next_deadline, true),
      overdueDeliverables: integer(summary.overdue_deliverables),
      inboundDeals,
      outboundDeals,
    },
    deals,
  };
}

const STATUS_RANK: Record<TrackerStatus, number> = { red: 0, amber: 1, green: 2 };

export function sortTrackerDeals(rows: readonly DealTrackerRow[]): DealTrackerRow[] {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  return [...rows].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || Number(a.nextDeadline === null) - Number(b.nextDeadline === null)
    || compare(a.nextDeadline ?? '', b.nextDeadline ?? '')
    || compare(a.name, b.name)
    || compare(a.id, b.id));
}

export function filterTrackerDeals(rows: readonly DealTrackerRow[], filters: TrackerFilters): DealTrackerRow[] {
  return rows.filter((row) =>
    (!filters.status || row.status === filters.status)
    && (!filters.stage || row.stage === filters.stage)
    && (!filters.dealType || row.dealType === filters.dealType)
    && (!filters.direction || row.direction === filters.direction)
    && (!filters.createdFrom || row.createdAt.slice(0, 10) >= filters.createdFrom)
    && (!filters.createdTo || row.createdAt.slice(0, 10) <= filters.createdTo));
}

export function trackerIoRatio(snapshot: DealTrackerSnapshot): string {
  return `${snapshot.summary.inboundDeals}:${snapshot.summary.outboundDeals}`;
}

export function hasTrackerFilters(filters: TrackerFilters): boolean {
  return Object.values(filters).some(Boolean);
}

export class TrackerContextFence {
  private context = '';
  private generation = 0;

  switchContext(context: string) {
    if (context !== this.context) { this.context = context; this.generation += 1; }
  }

  begin(context: string) {
    this.switchContext(context);
    this.generation += 1;
    return { context, generation: this.generation };
  }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) {
    return ticket.context === this.context && ticket.generation === this.generation;
  }
}
