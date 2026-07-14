import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonText } from '@/components/ui/button';
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

  const save = () => {
    setField('signatureType', mode);
    setField('signatureData', mode === 'drawn' ? drawnSvg : typedName.trim());
    router.push('/(onboarding)/preferences');
  };

  return (
    <AuthShell
      eyebrow="Signature"
      title="Sign once. Never chase a contract again."
      subtitle="Every deal on Inflo ends in a real e-signed contract. Store yours now and future signings are one tap."
      onBack={() => router.back()}
      progress={<OnboardingProgress total={4} current={2} />}
      scrollEnabled={!drawing}
      footer={
        <Button
          action="primary"
          size="xl"
          className="w-full"
          isDisabled={!hasSignature}
          onPress={save}
        >
          <ButtonText>Save signature</ButtonText>
        </Button>
      }
    >
      {/* Draw / Type toggle (mockup `.sigtoggle`). */}
      <View className="mb-4 flex-row gap-1 rounded-input bg-surface-recess p-1 shadow-recessInset">
        {(['drawn', 'typed'] as SignatureType[]).map((m) => {
          const on = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              // Shadow applied via inline style, NOT a conditionally-toggled
              // `shadow-*` className — that pattern is a documented NativeWind
              // bug on native (nativewind/nativewind#1536, #1557, #1711):
              // toggling a shadow-* class triggers runtime CSS parsing that
              // races React Navigation's context init, throwing "Couldn't
              // find a navigation context." Inline style bypasses NativeWind's
              // interop layer entirely, so the race can't happen. Values
              // approximate the shadow-liftIn token (single-layer, matching
              // how NativeWind itself already approximates multi-layer
              // box-shadows to one shadow on native).
              className={`flex-1 items-center rounded-panel py-2.5 ${on ? 'bg-surface-card' : ''}`}
              style={
                on
                  ? {
                      shadowColor: '#1C1B18',
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.09,
                      shadowRadius: 9,
                      elevation: 3,
                    }
                  : undefined
              }
            >
              <Text
                className={`text-secondary ${on ? 'font-geist-semibold text-ink' : 'font-geist-medium text-ink-2'}`}
              >
                {m === 'drawn' ? 'Draw it' : 'Type it'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'drawn' ? (
        <SignaturePad onChange={setDrawnSvg} onDragActiveChange={setDrawing} />
      ) : (
        <View>
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
      )}

      {/* Security note (mockup `.signote`). */}
      <View className="mt-4 flex-row gap-[9px] rounded-panel bg-surface-recess p-3.5 shadow-recessInset">
        <ShieldIcon width={15} height={15} color={ICON_TERTIARY} style={{ marginTop: 2 }} />
        <Text className="flex-1 font-geist text-secondary leading-[18px] text-ink-2">
          Stored securely and kept private to you. Each future use is confirmed by you, then
          timestamped and logged in that deal’s audit trail.
        </Text>
      </View>
    </AuthShell>
  );
}
