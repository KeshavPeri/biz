import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { EditSheet } from '@/components/ui/edit-sheet';
import { SignaturePad } from '@/components/ui/signature-pad';
import {
  removeWetSignedContract,
  uploadWetSignedContract,
  type ContractSignPayload,
} from '@/lib/deals';

type Result = { ok: true } | { ok: false; message: string };
type Mode = ContractSignPayload['mode'];

const MODE_COPY: Record<Mode, { title: string; description: string }> = {
  stored: { title: 'Use stored signature', description: 'Apply the active signature saved to your Inflo account.' },
  drawn: { title: 'Draw a new signature', description: 'Draw a fresh signature for this contract only.' },
  print_bypass: { title: 'Print and sign', description: 'Upload the completed wet-signed PDF from your device.' },
};

export function ContractSignSheet({
  visible,
  dealId,
  contractId,
  onClose,
  onSign,
}: {
  visible: boolean;
  dealId: string;
  contractId: string;
  onClose: () => void;
  onSign: (body: ContractSignPayload) => Promise<Result>;
}) {
  const [mode, setMode] = useState<Mode>('stored');
  const [svg, setSvg] = useState('');
  const [reason, setReason] = useState('');
  const [uploaded, setUploaded] = useState<{ name: string; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMode('stored');
    setSvg('');
    setReason('');
    setUploaded(null);
    setError(null);
    setBusy(false);
  }, [visible, contractId]);

  const close = () => {
    if (busy) return;
    if (uploaded?.path) void removeWetSignedContract(uploaded.path);
    onClose();
  };

  const choosePdf = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) {
      setBusy(false);
      return;
    }
    const prior = uploaded?.path;
    const result = await uploadWetSignedContract(dealId, contractId, picked.assets[0]);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    if (prior) void removeWetSignedContract(prior);
    setUploaded({ name: picked.assets[0].name, path: result.path });
    setBusy(false);
  };

  const confirm = async () => {
    if (busy) return;
    setError(null);
    if (mode === 'drawn' && !svg) {
      setError('Draw your signature before confirming.');
      return;
    }
    if (mode === 'print_bypass' && reason.trim().length < 3) {
      setError('Add a short reason for printing and signing.');
      return;
    }
    if (mode === 'print_bypass' && !uploaded) {
      setError('Choose and upload the completed signed PDF first.');
      return;
    }
    setBusy(true);
    const result = await onSign({
      mode,
      svg: mode === 'drawn' ? svg : undefined,
      bypass_reason: mode === 'print_bypass' ? reason.trim() : undefined,
      physical_doc_path: mode === 'print_bypass' ? uploaded?.path : undefined,
    });
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    // The uploaded file is now referenced by the append-only signature/request;
    // the backend retained an immutable evidence copy, so remove this temporary
    // owner-folder upload after a successful sign/hold.
    if (uploaded?.path) await removeWetSignedContract(uploaded.path);
    setUploaded(null);
    setBusy(false);
    onClose();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={close}
      scrollEnabled={!drawing}
      title="Review and sign contract"
      subtitle="Confirming records your signing method and time. Brand maker actions may be held for checker approval."
      footer={
        <Pressable
          onPress={confirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Confirm signature"
          className={`items-center rounded-full bg-ink py-3 ${busy ? 'opacity-50' : ''}`}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-geist-semibold text-white">Confirm signature</Text>}
        </Pressable>
      }
    >
      <View className="gap-2">
        {(['stored', 'drawn', 'print_bypass'] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => { setMode(item); setError(null); }}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === item }}
            className={`rounded-xl border p-3 ${mode === item ? 'border-ink bg-surface-recess' : 'border-hairline bg-surface-card'}`}
          >
            <Text className="font-geist-semibold text-ink">{MODE_COPY[item].title}</Text>
            <Text className="mt-1 font-geist text-[12px] text-ink-2">{MODE_COPY[item].description}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'drawn' ? (
        <View className="mt-4">
          <SignaturePad onChange={setSvg} onDragActiveChange={setDrawing} />
        </View>
      ) : null}

      {mode === 'print_bypass' ? (
        <View className="mt-4 gap-3">
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            multiline
            placeholder="Why are you printing and signing?"
            placeholderTextColor="#847F78"
            className="min-h-20 rounded-xl border border-hairline bg-surface-card p-3 font-geist text-ink"
          />
          <Pressable
            onPress={choosePdf}
            disabled={busy}
            accessibilityRole="button"
            className="items-center rounded-full border border-hairline bg-surface-card py-2.5"
          >
            <Text className="font-geist-semibold text-[13px] text-ink">
              {uploaded ? 'Replace signed PDF' : 'Choose signed PDF'}
            </Text>
          </Pressable>
          {uploaded ? (
            <View className="rounded-xl bg-status-good-tint px-3 py-2">
              <Text className="font-geist-medium text-[12px] text-status-good-label" numberOfLines={2}>
                Uploaded privately · {uploaded.name}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text className="mt-3 font-geist text-[12px] text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}
