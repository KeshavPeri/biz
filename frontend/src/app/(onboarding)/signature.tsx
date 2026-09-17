import { useEffect, useState } from 'react';
import { Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';
import { PressableScale } from '@/components/motion/pressable-scale';
import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
import { GlassSurface } from '@/components/ui/glass-surface';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { SignaturePad } from '@/components/ui/signature-pad';
import { useOnboardingStore, type SignatureType } from '@/store/onboarding-store';

import ShieldIcon from '@/assets/icons/shield.svg';

const ICON_TERTIARY = '#847F78';

/**
 * Signature (task 7.9) — the mockup's signature() step. Draw OR type a reusable
 * signature; it's held in the wizard store and written to `signatures` at finish
 * (after the profiles row exists). This only STORES the reusable signature —
 * per-use signing at contract time is Phase 9.
 */
export default function SignatureScreen() {
  const setField = useOnboardingStore((s) => s.setField);
  const [mode, setMode] = useState<SignatureType>('drawn');
  const [drawnSvg, setDrawnSvg] = useState('');
  const [typedName, setTypedName] = useState('');
  // While true, a finger is down on the pad — disables the ScrollView so it
  // can't steal the drag (see SignaturePad's onDragActiveChange doc comment).
  const [drawing, setDrawing] = useState(false);

  const hasSignature = mode === 'drawn' ? drawnSvg.length > 0 : typedName.trim().length > 0;
  const { t } = useMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbX = useSharedValue(0);

  useEffect(() => {
    const target = mode === 'drawn' ? 0 : trackWidth / 2;
    thumbX.value = withTiming(target, { duration: t(200), easing: EASE_OUT });
  }, [mode, trackWidth, t, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width - 8); // minus p-1 (4px) each side

  const save = () => {
    setField('signatureType', mode);
    setField('signatureData', mode === 'drawn' ? drawnSvg : typedName.trim());
    router.push('/(onboarding)/preferences');
  };

  return (
    <AuthShell
      title="Sign once. Never chase a contract again."
      subtitle="Every deal on Inflo ends in a real e-signed contract. Store yours now and future signings are one tap."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={4} current={2} />}
      scrollEnabled={!drawing}
      footer={
        <Button
          action="primary"
          size="lg"
          className="w-full"
          isDisabled={!hasSignature}
          onPress={save}
        >
          <ButtonText>Save signature</ButtonText>
        </Button>
      }
    >
      {/* Draw / Type toggle (mockup `.sigtoggle`) — a single pillow-glass thumb
          (B4-51, matches the nav-active recipe) slides between segments
          (B4-52: 200ms ease-out, selection haptic via PressableScale). */}
      <View
        className="mb-4 flex-row rounded-input bg-surface-recess p-1 shadow-recessInset"
        onLayout={onTrackLayout}
      >
        {trackWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', top: 4, bottom: 4, left: 4, width: trackWidth / 2 }, thumbStyle]}
          >
            <GlassSurface variant="pillow" radius={10} className="flex-1" />
          </Animated.View>
        ) : null}
        {(['drawn', 'typed'] as SignatureType[]).map((m) => {
          const on = mode === m;
          return (
            <PressableScale
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              className="flex-1 items-center rounded-panel py-2.5"
            >
              <Text
                className={`text-secondary ${on ? 'font-geist-semibold text-ink' : 'font-geist-medium text-ink-2'}`}
              >
                {m === 'drawn' ? 'Draw it' : 'Type it'}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {/* Both stay mounted (B4-53) — toggling away from Draw must not discard
          the strokes already on the pad, which unmounting used to do. */}
      <View style={{ display: mode === 'drawn' ? 'flex' : 'none' }}>
        <SignaturePad onChange={setDrawnSvg} onDragActiveChange={setDrawing} />
      </View>
      <View style={{ display: mode === 'typed' ? 'flex' : 'none' }}>
        {/* Typed preview (mockup `.typed`) — deviates from the mockup's
            italicised-Geist treatment: a real script typeface reads as an
            actual signature the way DocuSign/Adobe Sign render a typed
            name, rather than slanted body text. No added rotation — the
            script's own strokes already carry the handwritten feel. */}
        <View className="h-[170px] items-center justify-center rounded-card border-[1.5px] border-dashed border-cane-3 bg-surface-card">
          {typedName.trim() ? (
            <Text
              className="text-ink"
              style={{ fontFamily: 'MarckScript_400Regular', fontSize: 46 }}
            >
              {typedName.trim()}
            </Text>
          ) : (
            <Text className="font-geist text-secondary text-ink-3">Type your full name below</Text>
          )}
        </View>
        <View
          className="mt-3.5 flex-row items-center rounded-input bg-surface-recess px-4 shadow-recessInset"
          style={{ minHeight: 52 }}
        >
          <TextInput
            className="flex-1 font-geist text-body text-ink"
            placeholder="Type your full name"
            placeholderTextColor={ICON_TERTIARY}
            value={typedName}
            onChangeText={setTypedName}
            autoCapitalize="words"
          />
        </View>
      </View>

      {/* Security note (mockup `.signote`). */}
      <View className="mt-4 flex-row gap-[9px] rounded-panel bg-surface-recess p-3.5 shadow-recessInset">
        <View className="h-5 w-5 items-center justify-center">
          <ShieldIcon width={16} height={16} color={ICON_TERTIARY} />
        </View>
        <Text className="flex-1 font-geist text-secondary leading-[18px] text-ink-2">
          Stored securely and kept private to you. Each future use is confirmed by you, then
          timestamped and logged in that deal’s audit trail.
        </Text>
      </View>
    </AuthShell>
  );
}
