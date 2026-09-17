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
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { Skeleton } from '@/components/motion/skeleton';
import {
  fetchDealThread,
  fetchDealMessage,
  markDealRead,
  sendMessage,
  subscribeToDealMessages,
  type ChatMessage,
  type DealThread,
  type IncomingMessageRow,
} from '@/lib/deals';
import { ChatAttachment, SelectedChatAttachment } from '@/components/deal/chat-attachment';
import { ChatAttachmentContextFence } from '@/lib/chat-attachment-context-fence';
import {
  mergeChatMessageById,
  parsePickedChatAttachment,
  reconcileOptimisticChatMessage,
  type PickedChatAttachment,
} from '@/lib/chat-attachment-core';
import { sendChatAttachment } from '@/lib/chat-attachments';
import { StageProgressBar } from '@/components/deal/stage-progress-bar';
import { StickyActionBar } from '@/components/deal/sticky-action-bar';
import { ParticipantSheet } from '@/components/deal/participant-sheet';
import { DealNameSheet } from '@/components/deal/deal-name-sheet';
import { formatClockTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth-store';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import SendIcon from '@/assets/icons/send.svg';
import EditIcon from '@/assets/icons/edit.svg';
import AttachmentIcon from '@/assets/icons/attach.svg';

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
  const [threadContext, setThreadContext] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [selectedAttachment, setSelectedAttachment] = useState<PickedChatAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const [participantRefresh, setParticipantRefresh] = useState(0);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Latest sender-name map, read by the Realtime handler without re-subscribing.
  const namesRef = useRef<Record<string, string>>({});
  const screenContext = `${userId ?? 'signed-out'}:${dealId}`;
  const contextRef = useRef(screenContext);
  const loadGeneration = useRef(0);
  const attachmentFence = useRef(new ChatAttachmentContextFence());
  if (contextRef.current !== screenContext) {
    contextRef.current = screenContext;
    loadGeneration.current += 1;
  }
  const currentThread = threadContext === screenContext ? thread : null;
  const isTerminal = currentThread?.stage === 'closed' || currentThread?.stage === 'declined' || currentThread?.stage === 'cancelled';
  attachmentFence.current.switchContext(`${screenContext}:${isTerminal ? 'terminal' : 'live'}`);

  // Load (or reload) the thread. Called on open AND after a stage transition, so
  // the stage bar + action bar update immediately on the acting client (9.7).
  const loadThread = useCallback(async () => {
    if (!userId) return null;
    const ticket = { context: screenContext, generation: loadGeneration.current };
    const data = await fetchDealThread(dealId, userId);
    if (contextRef.current !== ticket.context || loadGeneration.current !== ticket.generation) return null;
    setThreadContext(ticket.context);
    setThread(data);
    setMessages((prev) => [
      ...(data?.messages ?? []),
      ...prev.filter((message) => message.id.startsWith('temp-')),
    ]);
    namesRef.current = data?.namesById ?? {};
    return data;
  }, [dealId, screenContext, userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    fetchDealThread(dealId, userId).then((data) => {
      if (!active) return;
      setThreadContext(screenContext);
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
  }, [dealId, screenContext, userId]);

  useEffect(() => {
    // Temporary rows belong only to the account/deal that created them. Clear
    // them before either load for a new context can publish its thread.
    setMessages([]);
    namesRef.current = {};
    setDraft('');
    setSelectedAttachment(null);
    setSending(false);
    setSendError(null);
    setParticipantsOpen(false);
    setNameEditorOpen(false);
  }, [dealId, userId]);

  useEffect(() => () => attachmentFence.current.invalidate(), []);

  useFocusEffect(useCallback(() => {
    if (!userId) return undefined;
    setParticipantRefresh((value) => value + 1);
    void loadThread();
    return undefined;
  }, [loadThread, userId]));

  // Live delivery (task 9.4): append a new message the moment its row is inserted.
  const handleIncoming = useCallback(
    async (row: IncomingMessageRow) => {
      // My OWN sends are handled by the optimistic + reconcile path; drop the
      // Realtime echo so it can't double-post (closes the reconcile-vs-echo race
      // the id check alone could lose).
      if (row.sender_id === userId || row.deal_id !== dealId) return;
      const context = `${screenContext}:${isTerminal ? 'terminal' : 'live'}`;
      const ticket = attachmentFence.current.begin(context, row.id);
      const hydrated = await fetchDealMessage(
        dealId,
        row.id,
        userId ?? '',
        namesRef.current[row.sender_id] ?? 'Someone',
      );
      if (!hydrated || !attachmentFence.current.isCurrent(ticket, row.id)) return;
      setMessages((prev) => mergeChatMessageById(prev, hydrated));
      // A message arriving while I'm viewing shouldn't reappear as unread later.
      if (userId) void markDealRead(dealId, userId);
    },
    [userId, dealId, isTerminal, screenContext],
  );

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToDealMessages(dealId, session?.access_token ?? null, handleIncoming);
    return unsubscribe;
  }, [dealId, userId, session?.access_token, handleIncoming]);

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const chooseAttachment = useCallback(async () => {
    if (sending || isTerminal) return;
    const context = `${screenContext}:live`;
    const ticket = attachmentFence.current.begin(context);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!attachmentFence.current.isCurrent(ticket) || result.canceled) return;
    const picked = parsePickedChatAttachment(result.assets[0] ?? {});
    if (!picked) {
      setSendError('Choose a PDF, JPEG, PNG, WebP, MP4, or MOV file with a matching extension.');
      return;
    }
    setSelectedAttachment(picked);
    setSendError(null);
  }, [isTerminal, screenContext, sending]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !selectedAttachment) || !userId || sending || isTerminal) return;
    setSending(true);
    setSendError(null);

    if (selectedAttachment) {
      const context = `${screenContext}:live`;
      const ticket = attachmentFence.current.begin(context);
      const result = await sendChatAttachment(
        dealId,
        userId,
        selectedAttachment,
        text,
        () => attachmentFence.current.isCurrent(ticket),
      );
      if (!attachmentFence.current.isCurrent(ticket)) return;
      if (result.ok) {
        setMessages((prev) => mergeChatMessageById(prev, {
          ...result.message,
          senderName: 'You',
          mine: true,
          attachments: [result.message.attachment],
          attachmentUnavailable: false,
        }));
        setDraft('');
        setSelectedAttachment(null);
      } else if (!result.stale) {
        setSendError(result.message);
        if (result.readOnly) await loadThread();
      }
      if (attachmentFence.current.isCurrent(ticket)) setSending(false);
      return;
    }

    const textSendTicket = attachmentFence.current.begin(`${screenContext}:live`);
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
      attachments: [],
      attachmentUnavailable: false,
    };
    setMessages((prev) => [...prev, optimistic]);

    const res = await sendMessage(dealId, userId, text);
    if (!attachmentFence.current.isCurrent(textSendTicket)) return;
    if (res.ok) {
      setMessages((prev) => reconcileOptimisticChatMessage(prev, tempId, res.message));
    } else {
      // Roll back stale optimistic sends. A terminal database rejection is
      // authoritative: clear the draft and refresh instead of inviting replay.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (res.readOnly) {
        setDraft('');
        await loadThread();
        if (!attachmentFence.current.isCurrent(textSendTicket)) return;
      } else {
        setDraft(text);
      }
      setSendError(res.message);
    }
    if (attachmentFence.current.isCurrent(textSendTicket)) setSending(false);
  }, [draft, userId, sending, dealId, loadThread, selectedAttachment, isTerminal, screenContext]);

  useEffect(() => {
    if (isTerminal) {
      attachmentFence.current.invalidate();
      setDraft('');
      setSelectedAttachment(null);
      setSending(false);
      setNameEditorOpen(false);
    }
    if (currentThread?.dealNameVersion === null) setNameEditorOpen(false);
  }, [currentThread?.dealNameVersion, isTerminal]);

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
            <View className="flex-row items-center gap-1.5">
              <Text className="min-w-0 flex-shrink font-geist-semibold text-subtitle text-ink" numberOfLines={1}>
                {currentThread?.dealName ?? 'Deal'}
              </Text>
              {currentThread && !isTerminal && currentThread.dealNameVersion !== null ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Edit deal name" hitSlop={8} onPress={() => setNameEditorOpen(true)} className="h-8 w-8 items-center justify-center">
                  <EditIcon width={15} height={15} color="#5D5953" />
                </Pressable>
              ) : null}
            </View>
            {currentThread ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`View ${Object.keys(currentThread.namesById).length} deal participants`} onPress={() => setParticipantsOpen(true)} className="self-start py-0.5">
                <Text className="font-geist text-secondary tabular-nums text-ink-2" numberOfLines={1}>
                  {Object.keys(currentThread.namesById).length} in this deal ›
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Stage progress bar (task 9.6). */}
        {currentThread ? <StageProgressBar stage={currentThread.stage} isDisputed={currentThread.isDisputed} /> : null}
      </View>

      {loading ? (
        <Skeleton.Thread />
      ) : !currentThread ? (
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
            renderItem={({ item }) => <MessageBubble message={item} dealId={dealId} contextKey={screenContext} />}
            ListEmptyComponent={
              <Text className="mt-8 text-center font-geist text-[13px] text-ink-3">
                No messages yet — say hello.
              </Text>
            }
          />

          {/* Sticky action bar (task 9.7) — stage- + role-aware transition requests. */}
          <StickyActionBar
            thread={currentThread}
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
            <View className="border-t border-hairline bg-app px-3 pb-6 pt-2">
              {selectedAttachment ? (
                <SelectedChatAttachment attachment={selectedAttachment} onRemove={() => setSelectedAttachment(null)} />
              ) : null}
              <View className="flex-row items-end gap-2">
                <Pressable
                  onPress={chooseAttachment}
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityLabel="Attach image, video, or PDF"
                  className="h-10 w-10 items-center justify-center rounded-full border border-hairline bg-surface-card"
                >
                  <AttachmentIcon width={18} height={18} color={sending ? '#847F78' : '#1C1B18'} />
                </Pressable>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={selectedAttachment ? 'Add a caption (optional)' : 'Message'}
                  placeholderTextColor="#847F78"
                  multiline
                  editable={!sending}
                  className="max-h-28 min-h-[40px] flex-1 rounded-2xl border border-hairline bg-surface-card px-3.5 py-2.5 font-geist text-body text-ink"
                />
                <Pressable
                  onPress={onSend}
                  disabled={(!draft.trim() && !selectedAttachment) || sending}
                  accessibilityRole="button"
                  accessibilityLabel={selectedAttachment ? 'Send attachment' : 'Send message'}
                  className={`h-10 w-10 items-center justify-center rounded-full ${
                    (draft.trim() || selectedAttachment) && !sending ? 'bg-ink' : 'bg-avatar'
                  }`}
                >
                  {sending ? <ActivityIndicator size="small" color="#847F78" /> : (
                    <SendIcon width={18} height={18} color={(draft.trim() || selectedAttachment) ? '#FFFFFF' : '#847F78'} />
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
      <ParticipantSheet
        visible={participantsOpen}
        dealId={dealId}
        accountId={userId ?? 'signed-out'}
        refreshToken={participantRefresh}
        onClose={() => setParticipantsOpen(false)}
        onChanged={async () => { await loadThread(); }}
      />
      {currentThread ? (
        <DealNameSheet
          visible={nameEditorOpen}
          dealId={dealId}
          accountId={userId ?? 'signed-out'}
          displayedName={currentThread.dealName}
          displayedVersion={currentThread.dealNameVersion}
          onClose={() => setNameEditorOpen(false)}
          onStale={loadThread}
          onRenamed={(result, expectedVersion) => {
            if (contextRef.current !== screenContext) return;
            setThread((current) => current && current.dealNameVersion === expectedVersion ? {
              ...current,
              dealName: result.deal_name,
              dealNameVersion: result.deal_name_version,
            } : current);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** One message bubble — mine (right, warm tint) vs theirs (left, white + name). */
function MessageBubble({ message, dealId, contextKey }: { message: ChatMessage; dealId: string; contextKey: string }) {
  if (message.mine) {
    return (
      <View className="max-w-[86%] self-end rounded-2xl rounded-br-md border border-hairline bg-[#F3EFE7] px-3.5 py-2">
        {message.attachments.map((attachment) => (
          <ChatAttachment key={`${contextKey}:${message.id}:${attachment.id}`} attachment={attachment} unavailable={false} dealId={dealId} contextKey={contextKey} messageId={message.id} />
        ))}
        {message.attachmentUnavailable ? <ChatAttachment attachment={null} unavailable dealId={dealId} contextKey={contextKey} messageId={message.id} /> : null}
        {message.body ? <Text className="font-geist text-body text-ink">{message.body}</Text> : null}
        <Text className="mt-1 self-end font-geist text-micro text-ink-3">
          {formatClockTime(message.createdAt)}
        </Text>
      </View>
    );
  }
  return (
    <View className="max-w-[86%] self-start rounded-2xl rounded-bl-md border border-hairline bg-surface-card px-3.5 py-2">
      <Text className="mb-0.5 font-geist-bold text-micro text-ink">
        {message.senderName.split(' ')[0]}
      </Text>
      {message.attachments.map((attachment) => (
        <ChatAttachment key={`${contextKey}:${message.id}:${attachment.id}`} attachment={attachment} unavailable={false} dealId={dealId} contextKey={contextKey} messageId={message.id} />
      ))}
      {message.attachmentUnavailable ? <ChatAttachment attachment={null} unavailable dealId={dealId} contextKey={contextKey} messageId={message.id} /> : null}
      {message.body ? <Text className="font-geist text-body text-ink">{message.body}</Text> : null}
      <Text className="mt-1 self-end font-geist text-micro text-ink-3">
        {formatClockTime(message.createdAt)}
      </Text>
    </View>
  );
}
