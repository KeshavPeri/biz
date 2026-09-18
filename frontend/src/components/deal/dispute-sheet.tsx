import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import type { DisputeEvidenceReference } from '@/lib/deals';

export type DisputeEvidenceChoice = DisputeEvidenceReference & { label: string; snippet: string };

type SubmitResult = { ok: true } | { ok: false; message: string; opened: boolean };

export function DisputeSheet({
  visible,
  dealId,
  accountId,
  evidenceChoices,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  dealId: string;
  accountId: string;
  evidenceChoices: DisputeEvidenceChoice[];
  onClose: () => void;
  onSubmit: (description: string, evidence: DisputeEvidenceReference[]) => Promise<SubmitResult>;
}) {
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<DisputeEvidenceReference[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription('');
    setSelected([]);
    setConfirming(false);
    setBusy(false);
    setError(null);
  }, [accountId, dealId, visible]);

  const trimmed = description.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= 2000;
  const selectedKeys = useMemo(() => new Set(selected.map((item) => `${item.kind}:${item.id}`)), [selected]);

  const close = () => { if (!busy) onClose(); };
  const toggle = (choice: DisputeEvidenceChoice) => {
    if (busy) return;
    const key = `${choice.kind}:${choice.id}`;
    if (selectedKeys.has(key)) {
      setSelected((items) => items.filter((item) => `${item.kind}:${item.id}` !== key));
    } else if (selected.length < 10) {
      setSelected((items) => [...items, { kind: choice.kind, id: choice.id }]);
    }
    setError(null);
  };
  const continueToConfirmation = () => {
    if (!valid) return;
    setConfirming(true);
    setError(null);
  };
  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit(trimmed, selected);
    setBusy(false);
    if (result.ok || result.opened) {
      onClose();
      return;
    }
    setError(result.message);
  };

  const footer = confirming ? (
    <View className="gap-2">
      <Button action="primary" size="lg" accessibilityLabel="Confirm and raise payment dispute" isDisabled={busy} onPress={() => void submit()}>
        {busy ? <ButtonSpinner /> : <ButtonText>Raise dispute</ButtonText>}
      </Button>
      <Button action="secondary" accessibilityLabel="Go back to dispute details" isDisabled={busy} onPress={() => setConfirming(false)}>
        <ButtonText>Review details</ButtonText>
      </Button>
    </View>
  ) : (
    <Button action="primary" size="lg" accessibilityLabel="Continue to dispute confirmation" isDisabled={!valid} onPress={continueToConfirmation}>
      <ButtonText>Continue</ButtonText>
    </Button>
  );

  return (
    <EditSheet visible={visible} onClose={close} title={confirming ? 'Confirm payment dispute' : 'Raise a payment dispute'} subtitle={confirming ? 'Raising this pauses Payment tracking. Platform operations must later resolve it.' : 'Describe the issue. You can optionally attach evidence already visible in this deal.'} footer={footer}>
      {confirming ? (
        <View className="gap-3">
          <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-3">
            <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
            <View className="min-w-0 flex-1">
              <Text className="font-geist-semibold text-secondary text-status-critical">Payment tracking will pause</Text>
              <Text className="mt-1 font-geist text-micro text-ink-2">This does not resolve the dispute, restart payment, or move money.</Text>
            </View>
          </View>
          <Text className="font-geist text-micro text-ink-2">{trimmed}</Text>
          <Text className="font-geist text-micro text-ink-3">{selected.length} evidence item{selected.length === 1 ? '' : 's'} selected</Text>
        </View>
      ) : (
        <View className="gap-3">
          <View>
            <Text className="mb-1.5 font-geist-semibold text-secondary text-ink">What happened?</Text>
            <TextInput value={description} onChangeText={(value) => { setDescription(value); setError(null); }} editable={!busy} multiline maxLength={2000} autoCorrect onFocus={() => setError(null)} accessibilityLabel="Dispute description, 10 to 2,000 characters" placeholder="Describe the payment concern…" placeholderTextColor="#847F78" className="min-h-28 rounded-xl border border-hairline bg-surface-card px-3 py-3 font-geist text-secondary text-ink" />
            <Text className={`mt-1 text-right font-geist text-micro ${valid ? 'text-ink-3' : 'text-status-critical'}`}>{trimmed.length}/2,000 · minimum 10</Text>
          </View>
          <View className="gap-1.5">
            <Text className="font-geist-semibold text-secondary text-ink">Optional evidence</Text>
            <Text className="font-geist text-micro text-ink-2">Select up to 10 messages or current live-post records already visible here.</Text>
            {evidenceChoices.length ? evidenceChoices.map((choice) => {
              const active = selectedKeys.has(`${choice.kind}:${choice.id}`);
              return <Pressable key={`${choice.kind}:${choice.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: active }} accessibilityLabel={`Evidence: ${choice.label}`} disabled={busy || (!active && selected.length >= 10)} onPress={() => toggle(choice)} className={`min-h-12 flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${active ? 'border-ink bg-surface-recess' : 'border-hairline bg-surface-card'}`}>
                <View className={`h-4 w-4 rounded border ${active ? 'border-ink bg-ink' : 'border-cane-4 bg-surface-card'}`} />
                <View className="min-w-0 flex-1"><Text className="font-geist-medium text-micro text-ink">{choice.label}</Text><Text numberOfLines={2} className="mt-0.5 font-geist text-micro text-ink-2">{choice.snippet}</Text></View>
              </Pressable>;
            }) : <Text className="rounded-xl bg-surface-recess px-3 py-2.5 font-geist text-micro text-ink-2">No eligible evidence is currently loaded. You can still raise a dispute without it.</Text>}
            <Text className="text-right font-geist text-micro text-ink-3">{selected.length}/10 selected</Text>
          </View>
        </View>
      )}
      {error ? <Text accessibilityRole="alert" className="mt-3 font-geist-medium text-micro text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}
