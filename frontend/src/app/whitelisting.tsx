import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { WhitelistingCard } from '@/components/tracker/whitelisting-card';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchWhitelisting } from '@/lib/whitelisting';
import { WhitelistingContextFence, type WhitelistingSnapshot } from '@/lib/whitelisting-state';
import { useAuthStore } from '@/store/auth-store';

export default function WhitelistingScreen() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const fence = useRef(new WhitelistingContextFence()).current;
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [snapshot, setSnapshot] = useState<WhitelistingSnapshot | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  fence.switchContext(userId ?? '');
  const visible = ownerId === userId ? snapshot : null;
  useEffect(() => { setSnapshot(null); setOwnerId(null); setError(null); setLoading(Boolean(userId)); }, [userId]);
  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const ticket = fence.begin(userId); setLoading(true); const result = await fetchWhitelisting();
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) { setSnapshot(result.data); setOwnerId(userId); setError(null); } else setError(result.message);
    setLoading(false);
  }, [fence, userId]);
  useFocusEffect(useCallback(() => { void load(); return () => fence.invalidate(); }, [fence, load]));
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <DetailHeader title="Whitelisting" scrolled={scrolled} onBack={() => router.back()} />
      <Animated.ScrollView className="flex-1" onScroll={onScroll} scrollEventThrottle={16} contentContainerClassName="gap-3 px-4 pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}>
        {visible ? <><View className="pt-1"><Text className="font-geist-bold text-display text-ink">Whitelisting</Text><Text className="mt-1 font-geist text-micro text-ink-3">Contractual boosting terms · server UTC snapshot · {new Date(visible.asOf).toLocaleString()}</Text></View>{error ? <View accessibilityRole="alert" className="rounded-panel bg-surface-recess p-3"><Text className="font-geist text-secondary text-status-critical">{error}</Text></View> : null}{visible.deals.length ? visible.deals.map((deal) => <WhitelistingCard key={deal.dealId} deal={deal} onPress={() => router.push(deal.dealPath)} />) : <EmptyState title="No executed whitelisting terms" description="Whitelisting arrangements will appear after a contract is executed." />}</> : loading ? <View className="gap-2 pt-4"><Text className="font-geist-semibold text-title text-ink">Loading whitelisting…</Text><Text className="font-geist text-secondary text-ink-3">Checking current participation and executed agreements.</Text></View> : <EmptyState title="Whitelisting couldn’t load" description={error ?? 'Please try again.'} actionLabel="Try again" onAction={() => void load()} />}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
