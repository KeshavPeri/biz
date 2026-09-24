export type PaymentBucket = 'received' | 'pending' | 'overdue' | 'bad_debt';
export type PaymentCanonicalState =
  | 'paid_full' | 'paid_partial' | 'not_paid_in_window' | 'not_paid_delayed'
  | 'bad_debt' | 'disputed' | 'refunded';

export type PaymentDashboardFilters = {
  dealId: string | null;
  counterpartyId: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  bucket: PaymentBucket | null;
  state: PaymentCanonicalState | null;
  limit: number;
};

export type PaymentDashboardRow = {
  obligationId: string;
  dealId: string;
  dealName: string;
  counterpartyId: string;
  counterpartyName: string;
  itemKind: 'single' | 'milestone';
  milestoneSequence: number | null;
  milestoneTrigger: string | null;
  amount: string;
  currency: string;
  dueDate: string | null;
  dueDatePending: boolean;
  canonicalState: PaymentCanonicalState;
  historyBucket: PaymentBucket;
  creatorReceiptConfirmed: boolean;
  creatorReceiptConfirmedAt: string | null;
  sourceDealId: string;
};

export type PaymentCurrencyTotal = {
  currency: string;
  obligationTotal: string;
  confirmedReceived: string;
  obligationCount: number;
  receivedCount: number;
  pendingCount: number;
  overdueCount: number;
  badDebtCount: number;
  partialUnquantifiedCount: number;
};

export type PaymentDashboardPage = {
  version: 1;
  asOf: string;
  viewerKind: 'creator' | 'brand';
  filters: PaymentDashboardFilters;
  filterOptions: { deals: PaymentFilterOption[]; counterparties: PaymentFilterOption[] };
  nextCursor: string | null;
  totals: PaymentCurrencyTotal[];
  rows: PaymentDashboardRow[];
};

export type PaymentFilterOption = { id: string; label: string };

export const DEFAULT_PAYMENT_FILTERS: PaymentDashboardFilters = {
  dealId: null, counterpartyId: null, dueFrom: null, dueTo: null,
  bucket: null, state: null, limit: 40,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MONEY = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const BUCKETS: PaymentBucket[] = ['received', 'pending', 'overdue', 'bad_debt'];
const STATES: PaymentCanonicalState[] = [
  'paid_full', 'paid_partial', 'not_paid_in_window', 'not_paid_delayed',
  'bad_debt', 'disputed', 'refunded',
];

function invalid(): never { throw new Error('invalid payment dashboard response'); }

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) invalid();
  return value as number;
}

function nullable<T>(value: unknown, parse: (input: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) invalid();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(0); parsed.setUTCHours(0, 0, 0, 0); parsed.setUTCFullYear(year, month - 1, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) invalid();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  date(value.slice(0, 10));
  return value;
}

function money(value: unknown): string {
  if (typeof value !== 'string' || !MONEY.test(value)) invalid();
  return value;
}

function cents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

function decimal(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function bucket(value: unknown): PaymentBucket {
  if (typeof value !== 'string' || !BUCKETS.includes(value as PaymentBucket)) invalid();
  return value as PaymentBucket;
}

function state(value: unknown): PaymentCanonicalState {
  if (typeof value !== 'string' || !STATES.includes(value as PaymentCanonicalState)) invalid();
  return value as PaymentCanonicalState;
}

function parseFilters(value: unknown): PaymentDashboardFilters {
  const row = record(value, ['deal_id', 'counterparty_id', 'due_from', 'due_to', 'bucket', 'state', 'limit']);
  const dueFrom = nullable(row.due_from, date);
  const dueTo = nullable(row.due_to, date);
  const parsed = {
    dealId: nullable(row.deal_id, uuid), counterpartyId: nullable(row.counterparty_id, uuid),
    dueFrom, dueTo, bucket: nullable(row.bucket, bucket), state: nullable(row.state, state),
    limit: integer(row.limit, 100),
  };
  if (parsed.limit < 1 || dueFrom && dueTo && dueFrom > dueTo) invalid();
  if (parsed.bucket === 'received' && parsed.state && parsed.state !== 'paid_full') invalid();
  if (parsed.bucket === 'bad_debt' && parsed.state && parsed.state !== 'bad_debt') invalid();
  if (parsed.bucket && parsed.bucket !== 'bad_debt' && parsed.state === 'bad_debt') invalid();
  return parsed;
}

function parseRow(value: unknown): PaymentDashboardRow {
  const row = record(value, [
    'obligation_id', 'deal_id', 'deal_name', 'counterparty_id', 'counterparty_name',
    'item_kind', 'milestone_sequence', 'milestone_trigger', 'amount', 'currency',
    'due_date', 'due_date_pending', 'canonical_state', 'history_bucket',
    'creator_receipt_confirmed', 'creator_receipt_confirmed_at', 'source_deal_id',
  ]);
  if (row.item_kind !== 'single' && row.item_kind !== 'milestone') invalid();
  if (typeof row.currency !== 'string' || !CURRENCY.test(row.currency)) invalid();
  if (typeof row.due_date_pending !== 'boolean' || typeof row.creator_receipt_confirmed !== 'boolean') invalid();
  const dueDate = nullable(row.due_date, date);
  const milestoneSequence = nullable(row.milestone_sequence, (input) => integer(input, 100));
  const canonicalState = state(row.canonical_state);
  const historyBucket = bucket(row.history_bucket);
  const confirmedAt = nullable(row.creator_receipt_confirmed_at, instant);
  if ((row.item_kind === 'single' && (milestoneSequence !== null || row.milestone_trigger !== null))
      || (row.item_kind === 'milestone' && (!milestoneSequence || row.milestone_trigger === null))
      || row.source_deal_id !== row.deal_id
      || row.due_date_pending === (dueDate !== null)
      || row.creator_receipt_confirmed !== (confirmedAt !== null)
      || historyBucket === 'received' && (canonicalState !== 'paid_full' || !row.creator_receipt_confirmed)
      || historyBucket === 'bad_debt' && canonicalState !== 'bad_debt'
      || historyBucket !== 'bad_debt' && canonicalState === 'bad_debt') invalid();
  return {
    obligationId: uuid(row.obligation_id), dealId: uuid(row.deal_id), dealName: text(row.deal_name, 160),
    counterpartyId: uuid(row.counterparty_id), counterpartyName: text(row.counterparty_name, 160),
    itemKind: row.item_kind, milestoneSequence,
    milestoneTrigger: nullable(row.milestone_trigger, (input) => text(input, 200)),
    amount: money(row.amount), currency: row.currency, dueDate,
    dueDatePending: row.due_date_pending, canonicalState, historyBucket,
    creatorReceiptConfirmed: row.creator_receipt_confirmed,
    creatorReceiptConfirmedAt: confirmedAt, sourceDealId: uuid(row.source_deal_id),
  };
}

function parseTotal(value: unknown): PaymentCurrencyTotal {
  const row = record(value, [
    'currency', 'obligation_total', 'confirmed_received', 'obligation_count',
    'received_count', 'pending_count', 'overdue_count', 'bad_debt_count',
    'partial_unquantified_count',
  ]);
  if (typeof row.currency !== 'string' || !CURRENCY.test(row.currency)) invalid();
  const result = {
    currency: row.currency, obligationTotal: money(row.obligation_total),
    confirmedReceived: money(row.confirmed_received), obligationCount: integer(row.obligation_count, 100),
    receivedCount: integer(row.received_count, 100), pendingCount: integer(row.pending_count, 100),
    overdueCount: integer(row.overdue_count, 100), badDebtCount: integer(row.bad_debt_count, 100),
    partialUnquantifiedCount: integer(row.partial_unquantified_count, 100),
  };
  if (result.receivedCount + result.pendingCount + result.overdueCount + result.badDebtCount !== result.obligationCount
      || cents(result.confirmedReceived) > cents(result.obligationTotal)) invalid();
  return result;
}

export function parsePaymentDashboardPage(value: unknown): PaymentDashboardPage {
  const root = record(value, ['version', 'as_of', 'viewer_kind', 'filters', 'filter_options', 'next_cursor', 'totals', 'rows']);
  if (root.version !== 1 || root.viewer_kind !== 'creator' && root.viewer_kind !== 'brand'
      || !Array.isArray(root.totals) || !Array.isArray(root.rows)
      || root.totals.length > 50 || root.rows.length > 100
      || root.next_cursor !== null && (typeof root.next_cursor !== 'string' || root.next_cursor.length > 1024)) invalid();
  const totals = root.totals.map(parseTotal);
  const rows = root.rows.map(parseRow);
  const options = record(root.filter_options, ['deals', 'counterparties']);
  if (!Array.isArray(options.deals) || !Array.isArray(options.counterparties)
      || options.deals.length > 500 || options.counterparties.length > 500) invalid();
  const parseOption = (value: unknown): PaymentFilterOption => {
    const item = record(value, ['id', 'label']);
    return { id: uuid(item.id), label: text(item.label, 160) };
  };
  const filterOptions = { deals: options.deals.map(parseOption), counterparties: options.counterparties.map(parseOption) };
  if (new Set(totals.map((item) => item.currency)).size !== totals.length
      || new Set(rows.map((item) => item.obligationId)).size !== rows.length
      || new Set(filterOptions.deals.map((item) => item.id)).size !== filterOptions.deals.length
      || new Set(filterOptions.counterparties.map((item) => item.id)).size !== filterOptions.counterparties.length) invalid();
  const rank = (item: PaymentDashboardRow) => BUCKETS.indexOf(item.historyBucket) === 3 ? 0
    : item.historyBucket === 'overdue' ? 1 : item.historyBucket === 'pending' ? 2 : 3;
  for (let index = 1; index < rows.length; index += 1) {
    const prior = rows[index - 1]; const current = rows[index];
    const a = `${rank(prior)}:${prior.dueDate ?? '9999-12-31'}:${prior.obligationId}`;
    const b = `${rank(current)}:${current.dueDate ?? '9999-12-31'}:${current.obligationId}`;
    if (a >= b) invalid();
  }
  for (const total of totals) {
    const matching = rows.filter((item) => item.currency === total.currency);
    const count = (target: PaymentBucket) => matching.filter((item) => item.historyBucket === target).length;
    const obligationTotal = matching.reduce((sum, item) => sum + cents(item.amount), 0n);
    const confirmedReceived = matching.filter((item) => item.historyBucket === 'received')
      .reduce((sum, item) => sum + cents(item.amount), 0n);
    if (matching.length !== total.obligationCount || obligationTotal !== cents(total.obligationTotal)
        || confirmedReceived !== cents(total.confirmedReceived)
        || count('received') !== total.receivedCount || count('pending') !== total.pendingCount
        || count('overdue') !== total.overdueCount || count('bad_debt') !== total.badDebtCount
        || matching.filter((item) => item.canonicalState === 'paid_partial').length !== total.partialUnquantifiedCount) invalid();
  }
  if (rows.some((item) => !totals.some((total) => total.currency === item.currency))) invalid();
  return {
    version: 1, asOf: instant(root.as_of), viewerKind: root.viewer_kind,
    filters: parseFilters(root.filters), filterOptions, nextCursor: root.next_cursor as string | null,
    totals, rows,
  };
}

export function paymentFilterKey(filters: PaymentDashboardFilters): string {
  return JSON.stringify(filters);
}

export function summarizePaymentRows(rows: PaymentDashboardRow[]): PaymentCurrencyTotal[] {
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  return currencies.map((currency) => {
    const matching = rows.filter((row) => row.currency === currency);
    const received = matching.filter((row) => row.historyBucket === 'received');
    const count = (target: PaymentBucket) => matching.filter((row) => row.historyBucket === target).length;
    return {
      currency,
      obligationTotal: decimal(matching.reduce((sum, row) => sum + cents(row.amount), 0n)),
      confirmedReceived: decimal(received.reduce((sum, row) => sum + cents(row.amount), 0n)),
      obligationCount: matching.length,
      receivedCount: count('received'), pendingCount: count('pending'),
      overdueCount: count('overdue'), badDebtCount: count('bad_debt'),
      partialUnquantifiedCount: matching.filter((row) => row.canonicalState === 'paid_partial').length,
    };
  });
}

export function validPaymentFilterDraft(filters: PaymentDashboardFilters): boolean {
  try {
    if (filters.dealId) uuid(filters.dealId);
    if (filters.counterpartyId) uuid(filters.counterpartyId);
    if (filters.dueFrom) date(filters.dueFrom);
    if (filters.dueTo) date(filters.dueTo);
    if (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo) return false;
    return !(filters.bucket === 'received' && filters.state && filters.state !== 'paid_full')
      && !(filters.bucket === 'bad_debt' && filters.state && filters.state !== 'bad_debt')
      && !(filters.bucket && filters.bucket !== 'bad_debt' && filters.state === 'bad_debt');
  } catch { return false; }
}

export class PaymentDashboardContextFence {
  private context = '';
  private generation = 0;
  switchContext(context: string) {
    if (context !== this.context) { this.context = context; this.generation += 1; }
  }
  begin(context: string) {
    this.switchContext(context); this.generation += 1;
    return { context, generation: this.generation };
  }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) {
    return ticket.context === this.context && ticket.generation === this.generation;
  }
}
