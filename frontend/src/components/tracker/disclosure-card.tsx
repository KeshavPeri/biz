import { Pressable, Text, View } from 'react-native';
import type { DisclosureDeal, DisclosurePlatform } from '@/lib/disclosures-state';

const STATE = { required: 'Required', not_required: 'Not required', unavailable: 'Needs review' } as const;
const PLATFORM: Record<DisclosurePlatform, string> = {
  instagram: 'Instagram', linkedin: 'LinkedIn', pinterest: 'Pinterest', podcast: 'Podcast platform',
  threads: 'Threads', tiktok: 'TikTok', x: 'X/Twitter', youtube: 'YouTube',
};

export function DisclosureCard({ deal, onPress }: { deal: DisclosureDeal; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${deal.dealName} source deal`} onPress={onPress} className="rounded-panel border border-hairline-card bg-surface-card p-4 active:opacity-90">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{deal.counterpartyName}</Text><Text numberOfLines={1} className="mt-0.5 font-geist text-secondary text-ink-3">{deal.dealName}</Text></View>
        <Text className="font-geist-semibold text-micro text-ink-2">{STATE[deal.presence]}</Text>
      </View>
      {deal.presence === 'unavailable' ? <Text className="mt-3 font-geist text-secondary text-ink-3">The executed terms could not be verified. Review the source deal.</Text> : null}
      {deal.presence === 'not_required' ? <Text className="mt-3 font-geist text-secondary text-ink-3">No sponsored-content disclosure is required for {deal.platforms.map((item) => PLATFORM[item.platform]).join(', ')}.</Text> : null}
      {deal.presence === 'required' ? <View className="mt-3 gap-3">{deal.platforms.map((group) => <View key={group.platform}><Text className="font-geist-semibold text-secondary text-ink-2">{PLATFORM[group.platform]}</Text>{group.rules.map((rule) => <Text key={rule} className="mt-1 font-geist text-secondary text-ink-3">• {rule}</Text>)}</View>)}</View> : null}
      <Text className="mt-3 font-geist-semibold text-micro text-ink-2">Open source deal</Text>
    </Pressable>
  );
}
