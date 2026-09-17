import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { RefreshDip, Skeleton } from '@/components/motion/skeleton';
import { WinSpring } from '@/components/motion/win-spring';
import { PAYMENT_STATE_LABELS, PaymentStateSheet } from '@/components/deal/payment-state-sheet';
import type {
  PaymentState,
  PaymentTrackingActionResult,
  PaymentTrackingAvailable,
  PaymentTrackingMilestone,
  PaymentTrackingState,
  ReportablePaymentState,
} from '@/lib/deals';
import { formatExactMoney } from '@/lib/format';

type ActionMode = 'record' | 'receipt';
type ActionTarget = {
  kind: 'aggregate';
  mode: ActionMode;
  paymentId: string;
  version: number;
} | {
  kind: 'milestone';
  mode: ActionMode;
  paymentId: string;
  milestoneId: string;
  version: number;
};

type ResolvedAction = {
  kind: 'aggregate';
  mode: ActionMode;
  version: number;
  target: {
    label: string;
    amountLabel: string;
    state: PaymentState;
    version: number;
  };
} | {
  kind: 'milestone';
  mode: ActionMode;
  milestoneId: string;
  version: number;
  target: {
    label: string;
    amountLabel: string;
    state: PaymentState;
    version: number;
  };
};

const REVOKED_ACTION: PaymentTrackingActionResult = {
  ok: false,
  message: 'This payment action is no longer available. Review the refreshed record.',
  stale: true,
};

function resolveAction(
  state: PaymentTrackingState | null,
  action: ActionTarget | null,
  isDisputed: boolean,
): ResolvedAction | null {
  if (!state?.available
    || !action
    || state.payment_id !== action.paymentId
    || state.stage !== 'payment'
    || state.state === 'disputed'
    || isDisputed) return null;

  if (action.kind === 'aggregate') {
    const allowed = action.mode === 'record'
      ? state.structure === 'single' && state.allowed_actions.can_update_state
      : state.structure === 'single' && state.allowed_actions.can_confirm_receipt;
    if (!allowed || state.version !== action.version) return null;
    return {
      kind: 'aggregate',
      mode: action.mode,
      version: state.version,
      target: {
        label: 'Overall payment',
        amountLabel: formatExactMoney(state.amount, state.currency),
        state: state.state,
        version: state.version,
      },
    };
  }

  if (state.structure === 'single') return null;
  const milestone = state.milestones.find((item) => item.id === action.milestoneId);
  if (!milestone || milestone.version !== action.version) return null;
  const allowed = action.mode === 'record'
    ? state.allowed_actions.can_update_milestones && milestone.allowed_actions.can_update_state
    : milestone.allowed_actions.can_confirm_receipt;
  if (!allowed) return null;
  return {
    kind: 'milestone',
    mode: action.mode,
    milestoneId: milestone.id,
    version: milestone.version,
    target: {
      label: `Milestone ${milestone.sequence}: ${milestone.trigger}`,
      amountLabel: formatExactMoney(milestone.amount, state.currency),
      state: milestone.state,
      version: milestone.version,
    },
  };
}

type PaymentAction = (version: number, state?: ReportablePaymentState) => Promise<PaymentTrackingActionResult>;
type MilestoneAction = (
  milestoneId: string,
  version: number,
  state?: ReportablePaymentState,
) => Promise<PaymentTrackingActionResult>;

export function PaymentTrackingCard({
  state,
  loading,
  error,
  isDisputed,
  onRetry,
  onRecordAggregate,
  onRecordMilestone,
  onConfirmAggregate,
  onConfirmMilestone,
}: {
  state: PaymentTrackingState | null;
  loading: boolean;
  error: string | null;
  isDisputed: boolean;
  onRetry: () => void;
  onRecordAggregate: PaymentAction;
  onRecordMilestone: MilestoneAction;
  onConfirmAggregate: PaymentAction;
  onConfirmMilestone: MilestoneAction;
}) {
  const [action, setAction] = useState<ActionTarget | null>(null);
  const stateRef = useRef(state);
  const actionRef = useRef(action);
  const disputedRef = useRef(isDisputed);
  stateRef.current = state;
  actionRef.current = action;
  disputedRef.current = isDisputed;

  const resolvedAction = useMemo(
    () => resolveAction(state, action, isDisputed),
    [action, isDisputed, state],
  );

  useEffect(() => {
    if (action && !resolvedAction) setAction(null);
  }, [action, resolvedAction]);

  const recordCurrentAction = async (nextState: ReportablePaymentState): Promise<PaymentTrackingActionResult> => {
    const current = resolveAction(stateRef.current, actionRef.current, disputedRef.current);
    if (!current || current.mode !== 'record') {
      setAction(null);
      return REVOKED_ACTION;
    }
    return current.kind === 'aggregate'
      ? onRecordAggregate(current.version, nextState)
      : onRecordMilestone(current.milestoneId, current.version, nextState);
  };

  const confirmCurrentReceipt = async (): Promise<PaymentTrackingActionResult> => {
    const current = resolveAction(stateRef.current, actionRef.current, disputedRef.current);
    if (!current || current.mode !== 'receipt') {
      setAction(null);
      return REVOKED_ACTION;
    }
    return current.kind === 'aggregate'
      ? onConfirmAggregate(current.version)
      : onConfirmMilestone(current.milestoneId, current.version);
  };

  if (loading && !state) {
    return <PaymentTrackingSkeleton />;
  }

  if (!state) {
    return (
      <TrackerNotice
        title="Payment tracking"
        message={error ?? 'The current payment record could not be loaded.'}
        actionLabel="Retry payment tracking"
        onAction={onRetry}
      />
    );
  }

  if (!state.available) {
    return (
      <TrackerNotice
        title="Payment tracking"
        message="Payment tracking is not available for this deal yet."
        actionLabel="Retry payment tracking"
        onAction={onRetry}
      />
    );
  }

  const readOnly = isDisputed || state.state === 'disputed' || state.stage === 'closed';

  return (
    <>
      <RefreshDip refreshing={loading}>
      <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
        <View>
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="font-geist-semibold text-[14px] text-ink">Payment tracking</Text>
              <Text className="mt-0.5 font-geist text-[11px] leading-[16px] text-ink-3">
                Records off-platform activity. Inflo does not transfer or verify funds.
              </Text>
            </View>
          </View>
        </View>

        {isDisputed || state.state === 'disputed' ? (
          <View className="rounded-xl bg-status-critical-tint px-3 py-2.5">
            <Text className="font-geist-semibold text-[11.5px] text-status-critical">Dispute in progress — payment tracking is paused.</Text>
            <Text className="mt-1 font-geist text-[10.5px] leading-[15px] text-ink-2">Current evidence remains visible and read-only.</Text>
          </View>
        ) : state.stage === 'closed' ? (
          <View className="rounded-xl bg-surface-recess px-3 py-2.5">
            <Text className="font-geist-medium text-[11px] text-ink-2">This payment record is read-only because the deal is closed.</Text>
          </View>
        ) : null}

        <AggregateSummary state={state} />

        {state.structure === 'single' ? (
          <SingleActions
            state={state}
            readOnly={readOnly}
            onAction={(mode) => setAction({
              kind: 'aggregate',
              mode,
              paymentId: state.payment_id,
              version: state.version,
            })}
          />
        ) : (
          <View className="gap-2">
            <View className="flex-row items-center justify-between border-t border-hairline pt-3">
              <Text className="font-geist-semibold text-[12px] text-ink">Payment schedule</Text>
              <Text className="font-geist text-[10.5px] text-ink-3">Server order · {state.milestones.length} items</Text>
            </View>
            {state.milestones.map((milestone) => (
              <MilestoneRow
                key={milestone.id}
                milestone={milestone}
                currency={state.currency}
                mayUpdate={!readOnly && state.allowed_actions.can_update_milestones && milestone.allowed_actions.can_update_state}
                mayConfirm={!readOnly && milestone.allowed_actions.can_confirm_receipt}
                onAction={(mode) => setAction({
                  kind: 'milestone',
                  mode,
                  paymentId: state.payment_id,
                  milestoneId: milestone.id,
                  version: milestone.version,
                })}
              />
            ))}
          </View>
        )}

        {error ? (
          <View className="gap-2 rounded-xl bg-status-critical-tint px-3 py-2.5">
            <Text className="font-geist-medium text-[11px] leading-[16px] text-status-critical">{error}</Text>
            <RetryButton label="Refresh payment tracking" onPress={onRetry} />
          </View>
        ) : null}
      </View>
      </RefreshDip>

      {resolvedAction ? (
        <PaymentStateSheet
          visible
          mode={resolvedAction.mode}
          target={resolvedAction.target}
          onClose={() => setAction(null)}
          onRecord={recordCurrentAction}
          onConfirmReceipt={confirmCurrentReceipt}
        />
      ) : null}
    </>
  );
}

function AggregateSummary({ state }: { state: PaymentTrackingAvailable }) {
  const receiptLabel = state.receipt_complete
    ? `Creator receipt confirmed ${formatDateTime(state.receipt_confirmed_at)}`
    : state.state === 'paid_full'
      ? 'Awaiting creator receipt confirmation'
      : 'Receipt confirmation incomplete';

  return (
    <View className="gap-2 rounded-xl bg-surface-recess p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist text-[10.5px] text-ink-3">Agreed amount</Text>
          <Text className="mt-0.5 font-geist-semibold text-[17px] tabular-nums text-ink">
            {formatExactMoney(state.amount, state.currency)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="font-geist text-[10.5px] text-ink-3">Structure</Text>
          <Text className="mt-0.5 font-geist-semibold text-[11.5px] text-ink">{structureLabel(state.structure)}</Text>
        </View>
      </View>
      <View className="border-t border-hairline pt-2">
        <WinSpring trigger={state.state === 'paid_full'}>
          <StatusLine state={state.state} />
        </WinSpring>
        <Text className="mt-1 font-geist text-[10.5px] text-ink-3">
          Reported {formatDateTime(state.reported_at)} · payment version {state.version}
        </Text>
      </View>
      <LedgerFact label="Due" value={state.due_date_pending ? 'Due date pending — invoice-date based' : formatDateOnly(state.due_date)} />
      <LedgerFact label="Receipt" value={receiptLabel} positive={state.receipt_complete} />
    </View>
  );
}

function SingleActions({
  state,
  readOnly,
  onAction,
}: {
  state: PaymentTrackingAvailable;
  readOnly: boolean;
  onAction: (mode: ActionMode) => void;
}) {
  if (readOnly || (!state.allowed_actions.can_update_state && !state.allowed_actions.can_confirm_receipt)) return null;
  return (
    <View className="gap-2 border-t border-hairline pt-3">
      {state.allowed_actions.can_update_state ? (
        <ActionButton
          label="Record payment status"
          accessibilityLabel="Record status for the overall payment"
          secondary={state.allowed_actions.can_confirm_receipt}
          onPress={() => onAction('record')}
        />
      ) : null}
      {state.allowed_actions.can_confirm_receipt ? (
        <ActionButton
          label="Confirm received"
          accessibilityLabel="Confirm receipt of the overall payment"
          onPress={() => onAction('receipt')}
        />
      ) : null}
    </View>
  );
}

function MilestoneRow({
  milestone,
  currency,
  mayUpdate,
  mayConfirm,
  onAction,
}: {
  milestone: PaymentTrackingMilestone;
  currency: string;
  mayUpdate: boolean;
  mayConfirm: boolean;
  onAction: (mode: ActionMode) => void;
}) {
  return (
    <View className="gap-2 rounded-xl border border-hairline bg-app p-3">
      <View className="flex-row items-start gap-3">
        <View className="h-7 w-7 items-center justify-center rounded-full bg-ink">
          <Text className="font-geist-semibold text-[10.5px] tabular-nums text-white">{milestone.sequence}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[12px] leading-[17px] text-ink">{milestone.trigger}</Text>
          <Text className="mt-0.5 font-geist-medium text-[12px] tabular-nums text-ink-2">
            {formatExactMoney(milestone.amount, currency)}
          </Text>
        </View>
      </View>
      <WinSpring trigger={milestone.state === 'paid_full'}>
        <StatusLine state={milestone.state} />
      </WinSpring>
      <View className="gap-1 border-t border-hairline pt-2">
        <LedgerFact label="Due" value={formatDateOnly(milestone.due_date)} compact />
        <LedgerFact label="Reported" value={`${formatDateTime(milestone.reported_at)} · version ${milestone.version}`} compact />
        <LedgerFact
          label="Receipt"
          value={milestone.receipt_confirmed ? `Confirmed ${formatDateTime(milestone.receipt_confirmed_at)}` : 'Not confirmed for this version'}
          positive={milestone.receipt_confirmed}
          compact
        />
      </View>
      {mayUpdate || mayConfirm ? (
        <View className="gap-2 border-t border-hairline pt-2">
          {mayUpdate ? (
            <ActionButton
              label="Record status"
              accessibilityLabel={`Record status for milestone ${milestone.sequence}: ${milestone.trigger}`}
              secondary={mayConfirm}
              onPress={() => onAction('record')}
            />
          ) : null}
          {mayConfirm ? (
            <ActionButton
              label="Confirm received"
              accessibilityLabel={`Confirm receipt for milestone ${milestone.sequence}: ${milestone.trigger}`}
              onPress={() => onAction('receipt')}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StatusLine({ state }: { state: PaymentState }) {
  const critical = state === 'bad_debt' || state === 'disputed';
  const good = state === 'paid_full';
  const warning = state === 'not_paid_delayed';
  return (
    <View className={`self-start flex-row items-center gap-2 rounded-lg px-2 py-1.5 ${critical ? 'bg-status-critical-tint' : good ? 'bg-status-good-tint' : warning ? 'bg-cane-1' : 'bg-surface-card'}`}>
      <View className={`h-2 w-2 rounded-full ${critical ? 'bg-status-critical' : good ? 'bg-status-good' : warning ? 'bg-cane-5' : 'bg-status-neutral'}`} />
      <Text className={`font-geist-semibold text-[10.5px] ${critical ? 'text-status-critical' : good ? 'text-status-good-label' : 'text-ink-2'}`}>
        {PAYMENT_STATE_LABELS[state]}
      </Text>
    </View>
  );
}

function LedgerFact({ label, value, positive = false, compact = false }: {
  label: string;
  value: string;
  positive?: boolean;
  compact?: boolean;
}) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className={`font-geist text-ink-3 ${compact ? 'text-[10px]' : 'text-[10.5px]'}`}>{label}</Text>
      <Text className={`min-w-0 flex-1 text-right font-geist-medium text-ink-2 ${compact ? 'text-[10px]' : 'text-[10.5px]'} ${positive ? 'text-status-good-label' : ''}`}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({ label, accessibilityLabel, onPress, secondary = false }: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Button action={secondary ? 'secondary' : 'primary'} accessibilityLabel={accessibilityLabel} onPress={onPress}>
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button action="secondary" accessibilityLabel={label} onPress={onPress} className="self-start">
      <ButtonText>Retry</ButtonText>
    </Button>
  );
}

function PaymentTrackingSkeleton() {
  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <Skeleton.Block width="55%" height={14} radius="pill" />
      <Skeleton.Block height={28} radius="panel" />
      <Skeleton.Block height={16} radius="pill" />
      <Skeleton.Block height={16} radius="pill" />
      <Skeleton.Block height={16} radius="pill" />
    </View>
  );
}

function TrackerNotice({ title, message, actionLabel, onAction }: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3">
      <Text className="font-geist-semibold text-[14px] text-ink">{title}</Text>
      <Text className="font-geist text-[11px] leading-[16px] text-ink-2">{message}</Text>
      {actionLabel && onAction ? <RetryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

function structureLabel(structure: PaymentTrackingAvailable['structure']): string {
  return structure === 'single' ? 'Single payment' : structure === 'milestone' ? 'Milestones' : 'Combination';
}

function formatDateOnly(value: string | null): string {
  if (!value) return 'No due date reported';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value: string | null): string {
  if (!value) return 'not reported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}
