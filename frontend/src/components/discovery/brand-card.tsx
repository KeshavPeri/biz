import { Pressable, Text, View } from 'react-native';

import { type BrandCardData } from '@/lib/discovery';

import CheckIcon from '@/assets/icons/check.svg';

// Deterministic warm accent for the logo tile from the company name.
const LOGO_COLORS = ['#B96A83', '#A9BE8E', '#CBB080', '#8FA3B5', '#C98FA0', '#7E5B4E'];
function logoColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return LOGO_COLORS[sum % LOGO_COLORS.length];
}

/**
 * BrandCard — a creator-facing browse card (B2-005). Logo initials, company +
 * verified badge, industry, trust rating. Tap opens the brand profile (/brand/[id]).
 * "Active campaigns / pays in ~Nd" from the mockup are omitted — no Phase-8 table
 * backs them (logged in progress.md).
 */
export function BrandCard({ brand, onPress }: { brand: BrandCardData; onPress: () => void }) {
  const initials = brand.companyName.trim().slice(0, 2).toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="mb-3 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-3.5 shadow-l1"
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-panel"
        style={{ backgroundColor: logoColor(brand.companyName) }}
      >
        <Text className="font-geist-bold text-secondary text-white">{initials}</Text>
      </View>
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
          <Text className="font-geist-bold text-body text-ink">★ {brand.trustRating.toFixed(1)}</Text>
          <Text className="font-geist text-micro text-ink-3">rating</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
