import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import {
  acceptDeal,
  declineDeal,
  fetchDealThread,
  markDealRead,
  sendMessage,
  stagePill,
  subscribeToDealMessages,
  type ChatMessage,
  type DealThread,
  type IncomingMessageRow,
} from '@/lib/deals';
import { formatClockTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth-store';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import SendIcon from '@/assets/icons/send.svg';

/**
 * Deal room (task 9.3) — the chat thread for one deal. A root-stack sibling above
 * the tabs (same pattern as creator/[id]). Loads history oldest→newest, sends
 * messages Supabase-direct (RLS enforces participant), and stamps my last_read_at
 * on open so the chat-list unread badge clears.
 *
 * Two layout slots are deliberately RESERVED but EMPTY for Cluster 2:
 *   • the stage progress bar  → task 9.6 (below the header)
 *   • the sticky action bar    → task 9.7 (above the input)
 * They are marked below so they drop in without reflowing this screen.
 */
export default function DealRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dealId = String(id);
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id ?? null;

  const [thread, setThread] = useState<DealThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Pending accept/decline state (task 9.5).
  const [acting, setActing] = useState(false);
  const [exclusivityWarning, setExclusivityWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Latest sender-name map, read by the Realtime handler without re-subscribing.
  const namesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    fetchDealThread(dealId, userId).then((data) => {
      if (!active) return;
      setThread(data);
      setMessages(data?.messages ?? []);
      namesRef.current = data?.namesById ?? {};
      setLoading(false);
    });
    // Clear my unread badge for this deal (best-effort; never blocks the open).
    void markDealRead(dealId, userId);
    return () => {
      active = false;
    };
  }, [dealId, userId]);

  // Live delivery (task 9.4): append a new message the moment its row is inserted.
  const handleIncoming = useCallback(
    (row: IncomingMessageRow) => {
      // My OWN sends are handled by the optimistic + reconcile path; drop the
      // Realtime echo so it can't double-post (closes the reconcile-vs-echo race
      // the id check alone could lose).
      if (row.sender_id === userId) return;
      setMessages((prev) => {
        // Primary dedupe: never append an id that's already in state.
        if (prev.some((m) => m.id === row.id)) return prev;
        return [
          ...prev,
          {
            id: row.id,
            senderId: row.sender_id,
            senderName: namesRef.current[row.sender_id] ?? 'Someone',
            body: row.body,
            createdAt: row.created_at,
            mine: false,
          },
        ];
      });
      // A message arriving while I'm viewing shouldn't reappear as unread later.
      if (userId) void markDealRead(dealId, userId);
    },
    [userId, dealId],
  );

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToDealMessages(dealId, session?.access_token ?? null, handleIncoming);
    return unsubscribe;
  }, [dealId, userId, session?.access_token, handleIncoming]);

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !userId || sending) return;
    setSending(true);
    setSendError(null);
    setDraft('');

    // Optimistic append with a temporary id, reconciled on the server response.
    const tempId = `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      senderId: userId,
      senderName: 'You',
      body: text,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    const res = await sendMessage(dealId, userId, text);
    if (res.ok) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? res.message : m)));
    } else {
      // Roll back the optimistic bubble and let the user retry.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(text);
      setSendError(res.message);
    }
    setSending(false);
  }, [draft, userId, sending, dealId]);

  // Accept (task 9.5). `acknowledge` re-confirms past a warn-only exclusivity notice.
  const onAccept = useCallback(
    async (acknowledge: boolean) => {
      if (acting) return;
      setActing(true);
      setActionError(null);
      const res = await acceptDeal(dealId, acknowledge);
      if (!res.ok) {
        setActionError(res.message);
      } else if (res.transitioned) {
        setExclusivityWarning(null);
        setThread((t) => (t ? { ...t, stage: 'chatting', expiresAt: null } : t));
      } else {
        // Warn-only exclusivity notice — surface it and wait for re-confirm.
        setExclusivityWarning(res.exclusivityWarning);
      }
      setActing(false);
    },
    [acting, dealId],
  );

  const onDecline = useCallback(async () => {
    if (acting) return;
    setActing(true);
    setActionError(null);
    const res = await declineDeal(dealId);
    if (!res.ok) {
      setActionError(res.message);
    } else {
      setThread((t) => (t ? { ...t, stage: 'declined' } : t));
    }
    setActing(false);
  }, [acting, dealId]);

  const pill = thread ? stagePill(thread.stage, thread.isDisputed) : null;
  const isPending = thread?.stage === 'pending';
  // Recipient = the participant who did NOT create the deal (deal-engine.md §1).
  const isRecipient = !!thread && !!userId && thread.createdBy !== userId;
  const hoursLeft = thread?.expiresAt ? hoursUntil(thread.expiresAt) : null;

  return (
    <SafeAreaView className="flex-1 bg-chatCanvas" edges={['top']}>
      {/* ── Header ── */}
      <View className="border-b border-hairline bg-app">
        <View className="flex-row items-center gap-2 px-2 py-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="h-9 w-9 items-center justify-center"
          >
            <ChevronLeftIcon width={24} height={24} color="#1C1B18" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="font-geist-semibold text-[16px] text-ink" numberOfLines={1}>
              {thread?.dealName ?? 'Deal'}
            </Text>
            {thread ? (
              <View className="mt-0.5 flex-row items-center gap-1.5">
                {pill ? (
                  <View className={`rounded-pill px-2 py-0.5 ${pill.bg}`}>
                    <Text className={`font-geist-semibold text-[10.5px] ${pill.text}`}>{pill.label}</Text>
                  </View>
                ) : null}
                {thread.otherNames.length > 0 ? (
                  <Text className="font-geist text-[12px] text-ink-2" numberOfLines={1}>
                    {thread.otherNames.join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* RESERVED — stage progress bar (task 9.6, Cluster 2). Intentionally empty. */}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#847F78" />
        </View>
      ) : !thread ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-geist text-body text-ink-2">
            This deal couldn’t be loaded.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Pending inline control (task 9.5) — a minimal accept/decline block.
              The full stage-aware sticky action bar is task 9.7 (Cluster 2). */}
          {isPending ? (
            isRecipient ? (
              <View className="border-b border-hairline bg-app px-4 py-3">
                {exclusivityWarning ? (
                  <View className="mb-2 rounded-xl bg-status-critical-tint px-3 py-2">
                    <Text className="font-geist-medium text-[13px] text-status-critical">
                      {exclusivityWarning}
                    </Text>
                    <Text className="mt-0.5 font-geist text-[12px] text-ink-2">
                      You can still accept — this is a heads-up, not a block.
                    </Text>
                  </View>
                ) : (
                  <Text className="mb-2 font-geist text-[13px] text-ink-2">
                    Respond to this connection request.
                  </Text>
                )}
                {actionError ? (
                  <Text className="mb-2 font-geist text-[12px] text-status-critical">{actionError}</Text>
                ) : null}
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={onDecline}
                    disabled={acting}
                    accessibilityRole="button"
                    accessibilityLabel="Decline connection"
                    className={`flex-1 items-center justify-center rounded-full border border-hairline bg-surface-card py-2.5 ${
                      acting ? 'opacity-50' : ''
                    }`}
                  >
                    <Text className="font-geist-semibold text-[14px] text-ink-2">Decline</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onAccept(exclusivityWarning != null)}
                    disabled={acting}
                    accessibilityRole="button"
                    accessibilityLabel="Accept connection"
                    className={`flex-1 items-center justify-center rounded-full bg-ink py-2.5 ${
                      acting ? 'opacity-50' : ''
                    }`}
                  >
                    <Text className="font-geist-semibold text-[14px] text-white">
                      {exclusivityWarning ? 'Accept anyway' : 'Accept'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="border-b border-hairline bg-app px-4 py-3">
                <Text className="font-geist text-[13px] text-ink-2">
                  Waiting for response{hoursLeft != null ? ` · expires in ${hoursLeft}h` : ''}
                </Text>
              </View>
            )
          ) : null}

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerClassName="gap-2.5 px-3.5 py-4"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToEnd}
            onLayout={scrollToEnd}
            renderItem={({ item }) => <MessageBubble message={item} />}
            ListEmptyComponent={
              <Text className="mt-8 text-center font-geist text-[13px] text-ink-3">
                No messages yet — say hello.
              </Text>
            }
          />

          {/* RESERVED — sticky action bar (task 9.7, Cluster 2). Intentionally empty. */}

          {sendError ? (
            <Text className="px-4 pb-1 font-geist text-[12px] text-status-critical">{sendError}</Text>
          ) : null}

          {/* ── Message composer ── */}
          <View className="flex-row items-end gap-2 border-t border-hairline bg-app px-3 pb-6 pt-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor="#847F78"
              multiline
              className="max-h-28 min-h-[40px] flex-1 rounded-2xl border border-hairline bg-surface-card px-3.5 py-2.5 font-geist text-[15px] text-ink"
            />
            <Pressable
              onPress={onSend}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              className={`h-10 w-10 items-center justify-center rounded-full ${
                draft.trim() && !sending ? 'bg-ink' : 'bg-avatar'
              }`}
            >
              <SendIcon width={18} height={18} color={draft.trim() && !sending ? '#FFFFFF' : '#847F78'} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

/** Whole hours from now until an ISO timestamp (floored at 0). */
function hoursUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 3_600_000));
}

/** One message bubble — mine (right, warm tint) vs theirs (left, white + name). */
function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.mine) {
    return (
      <View className="max-w-[86%] self-end rounded-2xl rounded-br-md border border-hairline bg-[#F3EFE7] px-3.5 py-2">
        <Text className="font-geist text-[15px] leading-[21px] text-ink">{message.body}</Text>
        <Text className="mt-1 self-end font-geist text-[11px] text-ink-3">
          {formatClockTime(message.createdAt)}
        </Text>
      </View>
    );
  }
  return (
    <View className="max-w-[86%] self-start rounded-2xl rounded-bl-md border border-hairline bg-surface-card px-3.5 py-2">
      <Text className="mb-0.5 font-geist-bold text-[12px] text-ink">
        {message.senderName.split(' ')[0]}
      </Text>
      <Text className="font-geist text-[15px] leading-[21px] text-ink">{message.body}</Text>
      <Text className="mt-1 self-end font-geist text-[11px] text-ink-3">
        {formatClockTime(message.createdAt)}
      </Text>
    </View>
  );
}
