import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import {
  DEFAULT_PAYMENT_FILTERS, validPaymentFilterDraft,
  type PaymentBucket, type PaymentCanonicalState, type PaymentDashboardFilters as FilterState,
} from '@/lib/payment-dashboard-state';

type Option = { id: string; label: string };

const BUCKETS: { value: PaymentBucket | null; label: string }[] = [
  { value: null, label: 'All' }, { value: 'received', label: 'Received' },
  { value: 'pending', label: 'Pending' }, { value: 'overdue', label: 'Overdue' },
  { value: 'bad_debt', label: 'Bad debt' },
];
const STATES: { value: PaymentCanonicalState | null; label: string }[] = [
  { value: null, label: 'Any state' }, { value: 'paid_full', label: 'Paid full' },
  { value: 'paid_partial', label: 'Partial' }, { value: 'not_paid_in_window', label: 'In window' },
  { value: 'not_paid_delayed', label: 'Delayed' }, { value: 'bad_debt', label: 'Bad debt' },
  { value: 'disputed', label: 'Disputed' }, { value: 'refunded', label: 'Refunded' },
];

export function PaymentDashboardFilters({ filters, deals, counterparties, onApply }: {
  filters: FilterState;
  deals: Option[];
  counterparties: Option[];
  onApply: (filters: FilterState) => void;
}) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const valid = validPaymentFilterDraft(draft);
  return (
    <View className="gap-4 rounded-panel border border-hairline-card bg-surface-card p-4">
      <View>
        <Text className="font-geist-semibold text-secondary text-ink">History</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {BUCKETS.map((item) => <Chip key={item.label} label={item.label} selected={draft.bucket === item.value} onPress={() => set('bucket', item.value)} />)}
        </View>
      </View>
      <View>
        <Text className="font-geist-semibold text-secondary text-ink">Canonical state</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {STATES.map((item) => <Chip key={item.label} label={item.label} selected={draft.state === item.value} onPress={() => set('state', item.value)} />)}
        </View>
      </View>
      {deals.length > 0 ? <View><Text className="font-geist-semibold text-secondary text-ink">Deal</Text><View className="mt-2 flex-row flex-wrap gap-2"><Chip label="All deals" selected={!draft.dealId} onPress={() => set('dealId', null)} />{deals.map((item) => <Chip key={item.id} label={item.label} selected={draft.dealId === item.id} onPress={() => set('dealId', item.id)} />)}</View></View> : null}
      {counterparties.length > 0 ? <View><Text className="font-geist-semibold text-secondary text-ink">Business or creator</Text><View className="mt-2 flex-row flex-wrap gap-2"><Chip label="Everyone" selected={!draft.counterpartyId} onPress={() => set('counterpartyId', null)} />{counterparties.map((item) => <Chip key={item.id} label={item.label} selected={draft.counterpartyId === item.id} onPress={() => set('counterpartyId', item.id)} />)}</View></View> : null}
      <View>
        <Text className="font-geist-semibold text-secondary text-ink">Inclusive due dates (UTC)</Text>
        <Text className="mt-1 font-geist text-micro text-ink-3">Unknown due dates are excluded when either date is set.</Text>
        <View className="mt-2 flex-row gap-2">
          <TextInput accessibilityLabel="Due from date" placeholder="YYYY-MM-DD" value={draft.dueFrom ?? ''} onChangeText={(value) => set('dueFrom', value || null)} autoCapitalize="none" className="min-h-11 flex-1 rounded-panel border border-hairline bg-surface-recess px-3 font-geist text-secondary text-ink" />
          <TextInput accessibilityLabel="Due to date" placeholder="YYYY-MM-DD" value={draft.dueTo ?? ''} onChangeText={(value) => set('dueTo', value || null)} autoCapitalize="none" className="min-h-11 flex-1 rounded-panel border border-hairline bg-surface-recess px-3 font-geist text-secondary text-ink" />
        </View>
      </View>
      {!valid ? <Text accessibilityRole="alert" className="font-geist text-micro text-status-critical">Choose valid UTC dates and a compatible history/state combination.</Text> : null}
      <View className="flex-row gap-2">
        <Button action="secondary" className="flex-1" onPress={() => { setDraft(DEFAULT_PAYMENT_FILTERS); onApply(DEFAULT_PAYMENT_FILTERS); }}><ButtonText>Reset</ButtonText></Button>
        <Button className="flex-1" isDisabled={!valid} onPress={() => onApply(draft)}><ButtonText>Apply filters</ButtonText></Button>
      </View>
    </View>
  );
}
