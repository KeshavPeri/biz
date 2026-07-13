import { Text, View } from 'react-native';
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
};

// Mockup `.togglerow` — card with title/subtitle and a switch.
function PrefRow({ title, subtitle, value, onValueChange, disabled }: PrefRowProps) {
  return (
    <View className="mb-3 flex-row items-center gap-3.5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
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
    </View>
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
      eyebrow="Preferences"
      title="How do you want deals to find you?"
      subtitle="Both on is the default — most creators keep it that way. This shows as a badge on your profile."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={3} current={2} />}
      footer={
        <Button
          action="primary"
          size="xl"
          className="w-full"
          onPress={() => router.push('/(onboarding)/done')}
        >
          <ButtonText>Finish setup</ButtonText>
        </Button>
      }
    >
      <PrefRow
        title="Accept inbound requests"
        subtitle="Brands and agencies can reach out to you directly from Discover"
        value={inbound}
        onValueChange={(v) => setField('inbound', v)}
      />
      <PrefRow
        title="Initiate outreach"
        subtitle="Pitch brands yourself with a structured idea proposal"
        value={outbound}
        onValueChange={(v) => setField('outbound', v)}
      />
      {/* Cosmetic only — notification prefs are Phase 12. */}
      <PrefRow
        title="Deal notifications"
        subtitle="Stage advances, payments and deadlines. Critical alerts always arrive."
        value
        onValueChange={() => {}}
        disabled
      />
    </AuthShell>
  );
}
