import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { ExclusivityCard } from '@/components/tracker/exclusivity-card';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchExclusivity } from '@/lib/exclusivity';
import { ExclusivityContextFence, type ExclusivitySnapshot } from '@/lib/exclusivity-state';
import { useAuthStore } from '@/store/auth-store';

export default function ExclusivityScreen() {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const fence = useRef(new ExclusivityContextFence()).current;
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [snapshot, setSnapshot] = useState<ExclusivitySnapshot | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null);
  fence.switchContext(userId ?? '');
  const visible = ownerId === userId ? snapshot : null;

  useEffect(() => { setSnapshot(null); setOwnerId(null); setError(null); setLoading(Boolean(userId)); }, [userId]);
  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const ticket = fence.begin(userId); setLoading(true);
    const result = await fetchExclusivity();
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) { setSnapshot(result.data); setOwnerId(userId); setError(null); } else setError(result.message);
    setLoading(false);
  }, [fence, userId]);
  useFocusEffect(useCallback(() => { void load(); return () => fence.invalidate(); }, [fence, load]));
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  return <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
    <DetailHeader title="Exclusivity" scrolled={scrolled} onBack={() => router.back()} />
    <Animated.ScrollView className="flex-1" onScroll={onScroll} scrollEventThrottle={16} contentContainerClassName="gap-3 px-4 pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}>
      {visible ? <><View className="pt-1"><Text className="font-geist-bold text-display text-ink">Exclusivity</Text><Text className="mt-1 font-geist text-micro text-ink-3">Server UTC snapshot · {new Date(visible.asOf).toLocaleString()}</Text></View>
        {error ? <View accessibilityRole="alert" className="rounded-panel bg-surface-recess p-3"><Text className="font-geist text-secondary text-status-critical">{error}</Text></View> : null}
        {visible.integrityUnavailableCount ? <View accessibilityRole="alert" className="rounded-panel bg-surface-recess p-3"><Text className="font-geist-semibold text-secondary text-ink">Some exclusivity information is unavailable</Text><Text className="mt-1 font-geist text-micro text-ink-3">{visible.integrityUnavailableCount} executed {visible.integrityUnavailableCount === 1 ? 'deal could' : 'deals could'} not be verified. Refresh to try again.</Text></View> : null}
        {visible.clauses.length ? visible.clauses.map((clause) => <ExclusivityCard key={clause.dealId} clause={clause} onPress={() => router.push(clause.dealPath)} />) : visible.integrityUnavailableCount === 0 ? <EmptyState title="No exclusivity clauses" description="Executed agreements with exclusivity will appear here, including expired history." /> : null}
      </> : loading ? <View className="gap-2 pt-4"><Text className="font-geist-semibold text-title text-ink">Loading exclusivity…</Text><Text className="font-geist text-secondary text-ink-3">Checking current participation and executed agreements.</Text></View> : <EmptyState title="Exclusivity couldn’t load" description={error ?? 'Please try again.'} actionLabel="Try again" onAction={() => void load()} />}
    </Animated.ScrollView>
  </SafeAreaView>;
}
