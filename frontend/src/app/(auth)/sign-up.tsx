import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { friendlyAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { isSignUpReady, isValidEmail, passwordProblem } from '@/lib/validation';

import ShieldIcon from '@/assets/icons/shield.svg';

const ICON_TERTIARY = '#847F78';

/**
 * Sign-up (tasks 7.1 UI + 7.2 wiring) — rebuilt from the mockup's account() step.
 * Collects email + password only; the role and profile come later (7.5), so this
 * screen creates just the Supabase auth user and hands off to OTP verification.
 */
export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Errors surface only after a blur/submit so we don't scold mid-typing.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ready = isSignUpReady(email, password) && !submitting;

  const handleSignUp = async () => {
    setFormError(null);
    // Final client check before the round-trip (button is already gated on this).
    const eErr = isValidEmail(email) ? null : 'Enter a valid email address.';
    const pErr = passwordProblem(password);
    setEmailError(eErr);
    setPasswordError(pErr);
    if (eErr || pErr) return;

    if (!supabase) {
      setFormError("Sign-up isn't available right now. Please try again later.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError(friendlyAuthError(error, 'sign-up'));
        return;
      }
      // Email-confirm is ON, so there's no session yet — go verify the OTP.
      router.push({ pathname: '/(auth)/verify-otp', params: { email: email.trim() } });
    } catch (err) {
      setFormError(friendlyAuthError(err, 'sign-up'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Account"
      title="First, let's make this yours."
      subtitle="One account for every deal you'll ever run. We'll verify it in a second."
      footer={
        <>
          {formError ? (
            <Text className="mb-3 text-center font-geist text-secondary text-status-critical">
              {formError}
            </Text>
          ) : null}
          <Button
            action="primary"
            size="lg"
            className="w-full"
            isDisabled={!ready}
            onPress={handleSignUp}
          >
            {submitting ? <ButtonSpinner color="#FFFFFF" /> : null}
            <ButtonText>Create account</ButtonText>
          </Button>
          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            hitSlop={8}
            className="pt-3"
          >
            <Text className="text-center font-geist text-secondary text-ink-3">
              Already have an account?{' '}
              <Text className="font-geist-semibold text-ink">Log in</Text>
            </Text>
          </Pressable>
        </>
      }
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (emailError) setEmailError(null);
        }}
        onBlur={() => setEmailError(isValidEmail(email) || !email ? null : 'Enter a valid email address.')}
        error={emailError}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (passwordError) setPasswordError(null);
        }}
        onBlur={() => setPasswordError(password ? passwordProblem(password) : null)}
        error={passwordError}
        password
        placeholder="8+ characters"
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => {
          if (ready) handleSignUp();
        }}
      />

      {/* Privacy note — mockup .signote + shield icon. */}
      <View className="mt-1 flex-row gap-[9px] rounded-panel bg-surface-recess p-3.5 shadow-recessInset">
        <ShieldIcon width={15} height={15} color={ICON_TERTIARY} style={{ marginTop: 2 }} />
        <Text className="flex-1 font-geist text-secondary leading-[18px] text-ink-2">
          Your data stays yours. Earnings are never public, and brands only ever see what you
          choose to show. India DPDP compliant.
        </Text>
      </View>
    </AuthShell>
  );
}
