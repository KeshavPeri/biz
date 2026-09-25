import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { PaymentCurrencyCard, PaymentDashboardCard } from '@/components/tracker/payment-dashboard-card';
import { PaymentDashboardFilters } from '@/components/tracker/payment-dashboard-filters';
import { Button, ButtonText } from '@/components/ui/button';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchPaymentDashboard } from '@/lib/payment-dashboard';
import {
  DEFAULT_PAYMENT_FILTERS, PaymentDashboardContextFence, paymentFilterKey,
  summarizePaymentRows, type PaymentDashboardFilters as Filters,
  type PaymentDashboardPage, type PaymentDashboardRow,
} from '@/lib/payment-dashboard-state';
import { useAuthStore } from '@/store/auth-store';

export default function PaymentDashboardScreen() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const fence = useRef(new PaymentDashboardContextFence()).current;
  const rowsRef = useRef<PaymentDashboardRow[]>([]);
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [filters, setFilters] = useState<Filters>(DEFAULT_PAYMENT_FILTERS);
  const [page, setPage] = useState<PaymentDashboardPage | null>(null);
  const [rows, setRows] = useState<PaymentDashboardRow[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = `${userId ?? ''}:${paymentFilterKey(filters)}`;
  fence.switchContext(context);
  const visible = ownerId === userId ? page : null;
  const totals = useMemo(() => summarizePaymentRows(rows), [rows]);

  useEffect(() => {
    rowsRef.current = [];
    setFilters(DEFAULT_PAYMENT_FILTERS); setPage(null); setRows([]); setOwnerId(null); setError(null);
    setLoading(Boolean(userId));
  }, [userId]);

  const load = useCallback(async (requested: Filters, cursor: string | null, append: boolean) => {
    if (!userId) { setLoading(false); return; }
    const requestedContext = `${userId}:${paymentFilterKey(requested)}`;
    const ticket = fence.begin(requestedContext);
    if (!append) setLoading(true); else setLoadingMore(true);
    const result = await fetchPaymentDashboard(requested, cursor);
    if (!fence.isCurrent(ticket)) return;
    if (!result.ok || paymentFilterKey(result.data.filters) !== paymentFilterKey(requested)) {
      if (!append) { rowsRef.current = []; setPage(null); setRows([]); setOwnerId(null); }
      setError(result.ok ? 'Could not validate payment history. Please try again.' : result.message);
    } else {
      const nextRows = append ? [...rowsRef.current, ...result.data.rows] : result.data.rows;
      if (new Set(nextRows.map((row) => row.obligationId)).size !== nextRows.length) {
        setError('Could not validate payment history. Please refresh.');
      } else {
        rowsRef.current = nextRows;
        setPage(result.data); setRows(nextRows); setOwnerId(userId); setError(null);
      }
    }
    setLoading(false); setLoadingMore(false);
  }, [fence, userId]);

  useFocusEffect(useCallback(() => {
    void load(filters, null, false);
    return () => fence.invalidate();
  }, [fence, filters, load]));

  const apply = useCallback((next: Filters) => {
    rowsRef.current = [];
    setFilters(next); setPage(null); setRows([]); setOwnerId(null); setError(null);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true); await load(filters, null, false); setRefreshing(false);
  }, [filters, load]);

  const loadMore = useCallback(async () => {
    if (visible?.nextCursor && !loadingMore) await load(filters, visible.nextCursor, true);
  }, [filters, load, loadingMore, visible?.nextCursor]);

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <DetailHeader title="Payments" scrolled={scrolled} onBack={() => router.back()} />
      <Animated.ScrollView
        className="flex-1"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerClassName="gap-4 px-4 pb-10"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}
      >
        <View className="gap-2 pt-1">
          <Text className="font-geist-bold text-display text-ink">Payment history</Text>
          <Text className="font-geist text-secondary text-ink-3">Off-platform tracking only. Inflo does not transfer, verify or recover money.</Text>
          {visible ? <Text className="font-geist text-micro text-ink-3">Server snapshot · {new Date(visible.asOf).toLocaleString()}</Text> : null}
        </View>
        {visible ? <PaymentDashboardFilters filters={filters} deals={visible.filterOptions.deals} counterparties={visible.filterOptions.counterparties} onApply={apply} /> : null}
        {error ? (
          <View accessibilityRole="alert" className="flex-row items-center gap-3 rounded-panel bg-surface-recess px-3 py-2.5">
            <Text className="min-w-0 flex-1 font-geist text-micro text-status-critical">{error}</Text>
            <Button action="secondary" onPress={() => void load(filters, null, false)}><ButtonText>Retry</ButtonText></Button>
          </View>
        ) : null}
        {visible && totals.length > 0 ? (
          <View className="gap-3">
            <Text className="font-geist-semibold text-title text-ink">Loaded currency facts</Text>
            <Text className="font-geist text-micro text-ink-3">Currencies stay separate. Facts expand exactly as more history loads.</Text>
            <View className="flex-row flex-wrap gap-3">{totals.map((total) => <PaymentCurrencyCard key={total.currency} total={total} />)}</View>
          </View>
        ) : null}
        {visible && rows.length > 0 ? (
          <View className="gap-3">
            <Text className="font-geist-semibold text-title text-ink">Obligations</Text>
            {rows.map((row) => <PaymentDashboardCard key={row.obligationId} row={row} viewerKind={visible.viewerKind} onPress={() => router.push(`/deal/${row.sourceDealId}`)} />)}
            {visible.nextCursor ? <Button action="secondary" isDisabled={loadingMore} onPress={() => void loadMore()}><ButtonText>{loadingMore ? 'Loading…' : 'Load more'}</ButtonText></Button> : <Text className="text-center font-geist text-micro text-ink-3">Full filtered history loaded.</Text>}
          </View>
        ) : visible && !loading ? (
          <EmptyState
            title={paymentFilterKey(filters) === paymentFilterKey(DEFAULT_PAYMENT_FILTERS) ? 'No payment obligations yet' : 'No payments match'}
            description={paymentFilterKey(filters) === paymentFilterKey(DEFAULT_PAYMENT_FILTERS) ? 'Payment obligations appear here when a deal reaches Payment.' : 'Reset filters to see the full participant-safe history.'}
            actionLabel={paymentFilterKey(filters) === paymentFilterKey(DEFAULT_PAYMENT_FILTERS) ? undefined : 'Reset filters'}
            onAction={paymentFilterKey(filters) === paymentFilterKey(DEFAULT_PAYMENT_FILTERS) ? undefined : () => apply(DEFAULT_PAYMENT_FILTERS)}
          />
        ) : loading ? (
          <View className="gap-2 py-6"><Text className="font-geist-semibold text-title text-ink">Loading payment history…</Text><Text className="font-geist text-secondary text-ink-3">Checking current participation and exact obligations.</Text></View>
        ) : !error ? (
          <EmptyState title="Payment history couldn’t load" description="Please try again." actionLabel="Try again" onAction={() => void load(filters, null, false)} />
        ) : null}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
