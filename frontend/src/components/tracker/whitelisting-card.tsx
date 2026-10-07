import { Pressable, Text, View } from 'react-native';
import type { WhitelistingDeal, WhitelistingPlatform, WhitelistingStatus } from '@/lib/whitelisting-state';

const PRESENCE = { enabled: 'Enabled', not_enabled: 'Not enabled', unavailable: 'Needs review' } as const;
const STATUS: Record<WhitelistingStatus, string> = { active: 'Active', upcoming: 'Upcoming', expired: 'Expired' };
const PLATFORM: Record<WhitelistingPlatform, string> = {
  instagram: 'Instagram', linkedin: 'LinkedIn', pinterest: 'Pinterest', podcast: 'Podcast platform',
  threads: 'Threads', tiktok: 'TikTok', x: 'X/Twitter', youtube: 'YouTube',
};

export function WhitelistingCard({ deal, onPress }: { deal: WhitelistingDeal; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${deal.dealName} source deal`} onPress={onPress} className="rounded-panel border border-hairline-card bg-surface-card p-4 active:opacity-90">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{deal.counterpartyName}</Text><Text numberOfLines={1} className="mt-0.5 font-geist text-secondary text-ink-3">{deal.dealName}</Text></View>
        <Text className="font-geist-semibold text-micro text-ink-2">{PRESENCE[deal.presence]}</Text>
      </View>
      {deal.presence === 'unavailable' ? <Text className="mt-3 font-geist text-secondary text-ink-3">The executed terms could not be verified. Review the source deal.</Text> : null}
      {deal.presence === 'not_enabled' ? <Text className="mt-3 font-geist text-secondary text-ink-3">Whitelisting or boosting was explicitly not enabled.</Text> : null}
      {deal.presence === 'enabled' ? <View className="mt-3 gap-3">{deal.arrangements.map((item) => (
        <View key={`${item.platform}:${item.accountLabel}:${item.startDate}:${item.endDate}:${item.budget?.amount ?? ''}`} className={item.status === 'expired' ? 'opacity-60' : ''}>
          <View className="flex-row items-center justify-between gap-3"><Text className="font-geist-semibold text-secondary text-ink-2">{PLATFORM[item.platform]}</Text><Text className="font-geist-semibold text-micro text-ink-2">{STATUS[item.status]}</Text></View>
          <Text className="mt-1 font-geist text-secondary text-ink-3">{item.accountLabel}</Text>
          <Text className="mt-1 font-geist text-micro text-ink-3">{item.startDate} to {item.endDate} · inclusive</Text>
          {item.budget ? <Text className="mt-1 font-geist text-micro tabular-nums text-ink-3">Budget {item.budget.currency} {item.budget.amount}</Text> : null}
        </View>
      ))}</View> : null}
      <Text className="mt-3 font-geist-semibold text-micro text-ink-2">Open source deal</Text>
    </Pressable>
  );
}
