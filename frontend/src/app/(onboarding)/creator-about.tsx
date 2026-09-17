import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip-group';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { TextField } from '@/components/ui/text-field';
import { useOnboardingStore } from '@/store/onboarding-store';

const MAX_NICHES = 3;

const NICHES = ['Beauty', 'Skincare', 'Fitness', 'Food', 'Fashion', 'Travel', 'Tech', 'Podcast', 'Art'];
const LANGS = ['English', 'Hindi', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Kannada'];

/**
 * Creator — About (task 7.6). The mockup's about() step: the "60-second media
 * kit". Captures display name, city, up to 3 niches, content languages and bio
 * into the wizard store (written at finish). The "Write it for me" AI bio button
 * is intentionally OMITTED — AI runs through the backend ai_service (Phase 10).
 */
export default function CreatorAboutScreen() {
  const { displayName, city, niches, languages, bio } = useOnboardingStore();
  const setField = useOnboardingStore((s) => s.setField);
  const toggleInArray = useOnboardingStore((s) => s.toggleInArray);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    if (!limitReached) return;
    const timeout = setTimeout(() => setLimitReached(false), 200);
    return () => clearTimeout(timeout);
  }, [limitReached]);

  const toggleNiche = (niche: string) => {
    if (!niches.includes(niche) && niches.length >= MAX_NICHES) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setLimitReached(true);
      return;
    }
    toggleInArray('niches', niche, MAX_NICHES);
  };

  // Mockup validate(): name + at least one niche + one language.
  const ready = displayName.trim().length > 0 && niches.length > 0 && languages.length > 0;

  return (
    <AuthShell
      eyebrow="About you"
      title="The 60-second media kit."
      subtitle="Just the essentials — this is what brands filter on. The polish comes later, on your terms."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={4} current={0} />}
      footer={
        <Button
          action="primary"
          size="lg"
          className="w-full"
          isDisabled={!ready}
          onPress={() => router.push('/(onboarding)/platforms')}
        >
          <ButtonText>Continue</ButtonText>
        </Button>
      }
    >
      <TextField
        label="Display name"
        value={displayName}
        onChangeText={(v) => setField('displayName', v)}
        placeholder="How brands will see you"
        autoCapitalize="words"
        returnKeyType="next"
      />
      <TextField
        label="City"
        value={city}
        onChangeText={(v) => setField('city', v)}
        placeholder="Where you're based"
        autoCapitalize="words"
        returnKeyType="next"
      />

      <ChipGroup
        label="Your niche"
        hint={
          <Text className={`font-geist text-secondary ${limitReached ? 'text-ink' : 'text-ink-3'}`}>
            {niches.length} / {MAX_NICHES}
          </Text>
        }
        options={NICHES}
        selected={niches}
        onToggle={toggleNiche}
      />

      <ChipGroup
        label="Content languages"
        options={LANGS}
        selected={languages}
        onToggle={(lang) => toggleInArray('languages', lang)}
      />

      <TextField
        label="Bio"
        labelHint={`${bio.length} / 120`}
        value={bio}
        onChangeText={(v) => setField('bio', v.slice(0, 120))}
        placeholder="Honest skincare, real routines."
        multiline
        maxLength={120}
        returnKeyType="default"
      />
    </AuthShell>
  );
}
