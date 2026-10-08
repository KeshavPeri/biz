import { Pressable, Text, View } from 'react-native';
import type { NotificationRow, DealSource } from '@/lib/notification-state';

type Props = {
  row: NotificationRow;
  source: DealSource | null;
  readError: boolean;
  onOpen: () => void;
  onRetryRead: () => void;
};

export function NotificationCard({ row, source, readError, onOpen, onRetryRead }: Props) {
  const time = new Date(row.createdAt).toLocaleString();
  return (
    <View className={`rounded-panel border p-4 ${row.read ? 'border-hairline bg-surface-card' : 'border-ink bg-surface-card'}`}>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-geist-semibold text-micro text-ink-2">{row.tier[0].toUpperCase() + row.tier.slice(1)} · {row.read ? 'Read' : 'Unread'}</Text>
        <Text className="font-geist text-micro text-ink-3">{time}</Text>
      </View>
      <Text className="mt-2 font-geist-semibold text-subtitle text-ink" selectable>{row.title}</Text>
      <Text className="mt-1 font-geist text-secondary text-ink-2" selectable>{row.body}</Text>
      {source ? <Pressable accessibilityRole="button" accessibilityLabel={`Open deal ${source.name}`} onPress={onOpen} className="mt-3 min-h-11 justify-center self-start rounded-pill bg-surface-recess px-4">
        <Text className="font-geist-semibold text-secondary text-ink">Open deal</Text>
      </Pressable> : <Text className="mt-3 font-geist text-micro text-ink-3">Source unavailable</Text>}
      {readError ? <View className="mt-2 flex-row items-center gap-2">
        <Text accessibilityRole="alert" className="font-geist text-micro text-status-critical">Could not mark as read.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Retry marking ${row.title} read`} onPress={onRetryRead} className="min-h-11 justify-center px-3">
          <Text className="font-geist-semibold text-micro text-ink">Retry</Text>
        </Pressable>
      </View> : null}
    </View>
  );
}
