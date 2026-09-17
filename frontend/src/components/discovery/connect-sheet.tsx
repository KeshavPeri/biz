import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { connectDeal } from '@/lib/deals';

import CheckIcon from '@/assets/icons/check.svg';
import ShieldIcon from '@/assets/icons/shield.svg';

type Phase = 'confirm' | 'sending' | 'done';

/**
 * ConnectSheet (B2-004) — the confirm modal for seeding a Pending deal. Minimal by
 * design: confirm → POST /deals/connect → success, surfacing any (non-blocking)
 * exclusivity warning. It does NOT navigate into a deal room or open chat — that's
 * Phase 9. Reused by both detail screens (creator + brand).
 */
export function ConnectSheet({
  visible,
  onClose,
  targetType,
  targetId,
  targetName,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: 'creator' | 'brand';
  targetId: string;
  targetName: string;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reused, setReused] = useState(false);

  // Reset each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setPhase('confirm');
      setError(null);
      setWarning(null);
      setReused(false);
    }
  }, [visible]);

  const submit = async () => {
    setPhase('sending');
    setError(null);
    const res = await connectDeal(targetType, targetId);
    if (!res.ok) {
      setError(res.message);
      setPhase('confirm');
      return;
    }
    setWarning(res.result.exclusivity_warning ?? null);
    setReused(!res.result.created);
    setPhase('done');
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title={phase === 'done' ? 'Request sent' : `Start a deal with ${targetName}?`}
      subtitle={
        phase === 'done'
          ? undefined
          : 'This opens a Pending deal and a private thread. You can add the proposal and terms next.'
      }
      footer={
        phase === 'done' ? (
          <Button action="primary" size="lg" className="w-full" onPress={onClose}>
            <ButtonText>Done</ButtonText>
          </Button>
        ) : (
          <Button
            action="primary"
            size="lg"
            className="w-full"
            isDisabled={phase === 'sending'}
            onPress={submit}
          >
            {phase === 'sending' ? <ButtonSpinner /> : null}
            <ButtonText>Connect</ButtonText>
          </Button>
        )
      }
    >
      {phase === 'done' ? (
        <View>
          <View className="mb-3 flex-row items-center gap-2">
            <View className="h-6 w-6 items-center justify-center rounded-full bg-status-good-tint">
              <CheckIcon width={14} height={14} color="#4F7A1E" />
            </View>
            <Text className="font-geist-medium text-body text-ink">
              {reused ? 'You already have a deal with them — reopened it.' : 'Deal opened at Pending.'}
            </Text>
          </View>
          {warning ? (
            <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess p-3 shadow-recessInset">
              <ShieldIcon width={16} height={16} color="#847F78" />
              <Text className="flex-1 font-geist text-secondary leading-[18px] text-ink-2">
                {warning}
              </Text>
            </View>
          ) : null}
          <Text className="mt-3 font-geist text-secondary text-ink-3">
            The proposal, terms and chat open with the deal engine.
          </Text>
        </View>
      ) : (
        <Text className="font-geist text-body text-ink-2">
          No commitment yet — this just starts the conversation.
        </Text>
      )}

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}
