import { Pressable, Text, View } from 'react-native';

import { UsageRightsChip } from '@/components/tracker/usage-rights-chip';
import type { UsageRightsDeal } from '@/lib/usage-rights-state';

export function UsageRightsCard({ deal, onPress }: { deal: UsageRightsDeal; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${deal.dealName} usage rights`} onPress={onPress} className="rounded-panel border border-hairline-card bg-surface-card p-4 active:opacity-90">
    <View className="flex-row items-start justify-between gap-2"><View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{deal.dealName}</Text><Text numberOfLines={1} className="mt-0.5 font-geist text-secondary text-ink-3">{deal.counterpartyName} · {deal.direction === 'inbound' ? 'Inbound' : 'Outbound'}</Text></View><UsageRightsChip rights={deal} /></View>
    {deal.rightsPresence === 'present' ? <View className="mt-3 gap-1"><Text className="font-geist text-secondary text-ink-2">{deal.channels.join(' · ')}</Text><Text className="font-geist text-micro text-ink-3">{deal.isPerpetual ? 'Perpetual' : `${deal.startDate} to ${deal.endDate} (inclusive)`}</Text></View> : deal.rightsPresence === 'none' ? <Text className="mt-3 font-geist text-secondary text-ink-3">The executed agreement explicitly has no usage rights.</Text> : <Text accessibilityRole="alert" className="mt-3 font-geist text-secondary text-ink-3">We could not verify these rights. Refresh to try again.</Text>}
  </Pressable>;
}
