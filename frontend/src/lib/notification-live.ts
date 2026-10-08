import { supabase } from './supabase';
import { isUuid, notificationHintMatches, NotificationHintHub } from './notification-state';

const hub = new NotificationHintHub();

/** One RLS-scoped channel shared by whichever notification surface is focused. */
export function subscribeNotificationHints(accountId: string, accessToken: string, onHint: () => void): () => void {
  const client = supabase;
  if (!client || !isUuid(accountId) || !accessToken) return () => {};
  const key = `${accountId}:${accessToken}`;
  return hub.subscribe(key, onHint, (emit) => {
    client.realtime.setAuth(accessToken);
    const channel = client.channel(`notifications:${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${accountId}` }, (payload) => {
        // Payload content is never projected. The ID check rejects stale/foreign hints.
        if (notificationHintMatches(accountId, payload.eventType, payload.new)) emit();
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') emit(); });
    return () => { void channel.unsubscribe(); void client.removeChannel(channel); };
  });
}
