import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { TextField } from '@/components/ui/text-field';
import { useOnboardingStore } from '@/store/onboarding-store';

/**
 * Brand details (task 7.7). The mockup only shows a static "capture scope"
 * overview for brands, so this is a newly-designed form (styled consistently)
 * capturing the documented brands columns plus a contact name (feeds the NOT NULL
 * profiles.display_name). At finish → brands + brand_members(admin, active) +
 * profiles(account_type:'brand'). Brands skip niches/platforms (creator tables).
 */
export default function BrandDetailsScreen() {
  const { companyName, displayName, industry, companyIdGst, domain } = useOnboardingStore();
  const setField = useOnboardingStore((s) => s.setField);

  // Minimum for the NOT NULL writes: a company name + a contact name.
  const ready = companyName.trim().length > 0 && displayName.trim().length > 0;

  return (
    <AuthShell
      eyebrow="Your company"
      title="Set up your brand."
      subtitle="The essentials to run deals and earn your Verified Business badge. You can add billing and your team later."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={1} current={0} />}
      footer={
        <Button
          action="primary"
          size="xl"
          className="w-full"
          isDisabled={!ready}
          onPress={() => router.push('/(onboarding)/done')}
        >
          <ButtonText>Continue</ButtonText>
        </Button>
      }
    >
      <TextField
        label="Company name"
        value={companyName}
        onChangeText={(v) => setField('companyName', v)}
        placeholder="e.g. Boat Lifestyle"
        autoCapitalize="words"
        returnKeyType="next"
      />
      <TextField
        label="Your name"
        labelHint="the contact for deals"
        value={displayName}
        onChangeText={(v) => setField('displayName', v)}
        placeholder="Who brands and creators will deal with"
        autoCapitalize="words"
        returnKeyType="next"
      />
      <TextField
        label="Industry"
        value={industry}
        onChangeText={(v) => setField('industry', v)}
        placeholder="e.g. Consumer Electronics"
        autoCapitalize="words"
        returnKeyType="next"
      />
      <TextField
        label="GST / company ID"
        labelHint="optional"
        value={companyIdGst}
        onChangeText={(v) => setField('companyIdGst', v)}
        placeholder="For your Verified Business badge"
        autoCapitalize="characters"
        returnKeyType="next"
      />
      <TextField
        label="Website domain"
        labelHint="optional"
        value={domain}
        onChangeText={(v) => setField('domain', v)}
        placeholder="yourbrand.com"
        keyboardType="url"
        autoCapitalize="none"
        returnKeyType="done"
      />
    </AuthShell>
  );
}
