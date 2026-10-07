import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { WinSpring } from '@/components/motion/win-spring';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { connectDeal } from '@/lib/deals';
import { supabase } from '@/lib/supabase';
import { campaignCategory, ConflictWarningFence, runConnectWithSessionFence, type ConflictWarning } from '@/lib/exclusivity-conflict-warning';

import CheckIcon from '@/assets/icons/check.svg';

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
  const [warning, setWarning] = useState<ConflictWarning | null>(null);
  const [category, setCategory] = useState('');
  const fence = useRef(new ConflictWarningFence());
  const [reused, setReused] = useState(false);

  // Reset each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setPhase('confirm');
      setError(null);
      setWarning(null);
      setCategory('');
      setReused(false);
    }
    fence.current.invalidate();
  }, [visible, targetType, targetId]);

  useEffect(() => {
    const warningFence = fence.current;
    const subscription = supabase?.auth.onAuthStateChange(() => {
      warningFence.invalidate();
      setWarning(null);
    });
    return () => { subscription?.data.subscription.unsubscribe(); warningFence.invalidate(); };
  }, []);

  const changeCategory = (value: string) => {
    fence.current.invalidate();
    setPhase('confirm');
    setCategory(value);
    setWarning(null);
    setError(null);
  };

  const close = () => {
    fence.current.invalidate();
    setWarning(null);
    onClose();
  };

  const submit = async () => {
    let display: string;
    try { display = campaignCategory(category); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a campaign category.'); return; }
    const context = `${targetType}:${targetId}:${display}`;
    const digest = warning?.digest;
    setPhase('sending');
    setError(null);
    const outcome = await runConnectWithSessionFence(
      fence.current,
      context,
      async () => (await supabase?.auth.getSession())?.data.session?.user.id,
      () => connectDeal(targetType, targetId, display, digest),
    );
    if (outcome.state === 'stale') return;
    if (outcome.state === 'signed-out') {
      setError('Sign in again to start this deal.');
      setPhase('confirm');
      return;
    }
    const res = outcome.result;
    if (!res.ok) {
      setWarning(null);
      setError(res.message);
      setPhase('confirm');
      return;
    }
    if (res.needsAck) {
      setWarning(res.warning);
      setPhase('confirm');
      return;
    }
    setWarning(null);
    setReused(!res.result.created);
    setPhase('done');
  };

  return (
    <EditSheet
      visible={visible}
      onClose={close}
      title={phase === 'done' ? 'Request sent' : warning ? 'Review exclusivity conflicts' : `Start a deal with ${targetName}?`}
      subtitle={
        phase === 'done'
          ? undefined
          : 'This opens a Pending deal and a private thread. You can add the proposal and terms next.'
      }
      footer={
        phase === 'done' ? (
          <Button action="primary" size="lg" className="w-full" onPress={close}>
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
            <ButtonText>{warning ? 'Connect anyway' : 'Connect'}</ButtonText>
          </Button>
        )
      }
    >
      {phase === 'done' ? (
        <View>
          <WinSpring trigger={phase === 'done'} style={{ marginBottom: 12 }}>
            <View className="flex-row items-center gap-2">
              <View className="h-6 w-6 items-center justify-center rounded-full bg-status-good-tint">
                <CheckIcon width={14} height={14} color="#4F7A1E" />
              </View>
              <Text className="font-geist-medium text-body text-ink">
                {reused ? 'You already have a deal with them — reopened it.' : 'Deal opened at Pending.'}
              </Text>
            </View>
          </WinSpring>
          <Text className="mt-3 font-geist text-secondary text-ink-3">
            The proposal, terms and chat open with the deal engine.
          </Text>
        </View>
      ) : (
        <View>
          <Text className="font-geist text-body text-ink-2">Campaign category</Text>
          <TextInput
            accessibilityLabel="Campaign category"
            value={category}
            onChangeText={changeCategory}
            editable={phase !== 'sending'}
            maxLength={400}
            placeholder="e.g. skincare"
            autoCapitalize="sentences"
            className="mt-2 rounded-panel border border-outline bg-surface px-3 py-3 font-geist text-body text-ink"
          />
          <Text className="mt-2 font-geist text-secondary text-ink-3">
            Name one category for this campaign. No commitment yet — this starts a conversation.
          </Text>
          {warning ? (
            <View className="mt-4 rounded-panel bg-surface-recess p-3" accessibilityRole="alert">
              <Text className="font-geist-medium text-body text-ink">Exclusivity conflicts — warn only</Text>
              <Text className="mt-1 font-geist text-secondary text-ink-2">
                You can continue. Review each agreement before you choose Connect anyway.
              </Text>
              {warning.conflicts.map((item, index) => (
                <Text key={`${item.brand}:${item.category}:${item.expiry}:${index}`} className="mt-2 font-geist text-secondary text-ink-2">
                  {item.brand} · {item.category} · through {item.expiry} (inclusive)
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}
