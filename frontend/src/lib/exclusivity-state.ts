export const EXCLUSIVITY_STATUSES = ['active', 'expiring', 'expired'] as const;
export type ExclusivityStatus = (typeof EXCLUSIVITY_STATUSES)[number];

export type ExclusivityClause = {
  dealId: string; dealName: string; brandName: string; creatorName: string; category: string;
  startDate: string; endDate: string; status: ExclusivityStatus; dealPath: string;
};
export type ExclusivitySnapshot = {
  version: 1; asOf: string; integrityUnavailableCount: number; clauses: ExclusivityClause[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const RANK: Record<ExclusivityStatus, number> = { expiring: 0, active: 1, expired: 2 };

function invalid(): never { throw new Error('invalid exclusivity response'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort(); const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || value !== value.trim()) invalid();
  return value;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function date(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) || date(value.slice(0, 10)) !== value.slice(0, 10)) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(); return value as T;
}
function expectedStatus(endDate: string, asOfDate: string): ExclusivityStatus {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const today = new Date(`${asOfDate}T00:00:00.000Z`);
  if (today > end) return 'expired';
  const firstExpiring = new Date(end); firstExpiring.setUTCDate(firstExpiring.getUTCDate() - 14);
  return today >= firstExpiring ? 'expiring' : 'active';
}
function clause(value: unknown, asOfDate: string): ExclusivityClause {
  const row = record(value, ['deal_id', 'deal_name', 'brand_name', 'creator_name', 'category', 'start_date', 'end_date', 'status', 'deal_path']);
  const dealId = uuid(row.deal_id); const startDate = date(row.start_date); const endDate = date(row.end_date);
  const status = oneOf(row.status, EXCLUSIVITY_STATUSES);
  if (row.deal_path !== `/deal/${dealId}` || startDate > endDate || status !== expectedStatus(endDate, asOfDate)) invalid();
  return {
    dealId, dealName: text(row.deal_name, 160), brandName: text(row.brand_name, 160),
    creatorName: text(row.creator_name, 160), category: text(row.category, 200), startDate, endDate,
    status, dealPath: row.deal_path as string,
  };
}

export function parseExclusivitySnapshot(value: unknown): ExclusivitySnapshot {
  const root = record(value, ['version', 'as_of', 'integrity_unavailable_count', 'clauses']);
  const asOf = instant(root.as_of); const unavailable = root.integrity_unavailable_count;
  if (root.version !== 1 || !Number.isInteger(unavailable) || (unavailable as number) < 0 || (unavailable as number) > 100
    || !Array.isArray(root.clauses) || root.clauses.length > 100) invalid();
  const clauses = root.clauses.map((item) => clause(item, asOf.slice(0, 10)));
  if (new Set(clauses.map((item) => item.dealId)).size !== clauses.length) invalid();
  for (let index = 1; index < clauses.length; index += 1) {
    const previous = clauses[index - 1]; const current = clauses[index];
    const ordered = RANK[previous.status] < RANK[current.status]
      || RANK[previous.status] === RANK[current.status] && (previous.endDate < current.endDate
        || previous.endDate === current.endDate && previous.dealId < current.dealId);
    if (!ordered) invalid();
  }
  return { version: 1, asOf, integrityUnavailableCount: unavailable as number, clauses };
}

export class ExclusivityContextFence {
  private context = ''; private generation = 0;
  switchContext(context: string) { if (this.context !== context) { this.context = context; this.generation += 1; } }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; }
}
