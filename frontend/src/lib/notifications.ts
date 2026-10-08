import { supabase } from './supabase';
import {
  isUuid, NOTIFICATION_PAGE_SIZE, notificationCursorFilter, pageCursor, parseNotification, parseReadableDealSources,
  type DealSource, type NotificationCursor, type NotificationOrder, type NotificationRow,
} from './notification-state';

export type NotificationResult<T> = { ok: true; data: T } | { ok: false; message: string };
const unavailable = 'Notifications are unavailable. Check your connection and try again.';
const SELECT = 'id, profile_id, tier, title, body, deal_id, read, created_at';

export async function fetchUnreadCount(accountId: string): Promise<NotificationResult<number>> {
  if (!supabase || !isUuid(accountId)) return { ok: false, message: unavailable };
  try {
    const { count, error } = await supabase.from('notifications').select('id', { head: true, count: 'exact' })
      .eq('profile_id', accountId).eq('read', false);
    return error || count === null || !Number.isSafeInteger(count) || count < 0
      ? { ok: false, message: unavailable } : { ok: true, data: count };
  } catch { return { ok: false, message: unavailable }; }
}

export async function fetchNotificationPage(accountId: string, order: NotificationOrder, cursor: NotificationCursor | null): Promise<NotificationResult<{ rows: NotificationRow[]; next: NotificationCursor | null }>> {
  if (!supabase || !isUuid(accountId)) return { ok: false, message: unavailable };
  try {
    const ascending = order === 'oldest-unread';
    let query = supabase.from('notifications').select(SELECT).eq('profile_id', accountId);
    if (ascending) query = query.eq('read', false);
    if (cursor) {
      query = query.or(notificationCursorFilter(order, cursor));
    }
    const { data, error } = await query.order('created_at', { ascending }).order('id', { ascending }).limit(NOTIFICATION_PAGE_SIZE + 1);
    if (error || !Array.isArray(data)) throw new Error('Query failed');
    const parsed = data.map((row) => parseNotification(row, accountId));
    const rows = parsed.slice(0, NOTIFICATION_PAGE_SIZE);
    return { ok: true, data: { rows, next: parsed.length > NOTIFICATION_PAGE_SIZE ? pageCursor(rows) : null } };
  } catch { return { ok: false, message: unavailable }; }
}

export async function fetchDealSources(ids: string[]): Promise<NotificationResult<Record<string, DealSource>>> {
  if (!supabase) return { ok: false, message: unavailable };
  const unique = [...new Set(ids.filter(isUuid))].slice(0, NOTIFICATION_PAGE_SIZE);
  if (!unique.length) return { ok: true, data: {} };
  try {
    const { data, error } = await supabase.from('deals').select('id, deal_name, deleted_at')
      .in('id', unique).is('deleted_at', null);
    if (error) throw new Error('Lookup failed');
    return { ok: true, data: parseReadableDealSources(data, unique) };
  } catch { return { ok: false, message: unavailable }; }
}

export async function resolveDealSource(id: string): Promise<DealSource | null> {
  const result = await fetchDealSources([id]);
  return result.ok ? result.data[id] ?? null : null;
}

export async function fetchNotificationById(accountId: string, id: string): Promise<NotificationResult<NotificationRow>> {
  if (!supabase || !isUuid(accountId) || !isUuid(id)) return { ok: false, message: unavailable };
  try {
    const { data, error } = await supabase.from('notifications').select(SELECT)
      .eq('profile_id', accountId).eq('id', id).single();
    if (error || !data) throw new Error('Lookup failed');
    return { ok: true, data: parseNotification(data, accountId) };
  } catch { return { ok: false, message: unavailable }; }
}

export async function markNotificationRead(id: string): Promise<NotificationResult<boolean>> {
  if (!supabase || !isUuid(id)) return { ok: false, message: unavailable };
  try {
    const { data, error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
    return error || typeof data !== 'boolean' ? { ok: false, message: unavailable } : { ok: true, data };
  } catch { return { ok: false, message: unavailable }; }
}
