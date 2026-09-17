import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { DealNameContextFence } from '@/lib/deal-name-context-fence';
import { renameDeal, type DealNameResult, type DealThread } from '@/lib/deals';

export function DealNameSheet({
  visible,
  dealId,
  accountId,
  displayedName,
  displayedVersion,
  onClose,
  onRenamed,
  onStale,
}: {
  visible: boolean;
  dealId: string;
  accountId: string;
  displayedName: string;
  displayedVersion: number | null;
  onClose: () => void;
  onRenamed: (result: DealNameResult, expectedVersion: number) => void;
  onStale: () => Promise<DealThread | null | undefined>;
}) {
  const identity = `${accountId}:${dealId}`;
  const fence = useRef(new DealNameContextFence()).current;
  fence.switchContext(identity);
  const displayedVersionRef = useRef(displayedVersion);
  displayedVersionRef.current = displayedVersion;

  const [draft, setDraft] = useState('');
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasVisible = useRef(false);
  const priorIdentity = useRef(identity);

  useEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (opening) {
      setDraft(displayedName);
      setExpectedVersion(displayedVersion);
      setBusy(false);
      setError(displayedVersion === null ? 'Refresh before editing this deal name.' : null);
    }
  }, [displayedName, displayedVersion, visible]);

  useEffect(() => {
    if (priorIdentity.current === identity) return;
    priorIdentity.current = identity;
    setDraft('');
    setExpectedVersion(null);
    setBusy(false);
    setError(null);
    wasVisible.current = false;
  }, [identity]);

  const save = async () => {
    if (busy || expectedVersion === null || !draft.trim()) return;
    const ticket = fence.begin(identity, displayedVersionRef.current);
    const requestedVersion = expectedVersion;
    setBusy(true);
    setError(null);
    const response = await renameDeal(dealId, draft, expectedVersion);
    if (!fence.isCurrent(ticket, displayedVersionRef.current)) return;

    if (response.ok) {
      setBusy(false);
      onRenamed(response.result, requestedVersion);
      onClose();
      return;
    }

    if (response.stale) {
      const latest = await onStale();
      if (!fence.isIdentityCurrent(ticket)) return;
      setExpectedVersion(latest?.dealNameVersion ?? null);
      setBusy(false);
      setError(
        latest
          ? `${response.message} The current name is “${latest.dealName}”. Your draft was kept.`
          : response.message,
      );
      return;
    }

    setBusy(false);
    setError(response.message);
  };

  const disabled = busy || expectedVersion === null || !draft.trim() || draft.length > 640;
  return (
    <EditSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title="Rename deal"
      subtitle="Everyone in this deal will see the same name after refresh."
      footer={(
        <View className="flex-row gap-2">
          <Button action="secondary" accessibilityLabel="Cancel deal name edit" isDisabled={busy} onPress={onClose} className="flex-1">
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button action="primary" accessibilityLabel="Save deal name" accessibilityState={{ disabled, busy }} isDisabled={disabled} onPress={() => { void save(); }} className="flex-1">
            {busy ? <ButtonSpinner /> : <ButtonText>Save name</ButtonText>}
          </Button>
        </View>
      )}
    >
      <View className="gap-2">
        <TextInput
          value={draft}
          onChangeText={(value) => { setDraft(value); setError(null); }}
          editable={!busy && expectedVersion !== null}
          accessibilityLabel="Deal name"
          autoFocus={visible}
          maxLength={640}
          placeholder="Deal name"
          placeholderTextColor="#847F78"
          className="min-h-11 rounded-xl border border-hairline bg-surface-card px-3 py-2.5 font-geist text-[15px] text-ink"
        />
        <Text className="font-geist text-[11px] text-ink-2">1–160 characters after spacing is normalized.</Text>
        {error ? <Text accessibilityRole="alert" className="font-geist text-[12px] text-status-critical">{error}</Text> : null}
      </View>
    </EditSheet>
  );
}
