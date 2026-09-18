import { Pressable, Text, View } from 'react-native';

import { LogoTile } from '@/components/discovery/logo-tile';
import { type BrandCardData } from '@/lib/discovery';

import CheckIcon from '@/assets/icons/check.svg';
import StarIcon from '@/assets/icons/star.svg';

/**
 * BrandCard — a creator-facing browse card (B2-005). Logo initials, company +
 * verified badge, industry, trust rating. Tap opens the brand profile (/brand/[id]).
 * "Active campaigns / pays in ~Nd" from the mockup are omitted — no Phase-8 table
 * backs them (logged in progress.md).
 */
export function BrandCard({ brand, onPress }: { brand: BrandCardData; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="mb-3 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-3.5 shadow-l1"
    >
      <LogoTile name={brand.companyName} />
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-geist-semibold text-body text-ink" numberOfLines={1}>
            {brand.companyName}
          </Text>
          {brand.verified ? (
            <View className="h-4 w-4 items-center justify-center rounded-full bg-status-good-tint">
              <CheckIcon width={10} height={10} color="#4F7A1E" />
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 font-geist text-micro text-ink-3" numberOfLines={1}>
          {brand.industry ?? 'Brand'}
          {brand.hqCity ? ` · ${brand.hqCity}` : ''}
        </Text>
      </View>
      {brand.trustRating !== null ? (
        <View className="items-end">
          <View className="flex-row items-center gap-1">
            <StarIcon width={11} height={11} color="#847F78" />
            <Text className="font-geist-bold text-body tabular-nums text-ink">{brand.trustRating.toFixed(1)}</Text>
          </View>
          <Text className="font-geist text-micro text-ink-3">rating</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
