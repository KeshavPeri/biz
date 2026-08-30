import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { EditSheet } from '@/components/ui/edit-sheet';

type Result = { ok: true } | { ok: false; message: string };

export function ContentSubmissionSheet({
  visible,
  roundNumber,
  roundMax,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  roundNumber: number;
  roundMax: number;
  onClose: () => void;
  onSubmit: (asset: DocumentPicker.DocumentPickerAsset) => Promise<Result>;
}) {
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAsset(null);
    setBusy(false);
    setError(null);
  }, [visible, roundNumber]);

  const choose = async () => {
    if (busy) return;
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled && result.assets[0]) setAsset(result.assets[0]);
  };

  const confirm = async () => {
    if (!asset || busy) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit(asset);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title={`Submit round ${roundNumber} of ${roundMax}`}
      subtitle="The submitted file becomes part of the shared, append-only review history."
      footer={
        <Pressable
          onPress={confirm}
          disabled={!asset || busy}
          accessibilityRole="button"
          className={`items-center rounded-full bg-ink py-3 ${!asset || busy ? 'opacity-40' : ''}`}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : (
            <Text className="font-geist-semibold text-white">Submit for review</Text>
          )}
        </Pressable>
      }
    >
      <View className="gap-3">
        <Pressable
          onPress={choose}
          disabled={busy}
          accessibilityRole="button"
          className="rounded-xl border border-hairline bg-surface-card px-3 py-3"
        >
          <Text className="font-geist-semibold text-[13px] text-ink">
            {asset ? 'Choose a different file' : 'Choose draft file'}
          </Text>
          <Text className="mt-1 font-geist text-[11px] text-ink-3">PDF, JPEG, PNG, WebP, MP4, or MOV · up to 100 MB</Text>
        </Pressable>
        {asset ? (
          <View className="rounded-xl bg-surface-recess px-3 py-3">
            <Text selectable className="font-geist-semibold text-[12px] text-ink">{asset.name}</Text>
            <Text className="mt-1 font-geist text-[11px] text-ink-3">
              {asset.mimeType ?? 'Type checked during upload'} · {formatBytes(asset.size)}
            </Text>
            <Text className="mt-1 font-geist-medium text-[11px] text-ink-2">
              {busy ? 'Uploading and verifying…' : 'Ready to upload'}
            </Text>
          </View>
        ) : null}
        {error ? <Text className="font-geist-medium text-[12px] text-status-critical">{error}</Text> : null}
      </View>
    </EditSheet>
  );
}

export function RevisionRequestSheet({
  visible,
  roundNumber,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  roundNumber: number;
  onClose: () => void;
  onSubmit: (comment: string) => Promise<Result>;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setComment('');
    setBusy(false);
    setError(null);
  }, [visible, roundNumber]);

  const confirm = async () => {
    if (busy || comment.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit(comment.trim());
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title={`Request changes to round ${roundNumber}`}
      subtitle="Explain exactly what the creator should revise. This decision cannot be edited later."
      footer={
        <Pressable
          onPress={confirm}
          disabled={busy || comment.trim().length < 3}
          accessibilityRole="button"
          className={`items-center rounded-full bg-ink py-3 ${busy || comment.trim().length < 3 ? 'opacity-40' : ''}`}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : (
            <Text className="font-geist-semibold text-white">Request revision</Text>
          )}
        </Pressable>
      }
    >
      <TextInput
        value={comment}
        onChangeText={setComment}
        editable={!busy}
        multiline
        maxLength={1000}
        placeholder="Describe the required changes…"
        placeholderTextColor="#7A7A7A"
        className="min-h-32 rounded-xl border border-hairline bg-surface-card px-3 py-3 font-geist text-[13px] text-ink"
      />
      <Text className="mt-1 text-right font-geist text-[10.5px] text-ink-3">{comment.length}/1000</Text>
      {error ? <Text className="mt-2 font-geist-medium text-[12px] text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}

function formatBytes(value: number | undefined): string {
  if (value == null) return 'Size checked during upload';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
