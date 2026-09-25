import { Text, View } from 'react-native';

import type { UsageRightsDeal } from '@/lib/usage-rights-state';

export function UsageRightsChip({ rights }: { rights: Pick<UsageRightsDeal, 'status' | 'endDate' | 'isPerpetual'> }) {
  const expired = rights.status === 'expired';
  const unavailable = rights.status === 'unavailable';
  const label = unavailable ? 'Rights unavailable' : rights.status === 'none' ? 'No usage rights' : rights.isPerpetual ? 'Usage rights · Perpetual' : `Usage rights · ${rights.status === 'active' ? 'Active until' : rights.status === 'expiring' ? 'Expiring' : 'Expired'} ${rights.endDate ?? ''}`;
  return <View accessibilityLabel={label} className={`rounded-pill px-2 py-0.5 ${expired ? 'bg-surface-recess' : unavailable ? 'bg-surface-recess' : rights.status === 'expiring' ? 'bg-cane-2' : 'bg-status-good/10'}`}>
    <Text className={`font-geist-semibold text-micro ${expired || unavailable ? 'text-ink-3' : rights.status === 'expiring' ? 'text-ink-2' : 'text-status-good'}`}>{label}</Text>
  </View>;
}
