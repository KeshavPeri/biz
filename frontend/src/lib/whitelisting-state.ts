import { compareContractText, normaliseContractText } from './disclosures-state.ts';

export const WHITELISTING_PLATFORMS = ['instagram', 'linkedin', 'pinterest', 'podcast', 'threads', 'tiktok', 'x', 'youtube'] as const;
export type WhitelistingPlatform = (typeof WHITELISTING_PLATFORMS)[number];
export type WhitelistingStatus = 'active' | 'upcoming' | 'expired';
export type WhitelistingPresence = 'enabled' | 'not_enabled' | 'unavailable';
export type WhitelistingArrangement = {
  platform: WhitelistingPlatform; accountLabel: string; startDate: string; endDate: string;
  status: WhitelistingStatus; budget: null | { amount: string; currency: string };
};
export type WhitelistingDeal = {
  dealId: string; dealName: string; counterpartyName: string; direction: 'inbound' | 'outbound';
  stage: 'creating' | 'posted' | 'payment' | 'closed'; presence: WhitelistingPresence;
  arrangements: WhitelistingArrangement[]; dealPath: string;
};
export type WhitelistingSnapshot = { version: 1; asOf: string; deals: WhitelistingDeal[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const CURRENCY = /^[A-Z]{3}$/;
const STAGES = ['creating', 'posted', 'payment', 'closed'] as const;
const STATUS_RANK: Record<WhitelistingStatus, number> = { active: 0, upcoming: 1, expired: 2 };

function invalid(): never { throw new Error('invalid whitelisting response'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort(); const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, trimmed = false): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || (trimmed && value !== value.trim())) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(); return value as T;
}
function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function expectedStatus(start: string, end: string, today: string): WhitelistingStatus {
  if (today < start) return 'upcoming'; if (today > end) return 'expired'; return 'active';
}
function arrangementIdentity(row: WhitelistingArrangement): string {
  return [normaliseContractText(row.platform), normaliseContractText(row.accountLabel), row.startDate, row.endDate, row.budget?.amount ?? '', row.budget?.currency ?? ''].join('\u0000');
}
function arrangement(value: unknown, today: string): WhitelistingArrangement {
  const row = record(value, ['platform', 'account_label', 'start_date', 'end_date', 'status', 'budget']);
  const startDate = isoDate(row.start_date); const endDate = isoDate(row.end_date);
  if (startDate > endDate) invalid();
  const status = oneOf(row.status, ['active', 'upcoming', 'expired'] as const);
  if (status !== expectedStatus(startDate, endDate, today)) invalid();
  let budget: WhitelistingArrangement['budget'] = null;
  if (row.budget !== null) {
    const value = record(row.budget, ['amount', 'currency']);
    if (typeof value.amount !== 'string' || !DECIMAL.test(value.amount) || typeof value.currency !== 'string' || !CURRENCY.test(value.currency)) invalid();
    budget = { amount: value.amount, currency: value.currency };
  }
  return {
    platform: oneOf(row.platform, WHITELISTING_PLATFORMS), accountLabel: text(row.account_label, 200, true),
    startDate, endDate, status, budget,
  };
}
function compareArrangements(left: WhitelistingArrangement, right: WhitelistingArrangement): number {
  return STATUS_RANK[left.status] - STATUS_RANK[right.status]
    || compareContractText(left.startDate, right.startDate) || compareContractText(left.endDate, right.endDate)
    || compareContractText(left.platform, right.platform) || compareContractText(left.accountLabel, right.accountLabel)
    || compareContractText(left.budget?.amount ?? '', right.budget?.amount ?? '')
    || compareContractText(left.budget?.currency ?? '', right.budget?.currency ?? '');
}
function deal(value: unknown, today: string): WhitelistingDeal {
  const row = record(value, ['deal_id', 'deal_name', 'counterparty_name', 'direction', 'stage', 'presence', 'arrangements', 'deal_path']);
  if (typeof row.deal_id !== 'string' || !UUID.test(row.deal_id) || row.deal_path !== `/deal/${row.deal_id}`) invalid();
  const presence = oneOf(row.presence, ['enabled', 'not_enabled', 'unavailable'] as const);
  if (!Array.isArray(row.arrangements) || row.arrangements.length > 50) invalid();
  const arrangements = row.arrangements.map((item) => arrangement(item, today));
  if ((presence === 'enabled') !== (arrangements.length > 0)) invalid();
  if (new Set(arrangements.map(arrangementIdentity)).size !== arrangements.length) invalid();
  for (let index = 1; index < arrangements.length; index += 1) if (compareArrangements(arrangements[index - 1], arrangements[index]) >= 0) invalid();
  return {
    dealId: row.deal_id, dealName: text(row.deal_name, 160), counterpartyName: text(row.counterparty_name, 160),
    direction: oneOf(row.direction, ['inbound', 'outbound'] as const), stage: oneOf(row.stage, STAGES),
    presence, arrangements, dealPath: row.deal_path as string,
  };
}

export function parseWhitelistingSnapshot(value: unknown): WhitelistingSnapshot {
  const root = record(value, ['version', 'as_of', 'deals']);
  if (root.version !== 1 || typeof root.as_of !== 'string' || !INSTANT.test(root.as_of) || Number.isNaN(Date.parse(root.as_of)) || !Array.isArray(root.deals) || root.deals.length > 100) invalid();
  const today = new Date(root.as_of).toISOString().slice(0, 10); const deals = root.deals.map((item) => deal(item, today));
  if (new Set(deals.map((item) => item.dealId)).size !== deals.length) invalid();
  for (let index = 1; index < deals.length; index += 1) if (deals[index - 1].dealId >= deals[index].dealId) invalid();
  return { version: 1, asOf: root.as_of, deals };
}

export class WhitelistingContextFence {
  private context = ''; private generation = 0;
  switchContext(context: string) { if (this.context !== context) { this.context = context; this.generation += 1; } }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; }
}
