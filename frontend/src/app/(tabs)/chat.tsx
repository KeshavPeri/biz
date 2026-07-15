import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { DealPreviewCard } from '@/components/chat/deal-preview-card';
import { fetchMyDealPreviews, type DealPreview } from '@/lib/deals';
import { useAuthStore } from '@/store/auth-store';

/**
 * Chat — the deal inbox (task 9.2). One preview card per deal I participate in,
 * read Supabase-direct under RLS. Refetches on focus so the unread badge clears
 * when I come back from a thread (which stamps my last_read_at).
 */
export default function ChatScreen() {
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id ?? null;

  const [deals, setDeals] = useState<DealPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setDeals([]);
      setLoading(false);
      return;
    }
    const rows = await fetchMyDealPreviews(userId);
    setDeals(rows);
    setLoading(false);
  }, [userId]);

  // Reload every time the tab gains focus (cheap for the MVP seed).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().finally(() => {
        if (!active) return;
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top']}>
      <View className="px-4 pb-2 pt-2">
        <Text className="font-geist-bold text-display text-ink">Chat</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#847F78" />
        </View>
      ) : deals.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={deals}
          keyExtractor={(d) => d.dealId}
          contentContainerClassName="gap-3 px-4 pb-24 pt-1"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <DealPreviewCard deal={item} onPress={() => router.push(`/deal/${item.dealId}`)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#847F78" />}
        />
      )}
    </SafeAreaView>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-10">
      <Text className="mb-1 text-center font-geist-semibold text-body text-ink">No deals yet</Text>
      <Text className="text-center font-geist text-[13px] text-ink-3">
        Start one from Discover — your deal threads will show up here.
      </Text>
    </View>
  );
}
