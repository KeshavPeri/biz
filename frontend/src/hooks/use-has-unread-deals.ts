import { useEffect, useState } from 'react';

import { fetchMyDealPreviews } from '@/lib/deals';
import { useAuthStore } from '@/store/auth-store';

/**
 * useHasUnreadDeals — whether any of my deal threads has a message I haven't read.
 * Drives the Chat tab dot. Re-reads whenever `refreshKey` changes (the nav passes
 * the active tab + focus), using the same RLS read as the inbox so the two agree.
 */
export function useHasUnreadDeals(refreshKey: string): boolean {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    if (!userId) {
      setHasUnread(false);
      return;
    }
    let active = true;
    void fetchMyDealPreviews(userId).then((rows) => {
      if (active) setHasUnread(rows.some((row) => row.unreadCount > 0));
    });
    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  return hasUnread;
}
