import { Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { TextField } from '@/components/ui/text-field';
import { useOnboardingStore } from '@/store/onboarding-store';

const MAX_NICHES = 3;

// Mockup NICHES / LANGS. Chips display emoji + name; we store the plain name in
// creator_profiles.niches / content_languages.
const NICHES: { emoji: string; name: string }[] = [
  { emoji: '💄', name: 'Beauty' },
  { emoji: '🧴', name: 'Skincare' },
  { emoji: '🏋️', name: 'Fitness' },
  { emoji: '🍜', name: 'Food' },
  { emoji: '👗', name: 'Fashion' },
  { emoji: '✈️', name: 'Travel' },
  { emoji: '📱', name: 'Tech' },
  { emoji: '🎙️', name: 'Podcast' },
  { emoji: '🎨', name: 'Art' },
];
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
          size="xl"
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

      <View className="mb-4">
        <View className="mb-[7px] flex-row items-center justify-between">
          <Text className="font-geist-semibold text-secondary text-ink-2">Your niche</Text>
          <Text className="font-geist text-secondary text-ink-3">pick up to 3</Text>
        </View>
        <View className="flex-row flex-wrap gap-[9px]">
          {NICHES.map(({ emoji, name }) => (
            <Chip
              key={name}
              label={`${emoji} ${name}`}
              selected={niches.includes(name)}
              onPress={() => toggleInArray('niches', name, MAX_NICHES)}
            />
          ))}
        </View>
      </View>

      <View className="mb-4">
        <Text className="mb-[7px] font-geist-semibold text-secondary text-ink-2">
          Content languages
        </Text>
        <View className="flex-row flex-wrap gap-[9px]">
          {LANGS.map((lang) => (
            <Chip
              key={lang}
              label={lang}
              selected={languages.includes(lang)}
              onPress={() => toggleInArray('languages', lang)}
            />
          ))}
        </View>
      </View>

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
