import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { MonthlyCurrencyCard, MonthlyGroupCard } from '@/components/tracker/monthly-summary-card';
import { Button, ButtonText } from '@/components/ui/button';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchMonthlyDealSummary } from '@/lib/monthly-summary';
import {
  MonthlySummaryContextFence, shiftUtcMonth, type MonthlyDealSummary,
} from '@/lib/monthly-summary-state';
import { useAuthStore } from '@/store/auth-store';

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}T00:00:00Z`));
}

export default function MonthlySummaryScreen() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const fence = useRef(new MonthlySummaryContextFence()).current;
  const selectedMonth = useRef<string | null>(null);
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [summary, setSummary] = useState<MonthlyDealSummary | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  fence.switchContext(userId ?? '');
  const visible = ownerId === userId ? summary : null;

  useEffect(() => {
    selectedMonth.current = null;
    setSummary(null); setOwnerId(null); setError(null); setLoading(Boolean(userId));
  }, [userId]);

  const load = useCallback(async (month: string | null) => {
    if (!userId) { setLoading(false); return; }
    const ticket = fence.begin(userId);
    setLoading(true);
    const result = await fetchMonthlyDealSummary(month);
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) {
      selectedMonth.current = result.data.month;
      setSummary(result.data); setOwnerId(userId); setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [fence, userId]);

  useFocusEffect(useCallback(() => {
    void load(selectedMonth.current);
    return () => fence.invalidate();
  }, [fence, load]));

  const refresh = useCallback(async () => {
    setRefreshing(true); await load(visible?.month ?? null); setRefreshing(false);
  }, [load, visible?.month]);

  const currentMonth = visible?.asOf.slice(0, 7).concat('-01') ?? null;
  const navigateMonth = (offset: number) => {
    if (visible) void load(shiftUtcMonth(visible.month, offset));
  };

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <DetailHeader title="Monthly summary" scrolled={scrolled} onBack={() => router.back()} />
      <Animated.ScrollView
        className="flex-1"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerClassName="gap-4 px-4 pb-10"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}
      >
        {visible ? (
          <>
            <View className="gap-3 pt-1">
              <Text className="font-geist-bold text-display text-ink">{monthLabel(visible.month)}</Text>
              <Text className="font-geist text-micro text-ink-3">UTC contract month · snapshot {new Date(visible.asOf).toLocaleString()}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button action="secondary" accessibilityLabel="Previous month" onPress={() => navigateMonth(-1)} className="flex-1"><ButtonText>Previous</ButtonText></Button>
                <Button action="secondary" accessibilityLabel="Current UTC month" isDisabled={visible.month === currentMonth} onPress={() => { if (currentMonth) void load(currentMonth); }} className="flex-1"><ButtonText>Current</ButtonText></Button>
                <Button action="secondary" accessibilityLabel="Next month" onPress={() => navigateMonth(1)} className="flex-1"><ButtonText>Next</ButtonText></Button>
              </View>
            </View>
            {error ? (
              <View accessibilityRole="alert" className="flex-row items-center gap-3 rounded-panel bg-surface-recess px-3 py-2.5">
                <Text className="min-w-0 flex-1 font-geist text-micro text-status-critical">{error}</Text>
                <Button action="secondary" onPress={() => void load(visible.month)}><ButtonText>Retry</ButtonText></Button>
              </View>
            ) : null}
            {visible.integrityAttentionCount > 0 ? (
              <View accessibilityRole="alert" className="rounded-panel border border-status-critical/20 bg-surface-card p-3">
                <Text className="font-geist-semibold text-secondary text-status-critical">Some records need attention</Text>
                <Text className="mt-1 font-geist text-micro text-ink-3">{visible.integrityAttentionCount} deal{visible.integrityAttentionCount === 1 ? '' : 's'} could not be safely included in financial totals.</Text>
              </View>
            ) : null}
            {visible.totals.length > 0 ? (
              <View className="gap-3">
                <Text className="font-geist-semibold text-title text-ink">Currency totals</Text>
                {visible.totals.map((total) => <MonthlyCurrencyCard key={total.currency} total={total} />)}
              </View>
            ) : null}
            {visible.groups.length > 0 ? (
              <View className="gap-3">
                <Text className="font-geist-semibold text-title text-ink">By counterparty</Text>
                {visible.groups.map((group) => <MonthlyGroupCard key={`${group.counterpartyId}:${group.currency}`} group={group} />)}
              </View>
            ) : (
              <EmptyState title="No executed deals this month" description="Deals appear here in the UTC month when their contract was fully executed." />
            )}
          </>
        ) : loading ? (
          <View className="gap-3 pt-4">
            <Text className="font-geist-semibold text-title text-ink">Loading monthly summary…</Text>
            <Text className="font-geist text-secondary text-ink-3">Checking executed contracts and confirmed receipts.</Text>
          </View>
        ) : (
          <EmptyState title="Monthly summary couldn’t load" description={error ?? 'Please try again.'} actionLabel="Try again" onAction={() => void load(null)} />
        )}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
