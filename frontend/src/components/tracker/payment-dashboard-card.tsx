import { Text, View } from 'react-native';

import { PressableScale } from '@/components/motion/pressable-scale';
import { formatExactMoney } from '@/lib/format';
import type { PaymentCurrencyTotal, PaymentDashboardRow } from '@/lib/payment-dashboard-state';

const STATE_LABELS = {
  paid_full: 'Reported paid in full', paid_partial: 'Reported partially paid',
  not_paid_in_window: 'Not paid in window', not_paid_delayed: 'Payment delayed',
  bad_debt: 'Bad debt', disputed: 'Disputed', refunded: 'Refunded',
} as const;

const BUCKET_LABELS = {
  received: 'Received', pending: 'Pending', overdue: 'Overdue', bad_debt: 'Bad debt',
} as const;

export function PaymentCurrencyCard({ total }: { total: PaymentCurrencyTotal }) {
  return (
    <View accessibilityLabel={`${total.currency} loaded payment facts`} className="min-w-[260px] flex-1 rounded-panel bg-surface-recess p-4">
      <Text className="font-geist-bold text-title text-ink">{total.currency}</Text>
      <Text className="mt-2 font-geist-bold text-heading tabular-nums text-ink">{formatExactMoney(total.obligationTotal, total.currency)}</Text>
      <Text className="font-geist text-micro text-ink-3">Loaded obligations</Text>
      <View className="mt-3 flex-row flex-wrap gap-x-3 gap-y-2 border-t border-hairline pt-3">
        <Text className="font-geist text-micro text-ink-2">Confirmed received {formatExactMoney(total.confirmedReceived, total.currency)}</Text>
        <Text className="font-geist text-micro text-ink-2">Received {total.receivedCount}</Text>
        <Text className="font-geist text-micro text-ink-2">Pending {total.pendingCount}</Text>
        <Text className="font-geist text-micro text-ink-2">Overdue {total.overdueCount}</Text>
        <Text className="font-geist text-micro text-status-critical">Bad debt {total.badDebtCount}</Text>
      </View>
    </View>
  );
}

export function PaymentDashboardCard({ row, viewerKind, onPress }: {
  row: PaymentDashboardRow;
  viewerKind: 'creator' | 'brand';
  onPress: () => void;
}) {
  const critical = row.historyBucket === 'bad_debt';
  const receivedCopy = viewerKind === 'brand' ? 'Creator confirmed received' : 'Received';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${row.dealName}, ${critical ? 'bad debt' : BUCKET_LABELS[row.historyBucket]}, open source deal`}
      onPress={onPress}
      className={`rounded-card border bg-surface-card p-4 shadow-l1 ${critical ? 'border-status-critical' : 'border-hairline-card'}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-geist-semibold text-body text-ink">{row.dealName}</Text>
          <Text numberOfLines={1} className="mt-0.5 font-geist text-micro text-ink-3">{row.counterpartyName}</Text>
        </View>
        <Text className="font-geist-bold text-body tabular-nums text-ink">{formatExactMoney(row.amount, row.currency)}</Text>
      </View>
      {row.itemKind === 'milestone' ? (
        <Text numberOfLines={2} className="mt-3 font-geist text-secondary text-ink-2">Milestone {row.milestoneSequence} · {row.milestoneTrigger}</Text>
      ) : null}
      <View className="mt-3 flex-row flex-wrap items-center gap-2">
        <View className={`h-2.5 w-2.5 rounded-full ${critical || row.historyBucket === 'overdue' ? 'bg-status-critical' : row.historyBucket === 'received' ? 'bg-status-good' : 'bg-cane-4'}`} />
        <Text className={`font-geist-semibold text-secondary ${critical || row.historyBucket === 'overdue' ? 'text-status-critical' : 'text-ink'}`}>
          {row.historyBucket === 'received' ? receivedCopy : BUCKET_LABELS[row.historyBucket]}
        </Text>
        <Text className="font-geist text-micro text-ink-3">· {STATE_LABELS[row.canonicalState]}</Text>
      </View>
      <Text className="mt-2 font-geist text-micro text-ink-3">
        {row.dueDate ? `Due ${row.dueDate} UTC` : 'Due date pending'}
      </Text>
      {row.canonicalState === 'paid_partial' ? (
        <Text accessibilityRole="alert" className="mt-2 font-geist text-micro text-status-critical">Exact received amount unavailable; the card shows the full obligation.</Text>
      ) : null}
      {row.canonicalState === 'disputed' || row.canonicalState === 'refunded' ? (
        <Text className="mt-2 font-geist text-micro text-status-critical">This remains an attention state and is not counted as received.</Text>
      ) : null}
      <Text className="mt-3 font-geist-semibold text-micro text-ink">Open source deal ›</Text>
    </PressableScale>
  );
}
