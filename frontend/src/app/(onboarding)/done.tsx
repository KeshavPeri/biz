import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { computeCompleteness, submitOnboarding } from '@/lib/onboarding';
import { useAuthStore } from '@/store/auth-store';
import { useOnboardingStore } from '@/store/onboarding-store';

const RING_RADIUS = 66;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 414.7
const TEAL = '#0095A8';
const RECESS = '#EFEAE2';

// One "what Inflo now knows" recap line (mockup `.rfield`).
function RecapRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View className="flex-row justify-between gap-3 border-b border-[#F4F2ED] py-2.5">
      <Text className="font-geist text-secondary text-ink-2">{label}</Text>
      <View className="flex-1">
        <Text className="text-right font-geist-semibold text-secondary text-ink">{value}</Text>
        {hint ? (
          <Text className="text-right font-geist text-micro text-ink-3">{hint}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Done (task 7.11) — the mockup's done() step: a completeness ring, a recap of
 * what Inflo now knows, and a below-the-fold nudge. "Start discovering" runs
 * submitOnboarding (the single finish write); on success the onboarding gate
 * flips and the app routes into (tabs). The ring is static (not the mockup's
 * animated sweep).
 */
export default function DoneScreen() {
  const state = useOnboardingStore();
  const session = useAuthStore((s) => s.session);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = useMemo(() => computeCompleteness(state), [state]);
  const dashoffset = RING_CIRCUMFERENCE * (1 - pct / 100);
  const firstName = state.displayName.trim().split(' ')[0] || 'there';
  const isCreator = state.role === 'creator';

  const primary = useMemo(() => {
    const entries = Object.values(state.platforms);
    if (entries.length === 0) return null;
    return entries.reduce((a, b) => (b.followerCount > a.followerCount ? b : a));
  }, [state.platforms]);

  const finish = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await submitOnboarding(session);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }
    // Success — flip the gate and clear wizard state; routing moves to (tabs).
    useAuthStore.getState().setOnboarded(true);
    useOnboardingStore.getState().reset();
  };

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top', 'bottom']}>
      <View className="flex-1 px-[22px] pt-4">
        <View className="items-center">
          <Text className="mb-2 font-geist-semibold text-micro uppercase tracking-[0.7px] text-ink-3">
            You’re in, {firstName}
          </Text>
          <Text className="mb-1 text-center font-geist-bold text-display text-ink">
            {isCreator ? 'Your media kit is live.' : 'Your brand is ready.'}
          </Text>
          <Text className="mb-4 text-center font-geist text-body text-ink-2">
            {isCreator
              ? 'Brands can already find you. Here’s how complete it is —'
              : 'You can start finding creators. Here’s how complete your profile is —'}
          </Text>

          {/* Completeness ring (mockup `.ring`) — SVG so it renders on web + native. */}
          <View className="my-2 h-[150px] w-[150px] items-center justify-center">
            <Svg width={150} height={150}>
              <Circle cx={75} cy={75} r={RING_RADIUS} stroke={RECESS} strokeWidth={11} fill="none" />
              <Circle
                cx={75}
                cy={75}
                r={RING_RADIUS}
                stroke={TEAL}
                strokeWidth={11}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashoffset}
                rotation={-90}
                originX={75}
                originY={75}
              />
            </Svg>
            <View className="absolute items-center">
              <Text className="font-geist-bold text-ink" style={{ fontSize: 32 }}>
                {pct}%
              </Text>
              <Text className="font-geist-medium text-micro uppercase tracking-[0.4px] text-ink-3">
                Complete
              </Text>
            </View>
          </View>
        </View>

        {/* Recap (mockup `.recap`). */}
        <View className="mt-2 rounded-panel bg-surface-recess p-2 shadow-recessInset">
          <View className="rounded-[10px] bg-surface-card px-3.5 py-1 shadow-liftIn">
            {isCreator ? (
              <>
                <RecapRow
                  label="Verified reach"
                  value={primary ? `${(primary.followerCount / 1000).toFixed(1)}K` : '—'}
                  hint={`${Object.keys(state.platforms).length} platform(s) linked`}
                />
                <RecapRow
                  label="Niche"
                  value={state.niches.slice(0, 3).join(' · ') || '—'}
                  hint={[state.city, state.languages.join(', ')].filter(Boolean).join(' · ')}
                />
                <RecapRow
                  label="Open to"
                  value={
                    state.inbound && state.outbound
                      ? 'Inbound + outbound'
                      : state.inbound
                        ? 'Inbound only'
                        : state.outbound
                          ? 'Outbound only'
                          : 'Request to connect'
                  }
                />
              </>
            ) : (
              <>
                <RecapRow label="Company" value={state.companyName || '—'} hint={state.industry} />
                <RecapRow label="Contact" value={state.displayName || '—'} />
                <RecapRow
                  label="Verification"
                  value={state.companyIdGst ? 'GST on file' : 'Add later'}
                  hint={state.domain || undefined}
                />
              </>
            )}
          </View>
        </View>

        {/* Gentle nudge — enrichment lands later, on the user's terms. */}
        <View className="mt-4 flex-row items-center gap-2.5">
          <View className="h-[7px] w-[7px] rounded-full bg-cane-3" />
          <Text className="flex-1 font-geist text-secondary text-ink-2">
            {isCreator
              ? 'Rate card & audience demographics — add anytime from the You tab to sharpen matching.'
              : 'Team, billing & maker-checker — set these up anytime from the Account tab.'}
          </Text>
        </View>
      </View>

      <View className="px-[22px] pb-[18px] pt-3">
        {error ? (
          <Text className="mb-3 text-center font-geist text-secondary text-status-critical">
            {error}
          </Text>
        ) : null}
        <Button
          action="primary"
          size="xl"
          className="w-full"
          isDisabled={submitting}
          onPress={finish}
        >
          {submitting ? <ButtonSpinner color="#FFFFFF" /> : null}
          <ButtonText>{isCreator ? 'Start discovering' : 'Go to dashboard'}</ButtonText>
        </Button>
      </View>
    </SafeAreaView>
  );
}
