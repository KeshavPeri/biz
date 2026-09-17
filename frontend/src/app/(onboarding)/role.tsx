import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SvgProps } from 'react-native-svg';

import { PressableScale } from '@/components/motion/pressable-scale';
import { useOnboardingStore, type OnboardingRole } from '@/store/onboarding-store';

import CreatorIcon from '@/assets/icons/profile.svg';
import BrandIcon from '@/assets/icons/building.svg';
import ChevronIcon from '@/assets/icons/chevron-right.svg';

const INK = '#1C1B18';
const TERTIARY = '#847F78';

type RoleCardProps = {
  Icon: React.FC<SvgProps>;
  title: string;
  subtitle: string;
  onPress: () => void;
};

// Mockup `.rolecard` — white card, recessed icon square, title/subtitle, chevron.
function RoleCard({ Icon, title, subtitle, onPress }: RoleCardProps) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      className="mb-3 flex-row items-center gap-3.5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
    >
      <View className="h-11 w-11 items-center justify-center rounded-[13px] bg-surface-recess shadow-recessInset">
        <Icon width={21} height={21} color={INK} />
      </View>
      <View className="flex-1">
        <Text className="font-geist-semibold text-subtitle text-ink">{title}</Text>
        <Text className="mt-0.5 font-geist text-secondary text-ink-2">{subtitle}</Text>
      </View>
      <ChevronIcon width={18} height={18} color={TERTIARY} />
    </PressableScale>
  );
}

/**
 * Role fork (task 7.5) — the first onboarding step, rebuilt from the mockup's
 * role(). Creator + Brand only; agency is out of scope (scope.md). Sets the role
 * in the wizard store and forks to the matching path. No profile is written yet
 * (display_name isn't known until the next step).
 */
export default function RoleScreen() {
  const setRole = useOnboardingStore((s) => s.setRole);

  const choose = (role: OnboardingRole) => {
    setRole(role);
    router.push(role === 'creator' ? '/(onboarding)/creator-about' : '/(onboarding)/brand-details');
  };

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top', 'bottom']}>
      <ScrollView
        contentContainerClassName="px-[22px] pb-8 pt-2"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero (mockup `.hero`). The mockup's teal radial glow is a web-only CSS
            gradient; we use the flat ink block here — a faithful, simpler read. */}
        <View className="mb-6 overflow-hidden rounded-card bg-ink px-[26px] pb-8 pt-11">
          <Text className="mb-3.5 text-[32px] font-geist-semibold tracking-[-0.6px] text-app">
            inflo
          </Text>
          <Text className="mb-2.5 text-[26px] font-geist-bold leading-[31px] tracking-[-0.4px] text-app">
            Deals, run properly.
          </Text>
          <Text className="max-w-[290px] font-geist text-body leading-[22px] text-[rgba(251,250,246,0.72)]">
            The calm home for creator–brand deals — chat, contract, content and payment in one
            flow. No more WhatsApp + spreadsheets.
          </Text>
        </View>

        <Text className="mb-2 font-geist-semibold text-micro uppercase tracking-[0.7px] text-ink-3">
          To start
        </Text>
        <Text className="mb-4 font-geist-bold text-title text-ink">Which one are you?</Text>

        <RoleCard
          Icon={CreatorIcon}
          title="I'm a creator"
          subtitle="Get discovered, close deals, get paid on time"
          onPress={() => choose('creator')}
        />
        <RoleCard
          Icon={BrandIcon}
          title="I'm a brand"
          subtitle="Find the right creators and run campaigns end-to-end"
          onPress={() => choose('brand')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
