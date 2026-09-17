import { Pressable, Text, View } from 'react-native';

import TagIcon from '@/assets/icons/tag.svg';
import { StorageImage } from '@/components/media-kit/storage-image';
import { stagePill, type DealPreview } from '@/lib/deals';
import { formatRelativeTime } from '@/lib/format';
import type { PrivateDealLabel } from '@/lib/private-deal-labels';

/**
 * DealPreviewCard — one row in the chat list (task 9.2), rebuilt in RN from the
 * mockup's `.ccard` and mapped onto design tokens. Shows the other party, deal
 * name, a stage pill, the last message, an unread badge, and the next-action
 * prompt. Tap opens the deal room (/deal/[id]).
 */
export function DealPreviewCard({ deal, labels, onPress, onEditLabels }: {
  deal: DealPreview; labels: PrivateDealLabel[]; onPress: () => void; onEditLabels: () => void;
}) {
  const pill = stagePill(deal.stage, deal.isDisputed);
  const directionLabel =
    deal.direction === 'inbound' ? 'Inbound' : deal.direction === 'outbound' ? 'Outbound' : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open deal ${deal.dealName}`}
      className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1 active:opacity-90"
    >
      {/* Row 1 — avatar · name + stage pill · unread badge */}
      <View className="flex-row items-center gap-2.5">
        <Avatar path={deal.otherAvatarPath} name={deal.otherNames[0] ?? deal.dealName} />
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-body text-ink" numberOfLines={1}>
            {deal.dealName}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <View className={`rounded-pill px-2 py-0.5 ${pill.bg}`}>
              <Text className={`font-geist-semibold text-micro ${pill.text}`}>{pill.label}</Text>
            </View>
            {directionLabel ? (
              <View className="rounded-pill border border-hairline px-2 py-0.5">
                <Text className="font-geist-semibold text-micro text-ink-3">{directionLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {deal.unreadCount > 0 ? (
          <View className="h-5 min-w-[20px] items-center justify-center rounded-pill bg-ink px-1.5">
            <Text className="font-geist-semibold text-micro tabular-nums text-white">{deal.unreadCount}</Text>
          </View>
        ) : null}
      </View>

      {/* Last-message preview */}
      {deal.lastMessage ? (
        <Text className="mt-2 font-geist text-secondary text-ink-2" numberOfLines={1}>
          <Text className="font-geist-semibold text-ink">
            {deal.lastMessage.senderName.split(' ')[0]}:{' '}
          </Text>
          {deal.lastMessage.body}
        </Text>
      ) : null}

      <View className="mt-2 flex-row items-center gap-1.5">
        {labels.slice(0, 2).map((label) => (
          <View key={label.id} className="rounded-pill bg-surface-recess px-2 py-0.5">
            <Text className="font-geist-medium text-micro text-ink-2" numberOfLines={1}>{label.label}</Text>
          </View>
        ))}
        {labels.length > 2 ? <Text className="font-geist-semibold text-micro tabular-nums text-ink-3">+{labels.length - 2}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit private labels"
          hitSlop={8}
          onPress={(event) => { event.stopPropagation(); onEditLabels(); }}
          className="ml-auto h-7 w-7 items-center justify-center rounded-full border border-hairline"
        ><TagIcon width={14} height={14} color="#847F78" /></Pressable>
      </View>

      {/* Row 3 — next-action prompt · relative time */}
      <View className="mt-2 flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          <View
            className={`h-1.5 w-1.5 rounded-full ${deal.nextAction.active ? 'bg-status-good' : 'bg-cane-3'}`}
          />
          <Text
            className={`font-geist-medium text-secondary ${deal.nextAction.active ? 'text-ink' : 'text-ink-3'}`}
            numberOfLines={1}
          >
            {deal.nextAction.text}
          </Text>
        </View>
        {deal.lastMessage ? (
          <Text className="font-geist text-micro tabular-nums text-ink-3">
            {formatRelativeTime(deal.lastMessage.createdAt)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A 34px circular avatar — the other party's photo, or their initials on greige. */
function Avatar({ path, name }: { path: string | null; name: string }) {
  if (path) {
    return <StorageImage path={path} className="h-[34px] w-[34px] rounded-full" />;
  }
  return (
    <View className="h-[34px] w-[34px] items-center justify-center rounded-full bg-avatar">
      <Text className="font-geist-semibold text-micro text-ink-2">{initials(name)}</Text>
    </View>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
