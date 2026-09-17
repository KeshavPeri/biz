import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import type {
  PaymentState,
  PaymentTrackingActionResult,
  ReportablePaymentState,
} from '@/lib/deals';

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  not_paid_in_window: 'Not paid — within window',
  not_paid_delayed: 'Payment delayed',
  paid_partial: 'Partially paid',
  paid_full: 'Reported paid in full',
  bad_debt: 'Bad debt',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

const REPORTABLE_STATES: readonly ReportablePaymentState[] = [
  'not_paid_in_window',
  'not_paid_delayed',
  'paid_partial',
  'paid_full',
  'bad_debt',
  'refunded',
];

type SheetTarget = {
  label: string;
  amountLabel: string;
  state: PaymentState;
  version: number;
};

export function PaymentStateSheet({
  visible,
  mode,
  target,
  onClose,
  onRecord,
  onConfirmReceipt,
}: {
  visible: boolean;
  mode: 'record' | 'receipt';
  target: SheetTarget;
  onClose: () => void;
  onRecord: (state: ReportablePaymentState) => Promise<PaymentTrackingActionResult>;
  onConfirmReceipt: () => Promise<PaymentTrackingActionResult>;
}) {
  const [selected, setSelected] = useState<ReportablePaymentState | null>(null);
  const [reviewingConsequence, setReviewingConsequence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setReviewingConsequence(false);
    setBusy(false);
    setError(null);
  }, [mode, target.label, target.version, visible]);

  const close = () => {
    if (!busy) onClose();
  };

  const finish = async () => {
    if (busy || (mode === 'record' && selected == null)) return;
    if (mode === 'record' && selected && ['bad_debt', 'refunded'].includes(selected) && !reviewingConsequence) {
      setReviewingConsequence(true);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    const result = mode === 'receipt' ? await onConfirmReceipt() : await onRecord(selected!);
    setBusy(false);
    if (result.ok || result.stale) {
      onClose();
      return;
    }
    setError(result.message);
  };

  const selectedLabel = selected ? PAYMENT_STATE_LABELS[selected] : null;
  const consequence = mode === 'record' && selected && ['bad_debt', 'refunded'].includes(selected);

  return (
    <EditSheet
      visible={visible}
      onClose={close}
      title={mode === 'receipt' ? 'Confirm received' : reviewingConsequence ? `Confirm ${selectedLabel}` : 'Record payment status'}
      subtitle={`${target.label} · ${target.amountLabel} · displayed version ${target.version}`}
      footer={(
        <Button
          action="primary"
          size="lg"
          accessibilityLabel={mode === 'receipt'
            ? `Confirm received for ${target.label}`
            : `${reviewingConsequence ? 'Confirm and record' : 'Record'} ${selectedLabel ?? 'selected payment status'} for ${target.label}`}
          isDisabled={busy || (mode === 'record' && selected == null)}
          onPress={() => void finish()}
        >
          {busy ? <ButtonSpinner /> : (
            <ButtonText>
              {mode === 'receipt'
                ? 'Confirm received'
                : reviewingConsequence
                  ? `Record ${selectedLabel}`
                  : 'Record selected status'}
            </ButtonText>
          )}
        </Button>
      )}
    >
      {mode === 'receipt' ? (
        <View className="gap-3">
          <View className="rounded-xl bg-surface-recess px-3 py-3">
            <Text className="font-geist-semibold text-[12px] text-ink">
              {PAYMENT_STATE_LABELS[target.state]} · {target.amountLabel}
            </Text>
            <Text className="mt-1 font-geist text-[11px] leading-[16px] text-ink-2">
              Confirm only after you received this exact off-platform payment. Inflo does not transfer or verify funds.
            </Text>
          </View>
          {error ? <ActionError message={error} /> : null}
        </View>
      ) : reviewingConsequence && consequence ? (
        <View className="gap-3">
          <View className="rounded-xl bg-status-critical-tint px-3 py-3">
            <Text className="font-geist-semibold text-[12px] text-status-critical">
              Record {selectedLabel} for {target.label}?
            </Text>
            <Text className="mt-1 font-geist text-[11px] leading-[16px] text-ink-2">
              This records a high-consequence tracking label only. It does not move, refund, verify, or recover money.
            </Text>
          </View>
          <Button
            action="secondary"
            accessibilityLabel="Go back to payment status choices"
            isDisabled={busy}
            onPress={() => setReviewingConsequence(false)}
          >
            <ButtonText>Review status choices</ButtonText>
          </Button>
          {error ? <ActionError message={error} /> : null}
        </View>
      ) : (
        <View className="gap-2">
          <Text className="mb-1 font-geist text-[11px] leading-[16px] text-ink-2">
            Choose the status already reported off-platform. Inflo does not transfer or verify funds.
          </Text>
          {REPORTABLE_STATES.map((state) => {
            const active = selected === state;
            return (
              <Pressable
                key={state}
                accessibilityRole="radio"
                accessibilityLabel={`${PAYMENT_STATE_LABELS[state]} for ${target.label}`}
                accessibilityState={{ checked: active }}
                disabled={busy}
                onPress={() => { setSelected(state); setError(null); }}
                className={`min-h-12 flex-row items-center gap-3 rounded-xl border px-3 py-3 ${active ? 'border-ink bg-surface-recess' : 'border-hairline bg-surface-card'}`}
              >
                <View className={`h-3 w-3 rounded-full border ${active ? 'border-ink bg-ink' : 'border-cane-4 bg-surface-card'}`} />
                <Text className="flex-1 font-geist-medium text-[12px] text-ink">{PAYMENT_STATE_LABELS[state]}</Text>
                {['bad_debt', 'refunded'].includes(state) ? (
                  <Text className="font-geist-medium text-[10px] text-status-critical">Confirm twice</Text>
                ) : null}
              </Pressable>
            );
          })}
          {error ? <ActionError message={error} /> : null}
        </View>
      )}
    </EditSheet>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <View className="rounded-xl bg-status-critical-tint px-3 py-2.5">
      <Text className="font-geist-medium text-[11px] leading-[16px] text-status-critical">{message}</Text>
    </View>
  );
}
