import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationCard } from '@/components/notifications/notification-card';
import { useNotificationBadgeState } from '@/lib/notification-badge-state';
import { subscribeNotificationHints } from '@/lib/notification-live';
import {
  appendNotificationPage, groupNotifications, NotificationContextFence, reconcileVerifiedRead, shouldMarkNotificationRead,
  type DealSource, type NotificationCursor, type NotificationOrder, type NotificationRow,
} from '@/lib/notification-state';
import { fetchDealSources, fetchNotificationById, fetchNotificationPage, fetchUnreadCount, markNotificationRead, resolveDealSource } from '@/lib/notifications';
import { useAuthStore } from '@/store/auth-store';

const loadError = 'Could not load notifications. Check your connection and retry.';
type Item = { kind: 'header'; key: string; title: string } | { kind: 'row'; key: string; row: NotificationRow; source: DealSource | null };

export default function NotificationsScreen() {
  const session = useAuthStore((state) => state.session);
  const accountId = session?.user.id ?? null;
  const token = session?.access_token ?? '';
  const [order, setOrder] = useState<NotificationOrder>('newest');
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, DealSource>>({});
  const [next, setNext] = useState<NotificationCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<Set<string>>(new Set());
  const badgeOwner = useNotificationBadgeState((state) => state.ownerId);
  const badgeCount = useNotificationBadgeState((state) => state.count);
  const setBadge = useNotificationBadgeState((state) => state.set);
  const fence = useRef(new NotificationContextFence()).current;
  const badgeFence = useRef(new NotificationContextFence()).current;
  const rowsRef = useRef<NotificationRow[]>([]);
  const sourcesRef = useRef<Record<string, DealSource>>({});
  const inflightRead = useRef(new Set<string>());
  const attemptedRead = useRef(new Set<string>());
  const active = useRef(false);
  const key = `${accountId ?? ''}:${token}:${order}`;
  fence.switchContext(key);
  badgeFence.switchContext(key);
  const visibleRows = useMemo(() => ownerId === accountId ? rows : [], [ownerId, accountId, rows]);
  const visibleSources = useMemo(() => ownerId === accountId ? sources : {}, [ownerId, accountId, sources]);
  const unreadCount = badgeOwner === accountId ? badgeCount : null;

  useEffect(() => {
    rowsRef.current = []; sourcesRef.current = {}; inflightRead.current.clear(); attemptedRead.current.clear();
    setRows([]); setSources({}); setOwnerId(null); setNext(null); setLoaded(false); setError(null); setReadErrors(new Set());
  }, [accountId, token, order]);

  const refreshCount = useCallback(async (generation: number) => {
    if (!accountId) return;
    const result = await fetchUnreadCount(accountId);
    if (active.current && badgeFence.isCurrent(key, generation)) setBadge(accountId, result.ok ? result.data : null);
  }, [accountId, badgeFence, key, setBadge]);

  const load = useCallback(async (cursor: NotificationCursor | null = null) => {
    if (!accountId) return;
    const append = cursor !== null;
    const generation = fence.begin();
    const badgeGeneration = badgeFence.begin();
    if (append) setMoreLoading(true); else setLoading(true);
    setError(null);
    const result = await fetchNotificationPage(accountId, order, cursor);
    if (!fence.isCurrent(key, generation)) return;
    if (!result.ok) {
      setError(loadError); setLoading(false); setMoreLoading(false); setRefreshing(false); return;
    }
    const page = result.data.rows;
    const names = await fetchDealSources(page.flatMap((row) => row.dealId ? [row.dealId] : []));
    if (!fence.isCurrent(key, generation)) return;
    const merged = append ? appendNotificationPage(rowsRef.current, page) : page;
    rowsRef.current = merged;
    sourcesRef.current = { ...(append ? sourcesRef.current : {}), ...(names.ok ? names.data : {}) };
    setRows(merged); setSources(sourcesRef.current); setOwnerId(accountId);
    setNext(result.data.next); setLoaded(true); setLoading(false); setMoreLoading(false); setRefreshing(false);
    void refreshCount(badgeGeneration);
  }, [accountId, badgeFence, fence, key, order, refreshCount]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    void load();
    const stop = accountId ? subscribeNotificationHints(accountId, token, () => { void load(); }) : () => {};
    return () => { active.current = false; stop(); fence.invalidate(); badgeFence.invalidate(); };
  }, [accountId, token, badgeFence, fence, load]));

  const markVisible = useCallback(async (row: NotificationRow, retry = false) => {
    if (!accountId || !shouldMarkNotificationRead(row, accountId, true, active.current,
        inflightRead.current.has(row.id) || (!retry && attemptedRead.current.has(row.id)))) return;
    const currentKey = key;
    attemptedRead.current.add(row.id); inflightRead.current.add(row.id);
    const result = await markNotificationRead(row.id);
    if (!active.current || !fence.isContextCurrent(currentKey)) { inflightRead.current.delete(row.id); return; }
    if (!result.ok || !result.data) {
      inflightRead.current.delete(row.id);
      setReadErrors((old) => new Set(old).add(row.id));
      return;
    }
    // Reconcile this loaded row in place, so oldest-unread pages do not jump
    // back to page one each time a viewed card is acknowledged.
    const badgeGeneration = badgeFence.begin();
    const [verified, countResult] = await Promise.all([
      fetchNotificationById(accountId, row.id), fetchUnreadCount(accountId),
    ]);
    inflightRead.current.delete(row.id);
    if (!active.current || !fence.isContextCurrent(currentKey)) return;
    if (badgeFence.isCurrent(currentKey, badgeGeneration)) {
      setBadge(accountId, countResult.ok ? countResult.data : null);
    }
    if (!verified.ok || !verified.data.read) {
      setReadErrors((old) => new Set(old).add(row.id));
      return;
    }
    rowsRef.current = reconcileVerifiedRead(rowsRef.current, verified.data);
    setRows(rowsRef.current);
    setReadErrors((old) => { const updated = new Set(old); updated.delete(row.id); return updated; });
  }, [accountId, badgeFence, fence, key, setBadge]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    for (const item of viewableItems) {
      const entry = item.item;
      if (item.isViewable && entry.kind === 'row') {
        const latest = rowsRef.current.find((row) => row.id === entry.row.id);
        if (latest && !latest.read) void markRef.current(latest);
      }
    }
  }).current;
  const markRef = useRef(markVisible);
  markRef.current = markVisible;
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60, minimumViewTime: 250 }).current;

  const openSource = useCallback(async (row: NotificationRow) => {
    if (!accountId || !row.dealId || !visibleSources[row.dealId]) return;
    const source = await resolveDealSource(row.dealId);
    if (!active.current || !fence.isContextCurrent(key)) return;
    if (source) router.push(`/deal/${source.id}`);
    else {
      const replacement = { ...sourcesRef.current }; delete replacement[row.dealId];
      sourcesRef.current = replacement; setSources(replacement);
    }
  }, [accountId, fence, key, visibleSources]);

  const items = useMemo<Item[]>(() => groupNotifications(visibleRows, visibleSources).flatMap((group) => [
    { kind: 'header' as const, key: `header:${group.key}`, title: group.title },
    ...group.rows.map((row) => ({ kind: 'row' as const, key: row.id, row, source: group.source })),
  ]), [visibleRows, visibleSources]);

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between border-b border-hairline px-4 py-1">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="h-11 min-w-11 justify-center"><Text className="font-geist-semibold text-secondary text-ink">Back</Text></Pressable>
        <Text className="font-geist-semibold text-subtitle text-ink">Notifications</Text>
        <View className="w-11" />
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Text className="font-geist text-secondary text-ink-2">{unreadCount === null ? 'Unread count unavailable' : `${unreadCount} unread`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh notifications" onPress={() => { setRefreshing(true); void load(); }} className="min-h-11 justify-center px-3"><Text className="font-geist-semibold text-secondary text-ink">Refresh</Text></Pressable>
      </View>
      <View className="flex-row gap-2 px-4 pb-3">
        <Pressable accessibilityRole="button" accessibilityState={{ selected: order === 'newest' }} onPress={() => setOrder('newest')} className={`min-h-11 justify-center rounded-pill px-4 ${order === 'newest' ? 'bg-ink' : 'bg-surface-recess'}`}><Text className={order === 'newest' ? 'font-geist-semibold text-white' : 'font-geist-semibold text-ink'}>Newest</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: order === 'oldest-unread' }} onPress={() => setOrder('oldest-unread')} className={`min-h-11 justify-center rounded-pill px-4 ${order === 'oldest-unread' ? 'bg-ink' : 'bg-surface-recess'}`}><Text className={order === 'oldest-unread' ? 'font-geist-semibold text-white' : 'font-geist-semibold text-ink'}>Oldest unread</Text></Pressable>
      </View>
      {error ? <View className="mx-4 mb-3 rounded-panel bg-surface-recess p-3"><Text accessibilityRole="alert" className="font-geist text-secondary text-status-critical">{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} className="min-h-11 justify-center"><Text className="font-geist-semibold text-secondary text-ink">Retry</Text></Pressable></View> : null}
      <FlatList data={items} keyExtractor={(item) => item.key} className="flex-1" contentContainerClassName="gap-3 px-4 pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor="#847F78" />}
        onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => item.kind === 'header'
          ? <Text className="mt-2 font-geist-semibold text-title text-ink">{item.title}</Text>
          : <NotificationCard row={item.row} source={item.source} readError={readErrors.has(item.row.id)} onOpen={() => void openSource(item.row)} onRetryRead={() => void markVisible(item.row, true)} />}
        ListEmptyComponent={loading && !loaded ? <View className="items-center py-8"><ActivityIndicator color="#847F78" /><Text className="mt-2 font-geist text-secondary text-ink-2">Loading alerts…</Text></View>
          : loaded && !error ? <Text className="py-8 text-center font-geist text-secondary text-ink-2">No alerts here yet.</Text> : null}
        ListFooterComponent={loaded ? next
          ? <Pressable accessibilityRole="button" disabled={moreLoading} onPress={() => void load(next)} className="min-h-11 items-center justify-center rounded-pill bg-surface-recess"><Text className="font-geist-semibold text-secondary text-ink">{moreLoading ? 'Loading…' : 'Load more'}</Text></Pressable>
          : items.length ? <Text className="py-4 text-center font-geist text-micro text-ink-3">End of alerts</Text> : null : null}
      />
    </SafeAreaView>
  );
}
