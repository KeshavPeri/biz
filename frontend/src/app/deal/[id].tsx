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
  fetchDealThread,
  markDealRead,
  sendMessage,
  subscribeToDealMessages,
  type ChatMessage,
  type DealThread,
  type IncomingMessageRow,
} from '@/lib/deals';
import { StageProgressBar } from '@/components/deal/stage-progress-bar';
import { StickyActionBar } from '@/components/deal/sticky-action-bar';
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
 * The header includes the stage progress bar and the composer includes the
 * role-aware action bar, including the Chatting checklist / Gate-A workflow.
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

  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Latest sender-name map, read by the Realtime handler without re-subscribing.
  const namesRef = useRef<Record<string, string>>({});

  // Load (or reload) the thread. Called on open AND after a stage transition, so
  // the stage bar + action bar update immediately on the acting client (9.7).
  const loadThread = useCallback(async () => {
    if (!userId) return;
    const data = await fetchDealThread(dealId, userId);
    setThread(data);
    setMessages((prev) => (prev.length ? prev : data?.messages ?? []));
    namesRef.current = data?.namesById ?? {};
  }, [dealId, userId]);

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

  useEffect(() => {
    setDraft('');
    setSendError(null);
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
      // Roll back stale optimistic sends. A terminal database rejection is
      // authoritative: clear the draft and refresh instead of inviting replay.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (res.readOnly) {
        setDraft('');
        await loadThread();
      } else {
        setDraft(text);
      }
      setSendError(res.message);
    }
    setSending(false);
  }, [draft, userId, sending, dealId, loadThread]);

  // Terminal stages make the thread read-only (deal-engine.md).
  const isTerminal = thread?.stage === 'closed' || thread?.stage === 'declined' || thread?.stage === 'cancelled';

  useEffect(() => {
    if (isTerminal) {
      setDraft('');
      setSending(false);
    }
  }, [isTerminal]);

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
            {thread && thread.otherNames.length > 0 ? (
              <Text className="mt-0.5 font-geist text-[12px] text-ink-2" numberOfLines={1}>
                {thread.otherNames.join(', ')}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Stage progress bar (task 9.6). */}
        {thread ? <StageProgressBar stage={thread.stage} isDisputed={thread.isDisputed} /> : null}
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

          {/* Sticky action bar (task 9.7) — stage- + role-aware transition requests. */}
          <StickyActionBar
            thread={thread}
            userId={userId ?? ''}
            accessToken={session?.access_token ?? null}
            messages={messages}
            onTransitioned={loadThread}
          />

          {sendError ? (
            <Text className="px-4 pb-1 font-geist text-[12px] text-status-critical">{sendError}</Text>
          ) : null}

          {/* ── Message composer (read-only once the deal reaches a terminal stage) ── */}
          {isTerminal ? null : (
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
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
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
