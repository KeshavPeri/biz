import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { DealPreviewCard } from '@/components/chat/deal-preview-card';
import { PrivateDealLabelSheet } from '@/components/chat/private-deal-label-sheet';
import { fetchMyDealPreviews, type DealPreview } from '@/lib/deals';
import {
  addPrivateDealLabel, fetchPrivateDealLabels, removePrivateDealLabel,
  type PrivateDealLabel,
} from '@/lib/private-deal-labels';
import {
  distinctPrivateDealLabels, filterDealsByPrivateLabel, PrivateDealLabelContextFence,
} from '@/lib/private-deal-label-state';
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
  const [dealsOwnerId, setDealsOwnerId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, PrivateDealLabel[]>>({});
  const [labelsOwnerId, setLabelsOwnerId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [editorDealId, setEditorDealId] = useState<string | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelFetchError, setLabelFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fence = useRef(new PrivateDealLabelContextFence()).current;
  const identity = userId ?? '';
  fence.switchContext(identity);

  // Do not project another signed-in account's local-only state during rerender.
  const visibleLabels = labelsOwnerId === userId ? labels : {};
  const visibleDeals = dealsOwnerId === userId ? deals : [];
  const labelValues = distinctPrivateDealLabels(visibleLabels);
  const filteredDeals = filterDealsByPrivateLabel(visibleDeals, visibleLabels, selectedLabel);

  useEffect(() => {
    if (selectedLabel && !labelValues.includes(selectedLabel)) setSelectedLabel(null);
  }, [labelValues, selectedLabel]);

  useEffect(() => {
    setDeals([]); setDealsOwnerId(null); setLabels({}); setLabelsOwnerId(null); setSelectedLabel(null); setEditorDealId(null); setLabelLoading(false); setLabelFetchError(null);
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) {
      setDeals([]);
      setDealsOwnerId(null);
      setLoading(false);
      return;
    }
    const ticket = fence.begin(identity);
    const rows = await fetchMyDealPreviews(userId);
    if (!fence.isCurrent(ticket)) return;
    setDeals(rows);
    setDealsOwnerId(userId);
    setLabelLoading(true);
    const response = await fetchPrivateDealLabels(userId, rows.map((row) => row.dealId));
    if (!fence.isCurrent(ticket)) return;
    if (response.ok) { setLabels(response.data); setLabelsOwnerId(userId); setLabelFetchError(null); }
    else { setLabels({}); setLabelsOwnerId(userId); setLabelFetchError(response.message); }
    setLabelLoading(false);
    setLoading(false);
  }, [fence, identity, userId]);

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

  const reloadLabels = useCallback(async (accountId: string): Promise<boolean> => {
    const ticket = fence.begin(identity);
    const response = await fetchPrivateDealLabels(accountId, deals.map((deal) => deal.dealId));
    if (!fence.isCurrent(ticket)) return false;
    if (!response.ok) return false;
    setLabels(response.data); setLabelsOwnerId(accountId); setLabelFetchError(null);
    return true;
  }, [deals, fence, identity]);

  const editorDeal = visibleDeals.find((deal) => deal.dealId === editorDealId) ?? null;
  const addLabel = useCallback(async (value: string) => {
    if (!userId || !editorDeal) return false;
    const ticket = fence.begin(identity);
    const result = await addPrivateDealLabel(userId, editorDeal.dealId, value);
    if (!fence.isCurrent(ticket) || !result.ok) return false;
    return reloadLabels(userId);
  }, [editorDeal, fence, identity, reloadLabels, userId]);
  const removeLabel = useCallback(async (annotationId: string) => {
    if (!userId || !editorDeal) return false;
    const ticket = fence.begin(identity);
    const result = await removePrivateDealLabel(userId, annotationId);
    if (!fence.isCurrent(ticket) || !result.ok) return false;
    return reloadLabels(userId);
  }, [editorDeal, fence, identity, reloadLabels, userId]);

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
          data={filteredDeals}
          keyExtractor={(d) => d.dealId}
          contentContainerClassName="gap-3 px-4 pb-24 pt-1"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<LabelFilters values={labelValues} selected={selectedLabel} onSelect={setSelectedLabel} />}
          ListEmptyComponent={selectedLabel ? <LabelEmptyState onClear={() => setSelectedLabel(null)} /> : null}
          renderItem={({ item }) => <DealPreviewCard deal={item} labels={visibleLabels[item.dealId] ?? []} onPress={() => router.push(`/deal/${item.dealId}`)} onEditLabels={() => setEditorDealId(item.dealId)} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#847F78" />}
        />
      )}
      {userId && editorDeal ? <PrivateDealLabelSheet visible accountId={userId} dealId={editorDeal.dealId} dealName={editorDeal.dealName} labels={visibleLabels[editorDeal.dealId] ?? []} suggestions={labelValues} loading={labelLoading} initialError={labelFetchError} onClose={() => setEditorDealId(null)} onAdd={addLabel} onRemove={removeLabel} /> : null}
    </SafeAreaView>
  );
}

function LabelFilters({ values, selected, onSelect }: { values: string[]; selected: string | null; onSelect: (value: string | null) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-3"><FilterChip label="All" selected={!selected} onPress={() => onSelect(null)} />{values.map((label) => <FilterChip key={label} label={label} selected={selected === label} onPress={() => onSelect(label)} />)}</ScrollView>;
}
function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} className={`rounded-pill border px-3 py-1.5 ${selected ? 'border-ink bg-ink' : 'border-hairline bg-surface-card'}`}><Text className={`font-geist-semibold text-[11px] ${selected ? 'text-white' : 'text-ink-2'}`}>{label}</Text></Pressable>;
}
function LabelEmptyState({ onClear }: { onClear: () => void }) {
  return <View className="items-center px-8 py-12"><Text className="font-geist-semibold text-[14px] text-ink">No chats with this label</Text><Pressable accessibilityRole="button" onPress={onClear} className="mt-3 rounded-pill border border-hairline px-3 py-2"><Text className="font-geist-semibold text-[12px] text-ink">Show all chats</Text></Pressable></View>;
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
