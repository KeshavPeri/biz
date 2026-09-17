import { Pressable, Text, View } from 'react-native';

import { type SocialHandle } from '@/lib/media-kit';
import { platformLabel } from '@/lib/media-kit-enums';
import { formatCount, formatPercent } from '@/lib/format';

// Per-platform accent (mockup's `.pic` chips). Falls back to ink for the long tail.
const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#B96A83',
  youtube: '#C0574B',
  tiktok: '#1C1B18',
  x: '#2C2A25',
  linkedin: '#2C6BA0',
  pinterest: '#C0392B',
  threads: '#1C1B18',
  podcast: '#7E5B4E',
};

/**
 * PlatformStatCard — one "Reach" card (B2-032). Renders the mock stats already on
 * a social_handles row: follower_count, engagement_rate, weekly_reach, the primary
 * marker and verification badge. No live API; these are stored values. The 90-day
 * growth trend from the mockup is intentionally omitted — no historical data backs it.
 *
 * `onEdit` is supplied only in the owner's own view; tapping opens the handle editor.
 */
export function PlatformStatCard({
  handle,
  onEdit,
}: {
  handle: SocialHandle;
  onEdit?: () => void;
}) {
  const color = PLATFORM_COLOR[handle.platform] ?? '#1C1B18';
  const verified = handle.verification_status === 'verified';

  const body = (
    <View className="flex-1 rounded-card border border-hairline-card bg-surface-card p-3.5 shadow-l1">
      <View className="mb-2 flex-row items-center gap-2">
        <View
          className="h-7 w-7 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: color }}
        >
          <Text className="font-geist-bold text-secondary text-white">
            {platformLabel(handle.platform)[0]}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="font-geist-medium text-micro text-ink-3" numberOfLines={1}>
            {handle.handle}
          </Text>
        </View>
        {handle.is_primary ? (
          <View className="rounded-pill bg-surface-recess px-2 py-0.5">
            <Text className="font-geist-semibold text-micro text-ink-2">
              Primary
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="font-geist-bold text-title tabular-nums text-ink">
        {formatCount(handle.follower_count)}{' '}
        <Text className="font-geist-medium text-micro text-ink-3">followers</Text>
      </Text>

      <View className="mt-2 flex-row justify-between border-t border-hairline pt-2">
        <Text className="font-geist text-secondary text-ink-2">Eng. rate</Text>
        <Text className="font-geist-semibold text-secondary tabular-nums text-ink">
          {formatPercent(handle.engagement_rate)}
        </Text>
      </View>
      <View className="mt-1.5 flex-row justify-between">
        <Text className="font-geist text-secondary text-ink-2">Weekly reach</Text>
        <Text className="font-geist-semibold text-secondary tabular-nums text-ink">
          {formatCount(handle.weekly_reach)}
        </Text>
      </View>

      <View className="mt-2 flex-row items-center gap-1">
        <View
          className={`h-1.5 w-1.5 rounded-full ${verified ? 'bg-status-good' : 'bg-cane-4'}`}
        />
        <Text
          className={`font-geist-medium text-micro ${
            verified ? 'text-status-good-label' : 'text-ink-2'
          }`}
        >
          {verified ? 'Verified' : 'Pending'}
        </Text>
        {onEdit ? (
          <Text className="ml-auto font-geist-semibold text-secondary text-ink">Edit ›</Text>
        ) : null}
      </View>
    </View>
  );

  if (onEdit) {
    return (
      <Pressable className="flex-1" onPress={onEdit} accessibilityRole="button">
        {body}
      </Pressable>
    );
  }
  return body;
}
