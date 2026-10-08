export type NotificationTier = 'critical' | 'important' | 'informational';
export type NotificationOrder = 'newest' | 'oldest-unread';
export type NotificationRow = {
  id: string; profileId: string; tier: NotificationTier; title: string; body: string;
  dealId: string | null; read: boolean; createdAt: string;
};
export type NotificationCursor = { createdAt: string; id: string };
export type DealSource = { id: string; name: string };
export type NotificationGroup = { key: string; title: string; source: DealSource | null; rows: NotificationRow[] };

export const NOTIFICATION_PAGE_SIZE = 50;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

export function parseNotification(value: unknown, accountId: string): NotificationRow {
  if (!isRecord(value) || !isUuid(value.id) || value.profile_id !== accountId ||
      !['critical', 'important', 'informational'].includes(String(value.tier)) ||
      typeof value.title !== 'string' || typeof value.body !== 'string' ||
      value.title.length > 2000 || value.body.length > 10000 ||
      (value.deal_id !== null && !isUuid(value.deal_id)) || typeof value.read !== 'boolean' ||
      typeof value.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.created_at) ||
      Number.isNaN(Date.parse(value.created_at))) {
    throw new Error('Invalid notification data');
  }
  return {
    id: value.id, profileId: accountId, tier: value.tier as NotificationTier,
    title: value.title, body: value.body, dealId: value.deal_id,
    read: value.read, createdAt: value.created_at,
  };
}

export function notificationCursorFilter(order: NotificationOrder, cursor: NotificationCursor): string {
  if (!isUuid(cursor.id) || typeof cursor.createdAt !== 'string' || Number.isNaN(Date.parse(cursor.createdAt))) throw new Error('Invalid cursor');
  const op = order === 'oldest-unread' ? 'gt' : 'lt';
  return `created_at.${op}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${op}.${cursor.id})`;
}

export function notificationHintMatches(accountId: string, eventType: string, row: unknown): boolean {
  return isUuid(accountId) && ['INSERT', 'UPDATE'].includes(eventType) && isRecord(row) && row.profile_id === accountId;
}

export function shouldMarkNotificationRead(row: NotificationRow, accountId: string, isVisible: boolean, active: boolean, attempted: boolean): boolean {
  return active && isVisible && !row.read && row.profileId === accountId && !attempted;
}

export function pageCursor(rows: NotificationRow[]): NotificationCursor | null {
  const last = rows.at(-1);
  return last ? { createdAt: last.createdAt, id: last.id } : null;
}

export function appendNotificationPage(current: NotificationRow[], page: NotificationRow[]): NotificationRow[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...page.filter((row) => !seen.has(row.id))];
}

export function reconcileVerifiedRead(rows: NotificationRow[], verified: NotificationRow): NotificationRow[] {
  if (!verified.read) return rows;
  return rows.map((row) => row.id === verified.id && row.profileId === verified.profileId ? verified : row);
}

export function parseReadableDealSources(values: unknown, requestedIds: string[]): Record<string, DealSource> {
  if (!Array.isArray(values)) throw new Error('Invalid deal source data');
  const requested = new Set(requestedIds.filter(isUuid));
  const sources: Record<string, DealSource> = {};
  for (const value of values) {
    if (!isRecord(value) || !isUuid(value.id) || !requested.has(value.id) ||
        value.deleted_at !== null || typeof value.deal_name !== 'string') continue;
    sources[value.id] = { id: value.id, name: value.deal_name.trim() || 'Deal' };
  }
  return sources;
}

export function groupNotifications(rows: NotificationRow[], sources: Record<string, DealSource>): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const row of rows) {
    const source = row.dealId ? sources[row.dealId] ?? null : null;
    const key = source?.id ?? 'general';
    let group = groups.get(key);
    if (!group) {
      group = { key, title: source?.name ?? 'General / Unavailable source', source, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

export function notificationBadge(count: number | null): string | null {
  return count === null || count === 0 ? null : count > 99 ? '99+' : String(count);
}
export function notificationBadgeLabel(count: number | null): string {
  return count === null ? 'Notifications, unread count unavailable' : `Notifications, ${count} unread`;
}

export class NotificationContextFence {
  private key = '';
  private generation = 0;
  switchContext(key: string): void { if (key !== this.key) { this.key = key; this.generation++; } }
  begin(): number { this.generation++; return this.generation; }
  isContextCurrent(key: string): boolean { return this.key === key; }
  isCurrent(key: string, generation: number): boolean { return this.key === key && this.generation === generation; }
  invalidate(): void { this.generation++; }
}

/** Serializes live subscriptions across the tab bell and centre. */
export class NotificationHintHub {
  private key: string | null = null;
  private callbacks = new Set<() => void>();
  private close: (() => void) | null = null;
  private epoch = 0;

  subscribe(key: string, callback: () => void, start: (emit: () => void) => () => void): () => void {
    if (this.key !== key) this.stop();
    this.key = key;
    this.callbacks.add(callback);
    if (!this.close) {
      const epoch = ++this.epoch;
      this.close = start(() => {
        if (this.epoch !== epoch || this.key !== key) return;
        for (const current of this.callbacks) current();
      });
    }
    const subscriptionEpoch = this.epoch;
    return () => {
      if (this.epoch !== subscriptionEpoch || this.key !== key) return;
      this.callbacks.delete(callback);
      if (!this.callbacks.size) this.stop();
    };
  }

  private stop(): void {
    this.epoch++;
    this.callbacks.clear();
    this.close?.();
    this.close = null;
    this.key = null;
  }
}
