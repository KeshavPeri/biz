import { Pressable, Text, View } from 'react-native';

import type { ExclusivityClause } from '@/lib/exclusivity-state';

const LABEL = { active: 'Active', expiring: 'Expiring', expired: 'Expired' } as const;

export function ExclusivityCard({ clause, onPress }: { clause: ExclusivityClause; onPress: () => void }) {
  const expired = clause.status === 'expired';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${clause.dealName} exclusivity`} onPress={onPress} className={`rounded-panel border border-hairline-card p-4 active:opacity-90 ${expired ? 'bg-surface-recess opacity-70' : 'bg-surface-card'}`}>
    <View className="flex-row items-start justify-between gap-3">
      <View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{clause.brandName}</Text><Text numberOfLines={1} className="mt-0.5 font-geist text-secondary text-ink-3">{clause.dealName} · {clause.creatorName}</Text></View>
      <View className="rounded-full bg-surface-recess px-2.5 py-1"><Text className="font-geist-semibold text-micro text-ink-2">{LABEL[clause.status]}</Text></View>
    </View>
    <Text className="mt-3 font-geist-semibold text-secondary text-ink-2">{clause.category}</Text>
    <Text className="mt-1 font-geist text-micro text-ink-3">{clause.startDate} to {clause.endDate} (inclusive)</Text>
  </Pressable>;
}
