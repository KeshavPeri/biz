import { Text, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { type BrandProfile } from '@/lib/media-kit';

import CheckIcon from '@/assets/icons/check.svg';

const LOGO_COLORS = ['#B96A83', '#A9BE8E', '#CBB080', '#8FA3B5', '#C98FA0', '#7E5B4E'];
function logoColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return LOGO_COLORS[sum % LOGO_COLORS.length];
}

/**
 * BrandProfileView — read-only brand business profile (B2-006 / B2-038), shown to a
 * browsing creator (and public-read). Renders public `brands` fields; the
 * "Connect / Start a deal" CTA is a DISABLED placeholder (Cluster C / Phase 9 wires
 * it). Content only — the route screen provides SafeArea + back header + scroll.
 */
export function BrandProfileView({ data, onConnect }: { data: BrandProfile; onConnect?: () => void }) {
  const attrs = data.profileAttributes ?? {};
  const detailRows: { label: string; value: string }[] = [
    { label: 'Website', value: data.domain ?? '—' },
    { label: 'HQ city', value: typeof attrs.hq_city === 'string' ? attrs.hq_city : '—' },
    { label: 'Team size', value: typeof attrs.employee_range === 'string' ? attrs.employee_range : '—' },
    { label: 'Founded', value: attrs.founded_year ? String(attrs.founded_year) : '—' },
  ];

  return (
    <View className="px-4 pb-8 pt-2">
      {/* Header */}
      <View className="flex-row items-center gap-3.5">
        <View
          className="h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: logoColor(data.companyName) }}
        >
          <Text className="font-geist-bold text-[22px] text-white">
            {data.companyName.trim().slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="font-geist-bold text-title text-ink" numberOfLines={2}>
              {data.companyName}
            </Text>
            {data.verified ? (
              <View className="h-5 w-5 items-center justify-center rounded-full bg-status-good-tint">
                <CheckIcon width={12} height={12} color="#4F7A1E" />
              </View>
            ) : null}
          </View>
          <Text className="mt-0.5 font-geist text-secondary text-ink-2">
            {data.industry ?? 'Brand'}
          </Text>
        </View>
      </View>

      {/* Trust strip */}
      <View className="mt-5 flex-row rounded-card border border-hairline-card bg-surface-card shadow-l1">
        <View className="flex-1 items-center px-2 py-3.5">
          <Text className="font-geist-bold text-[18px] text-ink">
            {data.trustRating !== null ? `★ ${data.trustRating.toFixed(1)}` : '—'}
          </Text>
          <Text className="mt-0.5 font-geist-medium text-[10.5px] text-ink-3">Trust rating</Text>
        </View>
        <View className="flex-1 items-center border-l border-hairline px-2 py-3.5">
          <Text className="font-geist-bold text-[18px] text-ink">
            {data.dealCompletionRate !== null ? `${Math.round(data.dealCompletionRate * 100)}%` : '—'}
          </Text>
          <Text className="mt-0.5 font-geist-medium text-[10.5px] text-ink-3">Deals completed</Text>
        </View>
        <View className="flex-1 items-center border-l border-hairline px-2 py-3.5">
          <Text className="font-geist-bold text-[18px] text-ink">
            {data.verified ? 'Yes' : 'No'}
          </Text>
          <Text className="mt-0.5 font-geist-medium text-[10.5px] text-ink-3">Verified</Text>
        </View>
      </View>

      {/* Details */}
      <View className="mt-6">
        <Text className="mb-3 font-geist-semibold text-subtitle text-ink">Company</Text>
        <View className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
          {detailRows.map((r, i) => (
            <View
              key={r.label}
              className={`flex-row items-center justify-between py-2.5 ${
                i === 0 ? '' : 'border-t border-hairline'
              }`}
            >
              <Text className="font-geist text-body text-ink-2">{r.label}</Text>
              <Text className="font-geist-semibold text-body text-ink">{r.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Connect CTA — enabled when onConnect is supplied (B2-004). */}
      <View className="mt-6">
        {onConnect ? (
          <Button action="primary" size="lg" onPress={onConnect}>
            <ButtonText>Start a deal</ButtonText>
          </Button>
        ) : (
          <>
            <Button action="primary" size="lg" isDisabled>
              <ButtonText>Start a deal (coming soon)</ButtonText>
            </Button>
            <Text className="mt-1.5 text-center font-geist text-[11px] text-ink-3">
              Connecting with brands lands with the deal engine.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
