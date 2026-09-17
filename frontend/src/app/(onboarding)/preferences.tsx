import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { Toggle } from '@/components/ui/toggle';
import { useOnboardingStore } from '@/store/onboarding-store';

type PrefRowProps = {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  isFirst?: boolean;
};

// Mockup `.togglerow` — a row in the grouped L0 list (B4-46), the whole row
// (not just the 48×29 switch) tappable (B4-48).
function PrefRow({ title, subtitle, value, onValueChange, disabled, isFirst }: PrefRowProps) {
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={title}
      className={`flex-row items-center gap-3.5 p-4 ${isFirst ? '' : 'border-t border-hairline-card'}`}
    >
      <View className="flex-1">
        <Text className="font-geist-semibold text-body text-ink">{title}</Text>
        <Text className="mt-0.5 font-geist text-secondary leading-[18px] text-ink-2">
          {subtitle}
        </Text>
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
      />
    </Pressable>
  );
}

/**
 * Preferences (creator) — the mockup's prefs() step. Inbound / outbound map to
 * creator_profiles.inbound_enabled / outbound_enabled (documented, in-scope). The
 * notifications toggle is shown for parity but is COSMETIC/disabled — real
 * notification preferences are Phase 12.
 */
export default function PreferencesScreen() {
  const { inbound, outbound } = useOnboardingStore();
  const setField = useOnboardingStore((s) => s.setField);

  return (
    <AuthShell
      title="How do you want deals to find you?"
      subtitle="Both on is the default — most creators keep it that way. This shows as a badge on your profile."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={4} current={3} />}
      footer={
        <Button
          action="primary"
          size="lg"
          className="w-full"
          onPress={() => router.push('/(onboarding)/done')}
        >
          <ButtonText>Finish setup</ButtonText>
        </Button>
      }
    >
      {/* Grouped L0 list (B4-46) — one hairline-bordered card, no per-row shadow. */}
      <View className="overflow-hidden rounded-card border border-hairline-card bg-surface-card">
        <PrefRow
          title="Accept inbound requests"
          subtitle="Brands and agencies can reach out to you directly from Discover"
          value={inbound}
          onValueChange={(v) => setField('inbound', v)}
          isFirst
        />
        <PrefRow
          title="Initiate outreach"
          subtitle="Pitch brands yourself with a structured idea proposal"
          value={outbound}
          onValueChange={(v) => setField('outbound', v)}
        />
        {/* Static, not a control — real notification prefs land in Phase 12 (B4-49:
            a permanently-disabled toggle reads as broken). */}
        <View className="flex-row items-center gap-3 border-t border-hairline-card p-4">
          <View className="h-1.5 w-1.5 rounded-full bg-cane-4" />
          <Text className="flex-1 font-geist text-secondary text-ink-2">
            Deal notifications are on. Tune them later in Account.
          </Text>
        </View>
      </View>
    </AuthShell>
  );
}
