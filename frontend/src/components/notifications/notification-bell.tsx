import { useCallback, useRef } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import BellIcon from '@/assets/icons/bell.svg';
import { useNotificationBadgeState } from '@/lib/notification-badge-state';
import { subscribeNotificationHints } from '@/lib/notification-live';
import { NotificationContextFence, notificationBadge, notificationBadgeLabel } from '@/lib/notification-state';
import { fetchUnreadCount } from '@/lib/notifications';
import { useAuthStore } from '@/store/auth-store';

export function NotificationBell() {
  const session = useAuthStore((state) => state.session);
  const accountId = session?.user.id ?? null;
  const token = session?.access_token ?? '';
  const ownerId = useNotificationBadgeState((state) => state.ownerId);
  const count = useNotificationBadgeState((state) => state.count);
  const setBadge = useNotificationBadgeState((state) => state.set);
  const clearBadge = useNotificationBadgeState((state) => state.clear);
  const fence = useRef(new NotificationContextFence()).current;
  const key = `${accountId ?? ''}:${token}`;
  fence.switchContext(key);
  const visibleCount = ownerId === accountId ? count : null;

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const generation = fence.begin();
    const result = await fetchUnreadCount(accountId);
    if (!fence.isCurrent(key, generation)) return;
    setBadge(accountId, result.ok ? result.data : null);
  }, [accountId, fence, key, setBadge]);

  useFocusEffect(useCallback(() => {
    if (!accountId) { clearBadge(); return; }
    // A token rotation immediately makes the old badge unknown until verified.
    setBadge(accountId, null);
    void refresh();
    const stop = subscribeNotificationHints(accountId, token, () => { void refresh(); });
    return () => { stop(); fence.invalidate(); };
  }, [accountId, token, refresh, setBadge, clearBadge, fence]));

  if (!accountId) return null;
  const badge = notificationBadge(visibleCount);
  return (
    <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button"
      accessibilityLabel={notificationBadgeLabel(visibleCount)}
      className="h-11 w-11 items-center justify-center rounded-full bg-surface-card">
      <BellIcon width={22} height={22} color="#1C1B18" />
      {badge ? <View className="absolute -right-1 -top-1 min-h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1">
        <Text className="font-geist-semibold text-[11px] text-white">{badge}</Text>
      </View> : null}
    </Pressable>
  );
}
