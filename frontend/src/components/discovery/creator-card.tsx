import { Pressable, Text, View } from 'react-native';

import { StorageImage } from '@/components/media-kit/storage-image';
import { type CreatorCardData } from '@/lib/discovery';
import { formatCount, formatPercent } from '@/lib/format';

import CheckIcon from '@/assets/icons/check.svg';

/**
 * CreatorCard — a brand-facing browse card (B2-001). Photo (primary/avatar via
 * StorageImage), name + verified check, niche · city · trust, and the primary
 * handle's reach + ER. Tap opens the full media kit (/creator/[id]).
 */
export function CreatorCard({ creator, onPress }: { creator: CreatorCardData; onPress: () => void }) {
  const cap = (s: string) => (s.length ? s[0].toUpperCase() + s.slice(1) : s);
  const line = [creator.niches[0] ? cap(creator.niches[0]) : null, creator.city]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="overflow-hidden rounded-card border border-hairline-card bg-surface-card shadow-l1"
    >
      <View className="relative h-32 w-full">
        <StorageImage path={creator.avatarPath} className="h-full w-full" />
        {/* scrim + name overlay */}
        <View className="absolute inset-x-0 bottom-0 h-16 justify-end bg-[rgba(28,27,24,0.35)] px-2.5 pb-2">
          <View className="flex-row items-center gap-1">
            <Text className="font-geist-semibold text-[13px] text-white" numberOfLines={1}>
              {creator.displayName}
            </Text>
            {creator.primary?.verified ? <CheckIcon width={11} height={11} color="#FFFFFF" /> : null}
          </View>
        </View>
      </View>

      <View className="px-2.5 pb-3 pt-2">
        <Text className="mb-1.5 font-geist text-[11px] text-ink-3" numberOfLines={1}>
          {line}
          {creator.trustScore !== null ? ` · ★ ${creator.trustScore.toFixed(1)}` : ''}
        </Text>
        <View className="flex-row justify-between">
          <View>
            <Text className="font-geist-bold text-[12.5px] text-ink">
              {formatCount(creator.primary?.followerCount)}
            </Text>
            <Text className="font-geist text-[10px] text-ink-3">reach</Text>
          </View>
          <View>
            <Text className="font-geist-bold text-[12.5px] text-ink">
              {formatPercent(creator.primary?.engagementRate)}
            </Text>
            <Text className="font-geist text-[10px] text-ink-3">ER</Text>
          </View>
          <View>
            <Text className="font-geist-bold text-[12.5px] text-ink">
              {creator.platforms.length}
            </Text>
            <Text className="font-geist text-[10px] text-ink-3">
              {creator.platforms.length === 1 ? 'platform' : 'platforms'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
