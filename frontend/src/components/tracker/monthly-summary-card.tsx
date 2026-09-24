import { Text, View } from 'react-native';

import { formatExactMoney } from '@/lib/format';
import type { MonthlyCurrencyTotal, MonthlySummaryGroup } from '@/lib/monthly-summary-state';

function Facts({ row }: { row: MonthlyCurrencyTotal | MonthlySummaryGroup }) {
  const facts = [
    ['Contracted', formatExactMoney(row.contracted, row.currency)],
    ['Confirmed received', formatExactMoney(row.confirmedReceived, row.currency)],
    ['Outstanding', formatExactMoney(row.outstanding, row.currency)],
    ['Deals', String(row.dealCount)],
    ['Deliverables', String(row.deliverableCount)],
    ['Inbound / outbound', `${row.inboundDeals}:${row.outboundDeals}`],
  ];
  return (
    <View className="mt-3 flex-row flex-wrap gap-x-3 gap-y-3 border-t border-hairline pt-3">
      {facts.map(([label, value]) => (
        <View key={label} className="min-w-[45%] flex-1">
          <Text className="font-geist text-micro text-ink-3">{label}</Text>
          <Text className="mt-0.5 font-geist-semibold text-secondary tabular-nums text-ink">{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function MonthlyCurrencyCard({ total }: { total: MonthlyCurrencyTotal }) {
  return (
    <View accessibilityLabel={`${total.currency} monthly total`} className="rounded-panel bg-surface-recess p-4">
      <Text className="font-geist-bold text-title text-ink">{total.currency} total</Text>
      <Facts row={total} />
      {total.partialUnquantifiedCount > 0 ? (
        <Text accessibilityRole="alert" className="mt-3 font-geist text-micro text-status-critical">
          {total.partialUnquantifiedCount} deal{total.partialUnquantifiedCount === 1 ? '' : 's'} include{total.partialUnquantifiedCount === 1 ? 's' : ''} an unquantified partial payment. The amount remains outstanding.
        </Text>
      ) : null}
    </View>
  );
}

export function MonthlyGroupCard({ group }: { group: MonthlySummaryGroup }) {
  return (
    <View accessibilityLabel={`${group.counterpartyName}, ${group.currency} monthly summary`} className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
      <View className="flex-row items-start justify-between gap-3">
        <Text numberOfLines={2} className="min-w-0 flex-1 font-geist-semibold text-body text-ink">{group.counterpartyName}</Text>
        <Text className="font-geist-semibold text-micro text-ink-3">{group.currency}</Text>
      </View>
      <Facts row={group} />
      {group.partialUnquantifiedCount > 0 ? (
        <Text className="mt-3 font-geist text-micro text-status-critical">Partial payment amount is unquantified and remains outstanding.</Text>
      ) : null}
    </View>
  );
}
