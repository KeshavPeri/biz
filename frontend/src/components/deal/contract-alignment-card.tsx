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
        <Text className="font-geist-semibold text-[12px] text-ink">Checking contract against approved terms…</Text>
        <Text className="mt-1 font-geist text-[11px] text-ink-2">Signing stays locked while the exact PDF is checked.</Text>
      </View>
    );
  }

  if (alignment.status === 'failed') {
    return (
      <View className="rounded-xl bg-status-critical-tint px-3 py-2.5">
        <Text className="font-geist-semibold text-[12px] text-status-critical">Alignment check needs attention</Text>
        <Text className="mt-1 font-geist text-[11px] text-ink-2">{alignment.failure_message}</Text>
        <Action label={acting ? 'Retrying…' : 'Retry check'} onPress={onRetry} disabled={acting} />
      </View>
    );
  }

  if (alignment.status === 'clear') {
    return (
      <View className="rounded-xl bg-status-good-tint px-3 py-2.5">
        <Text className="font-geist-semibold text-[12px] text-status-good-label">Contract matches the approved terms</Text>
        <Text className="mt-1 font-geist text-[11px] text-ink-2">All 22 applicable fields are clear. Signing is enabled.</Text>
      </View>
    );
  }

  return (
    <View className={`rounded-xl px-3 py-2.5 ${alignment.status === 'overridden' ? 'bg-status-good-tint' : 'bg-status-critical-tint'}`}>
      <Text className={`font-geist-semibold text-[12px] ${alignment.status === 'overridden' ? 'text-status-good-label' : 'text-status-critical'}`}>
        {alignment.conflicts.length} contract conflict{alignment.conflicts.length === 1 ? '' : 's'} {alignment.status === 'overridden' ? 'accepted' : 'found'}
      </Text>
      {alignment.conflicts.map((conflict) => (
        <View key={conflict.field_key} className="mt-2 border-t border-hairline pt-2">
          <Text className="font-geist-semibold text-[11px] text-ink">{conflict.label}</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-2">Approved: {displayValue(conflict.approved_value)}</Text>
          <Text className="font-geist text-[11px] text-ink-2">Contract: {displayValue(conflict.contract_value)}</Text>
        </View>
      ))}
      <Text className="mt-2 font-geist-medium text-[11px] text-ink-2">{confirmations}</Text>
      {alignment.status === 'conflict' && alignment.can_override ? (
        <Action label={acting ? 'Saving…' : 'Accept this exact conflict set'} onPress={onOverride} disabled={acting} />
      ) : null}
      {alignment.status === 'conflict' && !alignment.can_override ? (
        <Text className="mt-1 font-geist text-[11px] text-ink-2">Signing remains locked until both eligible sides accept this exact set.</Text>
      ) : null}
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
