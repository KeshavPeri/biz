import { Text, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import type { ContractAlignmentState } from '@/lib/deals';

function displayValue(value: unknown): string {
  if (value == null) return 'Not resolved';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key.replaceAll('_', ' ')}: ${displayValue(item)}`)
      .join(' · ');
  }
  return String(value);
}

export function ContractAlignmentCard({
  alignment,
  acting,
  onRetry,
  onOverride,
}: {
  alignment: ContractAlignmentState;
  acting: boolean;
  onRetry: () => void;
  onOverride: () => void;
}) {
  const confirmations = `${alignment.creator_confirmation.confirmed ? 'Creator accepted' : 'Creator pending'} · ${
    alignment.brand_confirmation.confirmed ? 'Brand accepted' : 'Brand pending'
  }`;

  if (alignment.status === 'not_started' || alignment.status === 'processing') {
    return (
      <View className="rounded-xl bg-cane-1 px-3 py-2.5">
        <Text className="font-geist-semibold text-secondary text-ink">Checking contract against approved terms…</Text>
        <Text className="mt-1 font-geist text-micro text-ink-2">Signing stays locked while the exact PDF is checked.</Text>
      </View>
    );
  }

  if (alignment.status === 'failed') {
    return (
      <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-2.5">
        <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-secondary text-status-critical">Alignment check needs attention</Text>
          <Text className="mt-1 font-geist text-micro text-ink-2">{alignment.failure_message}</Text>
          <Action label={acting ? 'Retrying…' : 'Retry check'} onPress={onRetry} disabled={acting} />
        </View>
      </View>
    );
  }

  if (alignment.status === 'clear') {
    return (
      <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-2.5">
        <View className="mt-1.5 h-2 w-2 rounded-full bg-status-good" />
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-secondary text-status-good-label">Contract matches the approved terms</Text>
          <Text className="mt-1 font-geist text-micro text-ink-2">All 22 applicable fields are clear. Signing is enabled.</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-2.5">
      <View className={`mt-1.5 h-2 w-2 rounded-full ${alignment.status === 'overridden' ? 'bg-status-good' : 'bg-status-critical'}`} />
      <View className="min-w-0 flex-1">
        <Text className={`font-geist-semibold text-secondary ${alignment.status === 'overridden' ? 'text-status-good-label' : 'text-status-critical'}`}>
          {alignment.conflicts.length} contract conflict{alignment.conflicts.length === 1 ? '' : 's'} {alignment.status === 'overridden' ? 'accepted' : 'found'}
        </Text>
        {alignment.conflicts.map((conflict) => (
          <View key={conflict.field_key} className="mt-2 border-t border-hairline pt-2">
            <Text className="font-geist-semibold text-micro text-ink">{conflict.label}</Text>
            <Text className="mt-0.5 font-geist text-micro text-ink-2">Approved: {displayValue(conflict.approved_value)}</Text>
            <Text className="font-geist text-micro text-ink-2">Contract: {displayValue(conflict.contract_value)}</Text>
          </View>
        ))}
        <Text className="mt-2 font-geist-medium text-micro text-ink-2">{confirmations}</Text>
        {alignment.status === 'conflict' && alignment.can_override ? (
          <Action label={acting ? 'Saving…' : 'Accept this exact conflict set'} onPress={onOverride} disabled={acting} />
        ) : null}
        {alignment.status === 'conflict' && !alignment.can_override ? (
          <Text className="mt-1 font-geist text-micro text-ink-2">Signing remains locked until both eligible sides accept this exact set.</Text>
        ) : null}
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Button action="primary" accessibilityLabel={label} onPress={onPress} isDisabled={disabled} className="mt-2 self-start">
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}
