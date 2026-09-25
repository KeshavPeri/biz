export const USAGE_RIGHTS_STATUSES = ['none', 'perpetual', 'active', 'expiring', 'expired', 'unavailable'] as const;
export type UsageRightsStatus = (typeof USAGE_RIGHTS_STATUSES)[number];
export type UsageRightsPresence = 'none' | 'present' | 'unavailable';

export type UsageRightsDeal = {
  dealId: string; dealName: string; counterpartyName: string; direction: 'inbound' | 'outbound'; stage: string;
  rightsPresence: UsageRightsPresence; channels: string[]; startDate: string | null; endDate: string | null;
  isPerpetual: boolean; status: UsageRightsStatus; dealPath: string;
};
export type UsageRightsSnapshot = { version: 1; asOf: string; deals: UsageRightsDeal[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const STAGES = ['creating', 'posted', 'payment', 'closed'] as const;

function invalid(): never { throw new Error('invalid usage rights response'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort(); const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function date(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) || date(value.slice(0, 10)) === null) invalid();
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T)) invalid(); return value as T; }

function deal(value: unknown): UsageRightsDeal {
  const row = record(value, ['deal_id', 'deal_name', 'counterparty_name', 'direction', 'stage', 'rights_presence', 'channels', 'start_date', 'end_date', 'is_perpetual', 'status', 'deal_path']);
  const dealId = uuid(row.deal_id); const presence = oneOf(row.rights_presence, ['none', 'present', 'unavailable']);
  const channels = Array.isArray(row.channels) && row.channels.length <= 50 ? row.channels.map((item) => text(item, 100)) : invalid();
  if (new Set(channels).size !== channels.length) invalid();
  const startDate = date(row.start_date, true); const endDate = date(row.end_date, true); const isPerpetual = bool(row.is_perpetual);
  const status = oneOf(row.status, USAGE_RIGHTS_STATUSES);
  if (row.deal_path !== `/deal/${dealId}` || presence === 'none' && (channels.length || startDate || endDate || isPerpetual || status !== 'none')
    || presence === 'unavailable' && (channels.length || startDate || endDate || isPerpetual || status !== 'unavailable')
    || presence === 'present' && (!channels.length || !startDate || (isPerpetual ? endDate !== null || status !== 'perpetual' : !endDate || startDate > endDate || !['active', 'expiring', 'expired'].includes(status)))) invalid();
  return { dealId, dealName: text(row.deal_name, 160), counterpartyName: text(row.counterparty_name, 160), direction: oneOf(row.direction, ['inbound', 'outbound']), stage: oneOf(row.stage, STAGES), rightsPresence: presence, channels, startDate, endDate, isPerpetual, status, dealPath: row.deal_path as string };
}

export function parseUsageRightsSnapshot(value: unknown): UsageRightsSnapshot {
  const root = record(value, ['version', 'as_of', 'deals']);
  if (root.version !== 1 || !Array.isArray(root.deals) || root.deals.length > 100) invalid();
  const deals = root.deals.map(deal);
  if (new Set(deals.map((item) => item.dealId)).size !== deals.length) invalid();
  // Server ordering is deterministic, but Unicode case folding is not identical
  // across Python and JavaScript runtimes. Preserve the server order rather than
  // rejecting an otherwise safe, canonical snapshot on a device locale boundary.
  return { version: 1, asOf: instant(root.as_of), deals };
}

export class UsageRightsContextFence {
  private context = ''; private generation = 0;
  switchContext(context: string) { if (this.context !== context) { this.context = context; this.generation += 1; } }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; }
}
