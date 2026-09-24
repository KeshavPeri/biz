export type MonthlyMoneyFacts = {
  contracted: string;
  confirmedReceived: string;
  outstanding: string;
  dealCount: number;
  deliverableCount: number;
  inboundDeals: number;
  outboundDeals: number;
  partialUnquantifiedCount: number;
};

export type MonthlyCurrencyTotal = MonthlyMoneyFacts & { currency: string };

export type MonthlySummaryGroup = MonthlyMoneyFacts & {
  counterpartyId: string;
  counterpartyName: string;
  currency: string;
};

export type MonthlyDealSummary = {
  version: 1;
  asOf: string;
  month: string;
  integrityAttentionCount: number;
  totals: MonthlyCurrencyTotal[];
  groups: MonthlySummaryGroup[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const MONEY = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid monthly summary response');
  const found = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) {
    throw new Error('invalid monthly summary response');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('invalid monthly summary response');
  return value as number;
}

function money(value: unknown): string {
  if (typeof value !== 'string' || !MONEY.test(value)) throw new Error('invalid monthly summary response');
  return value;
}

function cents(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('invalid monthly summary response');
  }
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid monthly summary response');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    throw new Error('invalid monthly summary response');
  }
  return value;
}

function parseFacts(raw: Record<string, unknown>): MonthlyMoneyFacts {
  const contracted = money(raw.contracted);
  const confirmedReceived = money(raw.confirmed_received);
  const outstanding = money(raw.outstanding);
  const dealCount = integer(raw.deal_count);
  const inboundDeals = integer(raw.inbound_deals);
  const outboundDeals = integer(raw.outbound_deals);
  if (cents(confirmedReceived) + cents(outstanding) !== cents(contracted) || inboundDeals + outboundDeals !== dealCount) {
    throw new Error('invalid monthly summary response');
  }
  return {
    contracted,
    confirmedReceived,
    outstanding,
    dealCount,
    deliverableCount: integer(raw.deliverable_count),
    inboundDeals,
    outboundDeals,
    partialUnquantifiedCount: integer(raw.partial_unquantified_count),
  };
}

export function parseMonthlyDealSummary(value: unknown): MonthlyDealSummary {
  const root = record(value, ['version', 'as_of', 'month', 'integrity_attention_count', 'totals', 'groups']);
  if (root.version !== 1) {
    throw new Error('invalid monthly summary response');
  }
  const asOf = instant(root.as_of);
  if (typeof root.month !== 'string' || !MONTH.test(root.month) || !Array.isArray(root.totals) || !Array.isArray(root.groups)
      || root.totals.length > 50 || root.groups.length > 500) {
    throw new Error('invalid monthly summary response');
  }
  const totals = root.totals.map((value): MonthlyCurrencyTotal => {
    const row = record(value, ['currency', 'contracted', 'confirmed_received', 'outstanding', 'deal_count', 'deliverable_count', 'inbound_deals', 'outbound_deals', 'partial_unquantified_count']);
    if (typeof row.currency !== 'string' || !CURRENCY.test(row.currency)) throw new Error('invalid monthly summary response');
    return { currency: row.currency, ...parseFacts(row) };
  });
  const groups = root.groups.map((value): MonthlySummaryGroup => {
    const row = record(value, ['counterparty_id', 'counterparty_name', 'currency', 'contracted', 'confirmed_received', 'outstanding', 'deal_count', 'deliverable_count', 'inbound_deals', 'outbound_deals', 'partial_unquantified_count']);
    if (typeof row.counterparty_id !== 'string' || !UUID.test(row.counterparty_id)
        || typeof row.currency !== 'string' || !CURRENCY.test(row.currency)) throw new Error('invalid monthly summary response');
    return {
      counterpartyId: row.counterparty_id,
      counterpartyName: text(row.counterparty_name, 160),
      currency: row.currency,
      ...parseFacts(row),
    };
  });
  if (new Set(totals.map((row) => row.currency)).size !== totals.length
      || new Set(groups.map((row) => `${row.counterpartyId}:${row.currency}`)).size !== groups.length) {
    throw new Error('invalid monthly summary response');
  }
  for (const total of totals) {
    const matching = groups.filter((row) => row.currency === total.currency);
    if (matching.length === 0) throw new Error('invalid monthly summary response');
    const sumMoney = (field: 'contracted' | 'confirmedReceived' | 'outstanding') => matching.reduce((value, row) => value + cents(row[field]), 0n);
    const sumCount = (field: 'dealCount' | 'deliverableCount' | 'inboundDeals' | 'outboundDeals' | 'partialUnquantifiedCount') => matching.reduce((value, row) => value + BigInt(row[field]), 0n);
    if (sumMoney('contracted') !== cents(total.contracted) || sumMoney('confirmedReceived') !== cents(total.confirmedReceived)
        || sumMoney('outstanding') !== cents(total.outstanding) || sumCount('dealCount') !== BigInt(total.dealCount)
        || sumCount('deliverableCount') !== BigInt(total.deliverableCount) || sumCount('inboundDeals') !== BigInt(total.inboundDeals)
        || sumCount('outboundDeals') !== BigInt(total.outboundDeals)
        || sumCount('partialUnquantifiedCount') !== BigInt(total.partialUnquantifiedCount)) {
      throw new Error('invalid monthly summary response');
    }
  }
  if (groups.some((row) => !totals.some((total) => total.currency === row.currency))) throw new Error('invalid monthly summary response');
  return {
    version: 1,
    asOf,
    month: root.month,
    integrityAttentionCount: integer(root.integrity_attention_count),
    totals,
    groups,
  };
}

export function shiftUtcMonth(month: string, offset: number): string {
  if (!MONTH.test(month) || !Number.isSafeInteger(offset)) throw new Error('invalid month');
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export class MonthlySummaryContextFence {
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
