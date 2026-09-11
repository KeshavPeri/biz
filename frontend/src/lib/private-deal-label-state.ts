export type PrivateDealLabel = { id: string; dealId: string; label: string };

export const MAX_PRIVATE_DEAL_LABELS = 8;

/** Normalizes only new client input; existing rows are never rewritten. */
export function normalizePrivateDealLabel(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 32 || /[\p{Cc}\p{Cf}]/u.test(normalized)) return null;
  return normalized;
}

function compareLabels(left: string, right: string): number {
  const primary = left.localeCompare(right, undefined, { sensitivity: 'accent' });
  return primary || left.localeCompare(right);
}

/** Treat stored rows as untrusted display data and cap each deal independently. */
export function labelsByDeal(rows: PrivateDealLabel[]): Record<string, PrivateDealLabel[]> {
  const grouped: Record<string, PrivateDealLabel[]> = {};
  for (const row of rows) {
    if (!row.id || !row.dealId || normalizePrivateDealLabel(row.label) !== row.label) continue;
    const labels = grouped[row.dealId] ?? [];
    if (labels.length < MAX_PRIVATE_DEAL_LABELS && !labels.some((label) => label.label === row.label)) {
      labels.push(row);
    }
    grouped[row.dealId] = labels;
  }
  return grouped;
}

export function distinctPrivateDealLabels(labels: Record<string, PrivateDealLabel[]>): string[] {
  return [...new Set(Object.values(labels).flat().map((row) => row.label))].sort(compareLabels);
}

export function filterDealsByPrivateLabel<T extends { dealId: string }>(
  deals: T[], labels: Record<string, PrivateDealLabel[]>, selected: string | null,
): T[] {
  if (!selected) return deals;
  return deals.filter((deal) => labels[deal.dealId]?.some((label) => label.label === selected));
}

export type PrivateDealLabelTicket = { identity: string; generation: number };

/** Synchronously invalidates reads and writes after an account/deal context switch. */
export class PrivateDealLabelContextFence {
  private identity = '';
  private generation = 0;

  switchContext(identity: string): void {
    if (this.identity === identity) return;
    this.identity = identity;
    this.generation += 1;
  }

  begin(identity: string): PrivateDealLabelTicket {
    return { identity, generation: this.generation };
  }

  isCurrent(ticket: PrivateDealLabelTicket): boolean {
    return ticket.identity === this.identity && ticket.generation === this.generation;
  }
}
