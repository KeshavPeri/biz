export const BLACKOUT_STATUSES = ['active', 'upcoming'] as const;
export type BlackoutStatus = (typeof BLACKOUT_STATUSES)[number];
export type BlackoutTiming = 'before' | 'after' | 'both';
export type BlackoutRange = { id: string; dealId: string; dealName: string; brandName: string; timing: BlackoutTiming; durationDays: number; startDate: string; endDate: string; status: BlackoutStatus; dealPath: string };
export type BlackoutSnapshot = { version: 1; asOf: string; integrityUnavailableCount: number; ranges: BlackoutRange[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const RANGE_ID = /^blackout:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/i;
function invalid(): never { throw new Error('invalid blackout response'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); const found = Object.keys(value as object).sort(); const expected = [...keys].sort(); if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid(); return value as Record<string, unknown>; }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || !value || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function date(value: unknown): string { if (typeof value !== 'string' || !DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) invalid(); return value; }
function instant(value: unknown): string { if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) || date(value.slice(0, 10)) !== value.slice(0, 10)) invalid(); return value; }
function range(value: unknown, today: string): BlackoutRange {
  const row = record(value, ['id', 'deal_id', 'deal_name', 'brand_name', 'timing', 'duration_days', 'start_date', 'end_date', 'status', 'deal_path']);
  const id = text(row.id, 128); const match = RANGE_ID.exec(id); const dealId = uuid(row.deal_id); const startDate = date(row.start_date); const endDate = date(row.end_date);
  if (!match || match[1].toLowerCase() !== dealId.toLowerCase() || match[2] !== startDate || match[3] !== endDate || startDate > endDate || row.deal_path !== `/deal/${dealId}` || !['before', 'after', 'both'].includes(row.timing as string) || !Number.isInteger(row.duration_days) || (row.duration_days as number) < 1 || (row.duration_days as number) > 3650 || !BLACKOUT_STATUSES.includes(row.status as BlackoutStatus) || (row.status === 'active' ? !(startDate <= today && today <= endDate) : !(startDate > today))) invalid();
  return { id, dealId, dealName: text(row.deal_name, 160), brandName: text(row.brand_name, 160), timing: row.timing as BlackoutTiming, durationDays: row.duration_days as number, startDate, endDate, status: row.status as BlackoutStatus, dealPath: row.deal_path as string };
}
export function parseBlackoutSnapshot(value: unknown): BlackoutSnapshot {
  const root = record(value, ['version', 'as_of', 'integrity_unavailable_count', 'ranges']); const asOf = instant(root.as_of); const unavailable = root.integrity_unavailable_count;
  if (root.version !== 1 || !Number.isInteger(unavailable) || (unavailable as number) < 0 || (unavailable as number) > 100 || !Array.isArray(root.ranges) || root.ranges.length > 500) invalid();
  const ranges = root.ranges.map((item) => range(item, asOf.slice(0, 10)));
  if (new Set(ranges.map((item) => item.id)).size !== ranges.length) invalid();
  for (let index = 1; index < ranges.length; index += 1) { const previous = ranges[index - 1]; const current = ranges[index]; const key = (item: BlackoutRange) => `${item.status === 'active' ? '0' : '1'}|${item.startDate}|${item.endDate}|${item.dealId}|${item.id}`; if (key(previous) >= key(current)) invalid(); }
  return { version: 1, asOf, integrityUnavailableCount: unavailable as number, ranges };
}
export class BlackoutContextFence { private context = ''; private generation = 0; switchContext(context: string) { if (this.context !== context) { this.context = context; this.generation += 1; } } begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; } invalidate() { this.generation += 1; } isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; } }
