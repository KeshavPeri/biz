import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/motion/skeleton';
import { ListItemFade } from '@/components/motion/list-item-fade';
import { TrackerFilters } from '@/components/tracker/tracker-filters';
import { DealTrackerRow } from '@/components/tracker/tracker-row';
import { TrackerSummary } from '@/components/tracker/tracker-summary';
import { Button, ButtonText } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { fetchDealTracker } from '@/lib/tracker';
import {
  EMPTY_TRACKER_FILTERS, TrackerContextFence, filterTrackerDeals, hasTrackerFilters,
  sortTrackerDeals, type DealTrackerSnapshot, type TrackerFilters as Filters,
} from '@/lib/tracker-state';
import { useAuthStore } from '@/store/auth-store';

export default function TrackScreen() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const tabBarInset = useTabBarInset();
  const fence = useRef(new TrackerContextFence()).current;
  const [snapshot, setSnapshot] = useState<DealTrackerSnapshot | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_TRACKER_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  fence.switchContext(userId ?? '');
  const visibleSnapshot = ownerId === userId ? snapshot : null;
  const deals = useMemo(
    () => visibleSnapshot ? filterTrackerDeals(sortTrackerDeals(visibleSnapshot.deals), filters) : [],
    [filters, visibleSnapshot],
  );

  useEffect(() => {
    setSnapshot(null); setOwnerId(null); setFilters(EMPTY_TRACKER_FILTERS); setError(null);
    setLoading(Boolean(userId));
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const ticket = fence.begin(userId);
    const result = await fetchDealTracker();
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) {
      setSnapshot(result.data); setOwnerId(userId); setError(null);
    } else setError(result.message);
    setLoading(false);
  }, [fence, userId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => fence.invalidate();
  }, [fence, load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const openMonthlySummary = () => router.push('/monthly-summary');
  const openPaymentDashboard = () => router.push('/payment-dashboard');
  const openCampaignCalendar = () => router.push('/campaign-calendar');
  const openUsageRights = () => router.push('/usage-rights');
  const openExclusivity = () => router.push('/exclusivity');
  const openBlackouts = () => router.push('/blackouts');
  const openDisclosures = () => router.push('/disclosures');
  const openWhitelisting = () => router.push('/whitelisting');

  if (loading && !visibleSnapshot) {
    return (
      <SafeAreaView className="flex-1 bg-transparent px-4 pt-2" edges={['top']}>
        <Text className="font-geist-bold text-display text-ink">Track</Text>
        <View className="mt-4 flex-row flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton.Block key={index} width="31%" height={76} radius="panel" />)}
        </View>
        <View className="mt-5"><Skeleton.InboxRows rows={3} /></View>
      </SafeAreaView>
    );
  }

  if (!visibleSnapshot && error) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
        <View className="gap-3 px-4 pt-2"><Text className="font-geist-bold text-display text-ink">Track</Text><View className="flex-row flex-wrap gap-2"><Button action="secondary" className="min-w-[30%] flex-1" onPress={openCampaignCalendar}><ButtonText>Calendar</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openPaymentDashboard}><ButtonText>Payments</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openMonthlySummary}><ButtonText>Monthly summary</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openUsageRights}><ButtonText>Usage rights</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openExclusivity}><ButtonText>Exclusivity</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openBlackouts}><ButtonText>Blackouts</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openDisclosures}><ButtonText>Disclosures</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openWhitelisting}><ButtonText>Whitelisting</ButtonText></Button></View></View>
        <EmptyState title="Tracking couldn’t load" description={error} actionLabel="Try again" onAction={() => void load()} />
      </SafeAreaView>
    );
  }

  if (!visibleSnapshot || visibleSnapshot.deals.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
        <View className="gap-3 px-4 pt-2"><Text className="font-geist-bold text-display text-ink">Track</Text><View className="flex-row flex-wrap gap-2"><Button action="secondary" className="min-w-[30%] flex-1" onPress={openCampaignCalendar}><ButtonText>Calendar</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openPaymentDashboard}><ButtonText>Payments</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openMonthlySummary}><ButtonText>Monthly summary</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openUsageRights}><ButtonText>Usage rights</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openExclusivity}><ButtonText>Exclusivity</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openBlackouts}><ButtonText>Blackouts</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openDisclosures}><ButtonText>Disclosures</ButtonText></Button><Button action="secondary" className="min-w-[30%] flex-1" onPress={openWhitelisting}><ButtonText>Whitelisting</ButtonText></Button></View></View>
        <EmptyState title="No active deals" description="Your active deal deadlines and health will appear here." actionLabel="Browse Discover" onAction={() => router.push('/')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <FlatList
        data={deals}
        keyExtractor={(deal) => deal.id}
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-3 px-4 pt-2"
        contentContainerStyle={{ paddingBottom: tabBarInset + 16 }}
        scrollIndicatorInsets={{ bottom: tabBarInset }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#847F78" />}
        ListHeaderComponent={(
          <View className="mb-2 gap-5">
            <View>
              <Text className="font-geist-bold text-display text-ink">Track</Text>
              <Text className="mt-1 font-geist text-micro text-ink-3">Server snapshot · {new Date(visibleSnapshot.asOf).toLocaleString()}</Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open campaign calendar" onPress={openCampaignCalendar}><ButtonText>Calendar</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open payment dashboard" onPress={openPaymentDashboard}><ButtonText>Payments</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open monthly deal summary" onPress={openMonthlySummary}><ButtonText>Monthly summary</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open usage rights" onPress={openUsageRights}><ButtonText>Usage rights</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open exclusivity tracker" onPress={openExclusivity}><ButtonText>Exclusivity</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open blackout tracker" onPress={openBlackouts}><ButtonText>Blackouts</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open disclosure tracker" onPress={openDisclosures}><ButtonText>Disclosures</ButtonText></Button>
              <Button action="secondary" className="min-w-[30%] flex-1" accessibilityLabel="Open whitelisting tracker" onPress={openWhitelisting}><ButtonText>Whitelisting</ButtonText></Button>
            </View>
            <TrackerSummary snapshot={visibleSnapshot} />
            {error ? (
              <View accessibilityRole="alert" className="flex-row items-center gap-3 rounded-panel bg-surface-recess px-3 py-2.5">
                <Text className="min-w-0 flex-1 font-geist text-micro text-status-critical">{error}</Text>
                <Button action="secondary" size="md" onPress={() => void load()}><ButtonText>Retry</ButtonText></Button>
              </View>
            ) : null}
            <TrackerFilters filters={filters} asOf={visibleSnapshot.asOf} onChange={setFilters} />
            <View className="flex-row items-end justify-between">
              <Text className="font-geist-semibold text-title text-ink">Active deals</Text>
              <Text className="font-geist text-micro tabular-nums text-ink-3">{deals.length} of {visibleSnapshot.deals.length}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={hasTrackerFilters(filters) ? (
          <EmptyState title="No deals match" description="Clear the filters to see every active deal." actionLabel="Clear filters" onAction={() => setFilters(EMPTY_TRACKER_FILTERS)} />
        ) : null}
        renderItem={({ item }) => <ListItemFade><DealTrackerRow deal={item} onPress={() => router.push(`/deal/${item.id}`)} /></ListItemFade>}
      />
    </SafeAreaView>
  );
}
