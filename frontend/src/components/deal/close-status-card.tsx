import { Pressable, Text, View } from 'react-native';

import type { CloseConfirmation, CloseStatus } from '@/lib/deals';

export function CloseStatusCard({
  state,
  loading,
  error,
  acting,
  onRetry,
  onConfirm,
}: {
  state: CloseStatus | null;
  loading: boolean;
  error: string | null;
  acting: boolean;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  if (loading && !state) return <Notice message="Loading close confirmation status…" />;
  if (!state) {
    return <Notice message={error ?? 'Close status is temporarily unavailable.'} actionLabel="Retry" onAction={onRetry} />;
  }
  if (!state.available) return null;

  const complete = state.stage === 'closed';
  const disputeBlocked = state.dispute_blocked;
  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[14px] text-ink">
            {complete ? 'Deal closed' : disputeBlocked ? 'Close paused' : 'Ready to close'}
          </Text>
          <Text className="mt-0.5 font-geist text-[11px] leading-[16px] text-ink-2">
            {complete
              ? 'Both sides confirmed. Payment history and messages remain visible, but this thread is read-only.'
              : disputeBlocked
                ? 'A payment dispute is active. Close confirmation will resume after the dispute is resolved.'
              : state.payment_complete
                ? 'Each side confirms once. Your confirmation is final; after both confirm, the thread becomes read-only.'
                : 'Full payment and the creator’s receipt confirmation are required before either side can close.'}
          </Text>
        </View>
        {loading ? <Text className="font-geist-medium text-[10px] text-ink-3">Refreshing…</Text> : null}
      </View>

      <View className="gap-2">
        <ConfirmationRow label="Creator" confirmation={state.confirmations.creator} paused={disputeBlocked} />
        <ConfirmationRow label="Brand" confirmation={state.confirmations.brand} paused={disputeBlocked} />
      </View>

      {state.allowed_actions.can_confirm ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm close"
          disabled={acting}
          onPress={onConfirm}
          className={`min-h-11 items-center justify-center rounded-2xl px-3 py-2.5 ${acting ? 'bg-avatar' : 'bg-ink'}`}
        >
          <Text className="font-geist-semibold text-[12px] text-white">
            {acting ? 'Confirming…' : 'Confirm close'}
          </Text>
        </Pressable>
      ) : !complete && state.payment_complete && !disputeBlocked ? (
        <Text className="font-geist-medium text-[11px] leading-[16px] text-ink-2">
          Waiting for the other side to confirm.
        </Text>
      ) : null}

      {error ? (
        <View className="gap-2 rounded-xl bg-status-critical-tint px-3 py-2.5">
          <Text accessibilityRole="alert" className="font-geist text-[11px] leading-[16px] text-status-critical">{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} className="min-h-10 items-center justify-center rounded-xl border border-hairline bg-surface-card px-3 py-2">
            <Text className="font-geist-semibold text-[11px] text-ink">Refresh close status</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ConfirmationRow({
  label,
  confirmation,
  paused,
}: {
  label: string;
  confirmation: CloseConfirmation;
  paused: boolean;
}) {
  const pendingLabel = paused ? 'Paused by dispute' : 'Awaiting confirmation';
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl bg-surface-recess px-3 py-2.5">
      <View className="min-w-0 flex-1">
        <Text className="font-geist-semibold text-[11px] text-ink">{label}</Text>
        <Text numberOfLines={1} className="font-geist text-[10.5px] text-ink-3">
          {confirmation.confirmed ? confirmation.display_label : pendingLabel}
        </Text>
      </View>
      <Text className={`font-geist-semibold text-[10.5px] ${confirmation.confirmed ? 'text-status-good-label' : 'text-ink-3'}`}>
        {confirmation.confirmed ? 'Confirmed' : paused ? 'Paused' : 'Waiting'}
      </Text>
    </View>
  );
}

function Notice({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3">
      <Text className="font-geist-semibold text-[13px] text-ink">Deal close</Text>
      <Text className="font-geist text-[11px] leading-[16px] text-ink-2">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} className="min-h-10 items-center justify-center rounded-xl border border-hairline px-3 py-2">
          <Text className="font-geist-semibold text-[11px] text-ink">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
