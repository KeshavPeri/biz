import { Text, View } from 'react-native';

import { trackerIoRatio, type DealTrackerSnapshot } from '@/lib/tracker-state';

function formatDate(value: string | null): string {
  if (!value) return 'None scheduled';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

export function TrackerSummary({ snapshot }: { snapshot: DealTrackerSnapshot }) {
  const facts = [
    ['Active deals', String(snapshot.summary.activeDeals)],
    ['Action needed', String(snapshot.summary.actionNeeded)],
    ['Payments due · 7d', String(snapshot.summary.paymentsDueThisWeek)],
    ['Next deadline', formatDate(snapshot.summary.nextDeadline)],
    ['Overdue deliverables', String(snapshot.summary.overdueDeliverables)],
    ['Inbound / outbound', trackerIoRatio(snapshot)],
  ];
  return (
    <View accessibilityLabel="Deal tracking summary" className="flex-row flex-wrap gap-2">
      {facts.map(([label, value]) => (
        <View key={label} className="min-w-[31%] flex-1 rounded-panel bg-surface-recess px-3 py-3">
          <Text className="font-geist text-micro text-ink-3">{label}</Text>
          <Text className="mt-1 font-geist-bold text-title tabular-nums text-ink">{value}</Text>
        </View>
      ))}
    </View>
  );
}
