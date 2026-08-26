import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
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

  // Countdown for the resend affordance (mockup "Resend in 0:42").
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

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
        return;
      }
      // Success: onAuthStateChange sets the session → the root layout's guard
      // flips and routes into (tabs). No manual navigation needed.
    } catch (err) {
      setError(friendlyAuthError(err, 'otp'));
      setCode('');
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
      eyebrow="Account"
      title="Enter the code we sent."
      subtitle={`Sent to ${email ?? 'your email'} — enter the 6-digit code to continue.`}
      onBack={() => router.back()}
      footer={
        <Button
          action="primary"
          size="xl"
          className="w-full"
          isDisabled={code.length !== CODE_LENGTH || verifying}
          onPress={() => verify(code)}
        >
          {verifying ? <ButtonSpinner color="#FFFFFF" /> : null}
          <ButtonText>Verify</ButtonText>
        </Button>
      }
    >
      {/* Tap anywhere on the boxes focuses the hidden input. */}
      <Pressable onPress={() => inputRef.current?.focus()}>
        <View className="my-1.5 flex-row gap-2.5">
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const char = code[i] ?? '';
            const filled = Boolean(char);
            return (
              <View
                key={i}
                // Shadow via inline style, not a conditionally-toggled
                // shadow-* className — documented NativeWind native-only bug
                // (nativewind/nativewind#1536/#1557/#1711): toggling a
                // shadow-* class races React Navigation's context init and
                // throws "Couldn't find a navigation context." recessInset is
                // an inset shadow (no native RN equivalent anyway, so nothing
                // is lost by dropping it there).
                className={`h-[60px] flex-1 items-center justify-center rounded-[13px] ${
                  filled ? 'bg-surface-card' : 'bg-surface-recess'
                }`}
                style={
                  filled
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
                <Text className="font-geist-semibold text-ink" style={{ fontSize: 24 }}>
                  {char}
                </Text>
              </View>
            );
          })}
        </View>
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
