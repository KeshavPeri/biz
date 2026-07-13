import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import {
  useOnboardingStore,
  type ConnectedPlatform,
  type PlatformKey,
} from '@/store/onboarding-store';

import ShieldIcon from '@/assets/icons/shield.svg';
import CheckIcon from '@/assets/icons/check.svg';

const VERIFY_THRESHOLD = 7000; // mockup's 7K minimum — displayed, not a hard gate.

// Realistic MOCK stats (golden rule #4 — real-looking fakes, genuinely stored at
// finish; no live social API in MVP). Values mirror the mockup's demo creator.
const PLATFORMS: {
  key: PlatformKey;
  name: string;
  color: string;
  demo: ConnectedPlatform;
}[] = [
  { key: 'instagram', name: 'Instagram', color: '#B96A83', demo: { handle: '@devasri.creates', followerCount: 48200, engagementRate: 4.6, weeklyReach: 96000 } },
  { key: 'youtube', name: 'YouTube', color: '#C0574B', demo: { handle: 'Devasri Nair', followerCount: 12400, engagementRate: 3.1, weeklyReach: 21000 } },
  { key: 'tiktok', name: 'TikTok', color: '#1C1B18', demo: { handle: '@devasri', followerCount: 5100, engagementRate: 6.2, weeklyReach: 14500 } },
  { key: 'x', name: 'X / Twitter', color: '#2C2A25', demo: { handle: '@devasri_says', followerCount: 2300, engagementRate: 1.8, weeklyReach: 3800 } },
];

const GREEN = '#4F7A1E';
const TERTIARY = '#847F78';

/**
 * Platforms (task 7.8) — the mockup's platforms() step. "Connecting" a platform
 * mock-fills realistic follower/engagement/reach stats into the wizard store
 * (persisted to social_handles at finish). The 7K verification threshold is shown
 * as UI only — it does not block Continue; connecting one platform is enough.
 */
export default function PlatformsScreen() {
  const platforms = useOnboardingStore((s) => s.platforms);
  const connectPlatform = useOnboardingStore((s) => s.connectPlatform);
  const [busy, setBusy] = useState<PlatformKey | null>(null);

  const connectedCount = Object.keys(platforms).length;
  const clearsThreshold = Object.values(platforms).some(
    (p) => p.followerCount >= VERIFY_THRESHOLD,
  );

  const connect = (key: PlatformKey, demo: ConnectedPlatform) => {
    if (platforms[key] || busy) return;
    setBusy(key);
    // Simulate the OAuth round-trip (mock — no real API).
    setTimeout(() => {
      connectPlatform(key, demo);
      setBusy(null);
    }, 700);
  };

  return (
    <AuthShell
      eyebrow="Platforms"
      title="Connect where you create."
      subtitle="We pull your followers, engagement and reach automatically — your media kit builds itself."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={3} current={1} />}
      footer={
        <Button
          action="primary"
          size="xl"
          className="w-full"
          isDisabled={connectedCount === 0}
          onPress={() => router.push('/(onboarding)/preferences')}
        >
          <ButtonText>Continue</ButtonText>
        </Button>
      }
    >
      {PLATFORMS.map(({ key, name, color, demo }) => {
        const connected = platforms[key];
        const isBusy = busy === key;
        return (
          <View
            key={key}
            className="mb-[11px] flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-3.5 shadow-l1"
          >
            <View
              className="h-10 w-10 items-center justify-center rounded-panel"
              style={{ backgroundColor: color }}
            >
              <Text className="font-geist-bold text-white" style={{ fontSize: 15 }}>
                {name[0]}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-geist-semibold text-body text-ink">{name}</Text>
              <Text className="mt-0.5 font-geist text-secondary text-ink-3" numberOfLines={1}>
                {connected
                  ? `${connected.handle} · ${(connected.followerCount / 1000).toFixed(1)}K · ${connected.engagementRate}% ER`
                  : 'Not connected'}
              </Text>
            </View>
            <Pressable
              onPress={() => connect(key, demo)}
              disabled={Boolean(connected) || isBusy}
              className={`min-h-9 items-center justify-center rounded-pill px-4 ${
                connected ? 'border border-hairline bg-surface-recess' : 'bg-ink'
              }`}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={TERTIARY} />
              ) : (
                <Text
                  className={`font-geist-semibold text-[12.5px] ${
                    connected ? 'text-ink-2' : 'text-white'
                  }`}
                >
                  {connected ? 'Linked ✓' : 'Connect'}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}

      {/* Threshold readout — UI only (mockup `.threshold`). */}
      <View
        className={`mt-1.5 flex-row items-center gap-2 rounded-panel p-3 ${
          clearsThreshold ? 'bg-status-good-tint' : 'bg-surface-recess shadow-recessInset'
        }`}
      >
        {clearsThreshold ? (
          <CheckIcon width={16} height={16} color={GREEN} />
        ) : (
          <ShieldIcon width={16} height={16} color={TERTIARY} />
        )}
        <Text
          className={`flex-1 font-geist text-secondary leading-[18px] ${
            clearsThreshold ? 'text-status-good-label' : 'text-ink-2'
          }`}
        >
          {clearsThreshold
            ? 'You’re verified — you clear the 7K minimum on at least one platform.'
            : 'Inflo verifies creators with 7K+ followers on one platform. Your progress saves either way.'}
        </Text>
      </View>
    </AuthShell>
  );
}
