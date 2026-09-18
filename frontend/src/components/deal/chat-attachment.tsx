import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import {
  formatChatAttachmentSize,
  type ChatAttachment as ChatAttachmentValue,
  type PickedChatAttachment,
} from '@/lib/chat-attachment-core';
import { getSignedChatAttachmentUrl } from '@/lib/chat-attachments';

import AttachmentIcon from '@/assets/icons/attach.svg';
import CloseIcon from '@/assets/icons/x-circle.svg';

export function SelectedChatAttachment({
  attachment,
  onRemove,
}: {
  attachment: PickedChatAttachment;
  onRemove: () => void;
}) {
  return (
    <View className="mb-2 flex-row items-center gap-2 rounded-xl border border-hairline bg-surface-card px-3 py-2">
      <AttachmentIcon width={18} height={18} color="#5E574E" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-geist-medium text-secondary text-ink">{attachment.name}</Text>
        <Text className="font-geist text-micro text-ink-3">
          {attachment.size == null ? 'Size checked before upload' : formatChatAttachmentSize(attachment.size)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.name}`}
        hitSlop={8}
        onPress={onRemove}
        className="h-8 w-8 items-center justify-center"
      >
        <CloseIcon width={18} height={18} color="#5E574E" />
      </Pressable>
    </View>
  );
}

export function ChatAttachment({
  attachment,
  unavailable,
  dealId,
  contextKey,
  messageId,
}: {
  attachment: ChatAttachmentValue | null;
  unavailable: boolean;
  dealId: string;
  contextKey: string;
  messageId: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef(`${contextKey}:${messageId}`);
  liveRef.current = `${contextKey}:${messageId}`;
  const isImage = attachment?.fileType.startsWith('image/') ?? false;

  useEffect(() => {
    const operation = `${contextKey}:${messageId}`;
    liveRef.current = operation;
    return () => {
      if (liveRef.current === operation) liveRef.current = '';
    };
  }, [contextKey, messageId]);

  useEffect(() => {
    const operation = `${contextKey}:${messageId}`;
    setPreviewUrl(null);
    setError(null);
    if (!attachment || !isImage) return undefined;
    let active = true;
    setLoading(true);
    void getSignedChatAttachmentUrl(dealId, messageId, attachment.id).then((url) => {
      if (!active || liveRef.current !== operation) return;
      setPreviewUrl(url);
      setLoading(false);
      if (!url) setError('Image unavailable');
    });
    return () => { active = false; };
  }, [attachment, contextKey, dealId, isImage, messageId]);

  const open = useCallback(async () => {
    if (!attachment || loading) return;
    const operation = `${contextKey}:${messageId}`;
    setLoading(true);
    setError(null);
    const url = await getSignedChatAttachmentUrl(dealId, messageId, attachment.id);
    if (liveRef.current !== operation) return;
    if (!url) {
      setLoading(false);
      setError('Attachment unavailable');
      return;
    }
    try {
      if (liveRef.current !== operation) return;
      await Linking.openURL(url);
    } catch {
      if (liveRef.current === operation) setError('Attachment could not be opened');
    } finally {
      if (liveRef.current === operation) setLoading(false);
    }
  }, [attachment, contextKey, dealId, loading, messageId]);

  if (!attachment && !unavailable) return null;

  if (!attachment || unavailable) {
    return (
      <View accessibilityLabel="Attachment unavailable" className="my-1 rounded-xl border border-hairline bg-app px-3 py-2">
        <Text className="font-geist text-secondary text-ink-3">Attachment unavailable</Text>
      </View>
    );
  }

  if (isImage) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open image ${attachment.fileName}`}
        disabled={loading && !previewUrl}
        onPress={open}
        className="my-1 overflow-hidden rounded-xl border border-hairline bg-app"
      >
        {previewUrl ? (
          <Image source={{ uri: previewUrl }} cachePolicy="none" contentFit="cover" style={{ width: 240, height: 180 }} />
        ) : (
          <View className="h-28 w-60 items-center justify-center px-3">
            <Text className="font-geist text-secondary text-ink-3">{loading ? 'Loading image…' : error ?? 'Image unavailable'}</Text>
          </View>
        )}
        <Text numberOfLines={1} className="px-3 pb-2 pt-1 font-geist text-micro text-ink-2">{attachment.fileName}</Text>
      </Pressable>
    );
  }

  const typeLabel = attachment.fileType === 'application/pdf' ? 'PDF' : 'Video';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${typeLabel} ${attachment.fileName}, ${formatChatAttachmentSize(attachment.fileSize)}`}
      disabled={loading}
      onPress={open}
      className="my-1 flex-row items-center gap-2 rounded-xl border border-hairline bg-app px-3 py-2"
    >
      <AttachmentIcon width={20} height={20} color="#5E574E" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-geist-medium text-secondary text-ink">{attachment.fileName}</Text>
        <Text className="font-geist text-micro text-ink-3">
          {loading ? 'Opening…' : `${typeLabel} · ${formatChatAttachmentSize(attachment.fileSize)}`}
        </Text>
        {error ? <Text className="font-geist text-micro text-status-critical">{error}</Text> : null}
      </View>
    </Pressable>
  );
}
