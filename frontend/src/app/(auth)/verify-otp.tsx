import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { useMotion } from '@/components/motion/use-motion';
import { friendlyAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

const CODE_LENGTH = 6; // Supabase email OTP tokens are 6 digits (mockup showed 4 as a demo).
const RESEND_COOLDOWN = 60; // seconds

/**
 * OTP verification (task 7.3) — rebuilt from the mockup's otp() step. Six recess
 * boxes driven by one hidden TextInput (RN-idiomatic; enables paste + iOS
 * one-time-code autofill). Verifies with type:'email' (the 'signup' type is
 * deprecated). On success a session exists and the root layout routes into the app.
 */
export default function VerifyOtpScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const { reduce } = useMotion();
  const shakeX = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  // Countdown for the resend affordance (mockup "Resend in 0:42").
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const shake = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (reduce) return;
    shakeX.value = withSequence(
      withTiming(-6, { duration: 60 }),
      withTiming(6, { duration: 60 }),
      withTiming(-4, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
  };

  const verify = async (token: string) => {
    if (!email) {
      setError('Something went wrong — please sign up again.');
      return;
    }
    if (!supabase) {
      setError("Verification isn't available right now. Please try again later.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (verifyError) {
        setError(friendlyAuthError(verifyError, 'otp'));
        setCode('');
        shake();
        return;
      }
      // Success: onAuthStateChange sets the session → the root layout's guard
      // flips and routes into (tabs). No manual navigation needed.
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setError(friendlyAuthError(err, 'otp'));
      setCode('');
      shake();
    } finally {
      setVerifying(false);
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) verify(digits);
  };

  const resend = async () => {
    if (cooldown > 0 || !email || !supabase) return;
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
      if (resendError) {
        setError(friendlyAuthError(resendError, 'otp'));
        return;
      }
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(friendlyAuthError(err, 'otp'));
    }
  };

  const cooldownLabel = `0:${String(cooldown).padStart(2, '0')}`;

  return (
    <AuthShell
      title="Enter the code we sent."
      subtitle={`Sent to ${email ?? 'your email'} — enter the 6-digit code to continue.`}
      onBack={() => router.back()}
      footer={
        <Button
          action="primary"
          size="lg"
          className="w-full"
          isDisabled={code.length !== CODE_LENGTH || verifying}
          onPress={() => verify(code)}
        >
          {verifying ? <ButtonSpinner /> : null}
          <ButtonText>Verify</ButtonText>
        </Button>
      }
    >
      {/* Tap anywhere on the boxes focuses the hidden input. */}
      <Pressable onPress={() => inputRef.current?.focus()}>
        <Animated.View style={rowStyle} className="my-1.5 flex-row gap-2.5">
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <OtpBox key={i} char={code[i] ?? ''} active={i === code.length} />
          ))}
        </Animated.View>
      </Pressable>

      {/* Hidden field that actually holds the code (paste + autofill capable). */}
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        // Off-screen but focusable — the boxes above are the visible UI.
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      />

      {error ? (
        <Text className="mt-1 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}

      <Pressable onPress={resend} disabled={cooldown > 0} hitSlop={6} className="mt-2">
        <Text className="font-geist text-secondary text-ink-3">
          Didn&apos;t get it?{' '}
          {cooldown > 0 ? (
            <Text className="font-geist-semibold text-ink">Resend in {cooldownLabel}</Text>
          ) : (
            <Text className="font-geist-semibold text-ink">Resend code</Text>
          )}
        </Text>
      </Pressable>
    </AuthShell>
  );
}

/** One code box (B4-24/25/26): a filled digit pops (scale 1→1.04→1, 90+120ms)
 *  with a selection haptic; the box the user is about to fill carries a 1px
 *  ink hairline instead of a caret; flush surface, no outer lift (inputs
 *  don't get nav-pill elevation). Reduce-motion: no pop, haptic still fires. */
function OtpBox({ char, active }: { char: string; active: boolean }) {
  const { reduce, t } = useMotion();
  const filled = Boolean(char);
  const scale = useSharedValue(1);
  const wasFilled = useRef(filled);

  useEffect(() => {
    if (filled && !wasFilled.current) {
      if (!reduce) {
        scale.value = withSequence(
          withTiming(1.04, { duration: t(90) }),
          withTiming(1, { duration: t(120) }),
        );
      }
      if (Platform.OS !== 'web') Haptics.selectionAsync();
    }
    wasFilled.current = filled;
  }, [filled, reduce, scale, t]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={animatedStyle}
      className={`h-[60px] flex-1 items-center justify-center rounded-input border ${
        filled
          ? 'border-hairline bg-surface-card'
          : active
            ? 'border-ink bg-surface-recess'
            : 'border-transparent bg-surface-recess'
      }`}
    >
      <Text
        className="font-geist-semibold text-display text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
        maxFontSizeMultiplier={1.15}
      >
        {char}
      </Text>
    </Animated.View>
  );
}
