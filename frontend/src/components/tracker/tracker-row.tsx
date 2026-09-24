import { Pressable, Text, View } from 'react-native';

import type { DealTrackerRow as DealTrackerRowType } from '@/lib/tracker-state';

const STATUS_STYLE = {
  red: { dot: 'bg-status-critical', text: 'text-status-critical', label: 'Red' },
  amber: { dot: 'bg-cane-5', text: 'text-ink-2', label: 'Amber' },
  green: { dot: 'bg-status-good', text: 'text-status-good-label', label: 'Green' },
} as const;

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function relevantLabel(deal: DealTrackerRowType): string | null {
  if (!deal.relevantAt) return null;
  const value = new Intl.DateTimeFormat('en', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(deal.relevantAt));
  if (deal.reasonCode.startsWith('confirmation_')) return `Waiting since ${value} UTC`;
  if (deal.reasonCode.startsWith('connection_')) return `${deal.status === 'red' ? 'Expired' : 'Expires'} ${value} UTC`;
  return `Relevant date ${value} UTC`;
}

export function DealTrackerRow({ deal, onPress }: { deal: DealTrackerRowType; onPress: () => void }) {
  const status = STATUS_STYLE[deal.status];
  const deadline = dateLabel(deal.nextDeadline);
  const relevant = relevantLabel(deal);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${deal.name}, ${status.label}, ${deal.reasonLabel}${deadline ? `, next deadline ${deadline}` : ''}`}
      onPress={onPress}
      className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{deal.name}</Text>
          <Text className="mt-1 font-geist text-micro text-ink-3">
            {label(deal.stage)} · {label(deal.dealType)} · {label(deal.direction)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 rounded-pill bg-surface-recess px-2.5 py-1.5">
          <View className={`h-2 w-2 rounded-full ${status.dot}`} />
          <Text className={`font-geist-semibold text-micro ${status.text}`}>{status.label}</Text>
        </View>
      </View>
      <View className="mt-3 flex-row items-end justify-between gap-3 border-t border-hairline pt-3">
        <View className="min-w-0 flex-1">
          <Text className={`font-geist-medium text-secondary ${status.text}`}>{deal.reasonLabel}</Text>
          {relevant ? <Text className="mt-0.5 font-geist text-micro tabular-nums text-ink-3">{relevant}</Text> : null}
        </View>
        <Text className="font-geist-medium text-micro tabular-nums text-ink-3">
          {deadline ? `Due ${deadline}` : 'No dated deadline'}
        </Text>
      </View>
    </Pressable>
  );
}
