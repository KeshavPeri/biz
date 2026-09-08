import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { EditSheet } from '@/components/ui/edit-sheet';

type Result = { ok: true } | { ok: false; message: string };

export function PostCloseEntrySheet({
  visible,
  dealId,
  accountId,
  visibility,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  dealId: string;
  accountId: string;
  visibility: 'shared' | 'private';
  onClose: () => void;
  onSubmit: (body: string, requestId: string) => Promise<Result>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    setBody('');
    setBusy(false);
    setError(null);
    requestId.current = null;
  }, [accountId, dealId, visibility, visible]);

  const trimmed = body.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 2000;
  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    requestId.current ??= Crypto.randomUUID();
    const result = await onSubmit(trimmed, requestId.current);
    setBusy(false);
    if (result.ok) {
      requestId.current = null;
      setBody('');
      onClose();
    } else {
      setError(result.message);
    }
  };

  const isPrivate = visibility === 'private';
  return (
    <EditSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title={isPrivate ? 'Add a private note' : 'Add a shared comment'}
      subtitle={isPrivate ? 'Only you can retrieve this note.' : 'Current deal participants can read this follow-up.'}
      footer={(
        <Pressable accessibilityRole="button" accessibilityLabel={isPrivate ? 'Save private note' : 'Post shared comment'} disabled={!valid || busy} onPress={() => void submit()} className={`min-h-12 items-center justify-center rounded-2xl bg-ink px-4 py-3 ${!valid || busy ? 'opacity-40' : ''}`}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-geist-semibold text-[13px] text-white">{isPrivate ? 'Save private note' : 'Post shared comment'}</Text>}
        </Pressable>
      )}
    >
      <View className="gap-3">
        <View className={`rounded-xl px-3 py-3 ${isPrivate ? 'bg-surface-recess' : 'bg-avatar'}`}>
          <Text className="font-geist-semibold text-[12px] text-ink">Visibility: {isPrivate ? 'Only me' : 'All current participants'}</Text>
          <Text className="mt-1 font-geist text-[10.5px] leading-[15px] text-ink-2">{isPrivate ? 'No one else is notified, and this note is excluded from the chat archive.' : 'Others receive a generic notification without the comment text.'}</Text>
        </View>
        <TextInput value={body} onChangeText={(value) => { setBody(value); setError(null); }} editable={!busy} multiline maxLength={2000} accessibilityLabel={`${isPrivate ? 'Private note' : 'Shared comment'}, 1 to 2,000 characters`} placeholder={isPrivate ? 'Write a note for yourself…' : 'Add a follow-up for participants…'} placeholderTextColor="#847F78" className="min-h-28 rounded-xl border border-hairline bg-surface-card px-3 py-3 font-geist text-[13px] leading-[19px] text-ink" />
        <Text className="text-right font-geist text-[10.5px] text-ink-3">{trimmed.length}/2,000</Text>
        {error ? <Text accessibilityRole="alert" className="font-geist-medium text-[11px] leading-[16px] text-status-critical">{error}</Text> : null}
      </View>
    </EditSheet>
  );
}
