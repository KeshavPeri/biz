import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';

import { AuthShell } from '@/components/ui/auth-shell';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { friendlyAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { isValidEmail } from '@/lib/validation';

/**
 * Login (task 7.4) — email + password → signInWithPassword. On success the
 * session is set and the root layout routes into (tabs). Visually consistent
 * with the sign-up screen (same AuthShell + TextField).
 */
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Login is lenient on shape (server decides) — just need something in both.
  const ready = isValidEmail(email) && password.length > 0 && !submitting;

  const handleLogin = async () => {
    setFormError(null);
    if (!supabase) {
      setFormError("Login isn't available right now. Please try again later.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError(friendlyAuthError(error, 'login'));
        return;
      }
      // Success: onAuthStateChange sets the session → root layout routes to (tabs).
    } catch (err) {
      setFormError(friendlyAuthError(err, 'login'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to Inflo."
      subtitle="Pick up right where your deals left off."
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
            onPress={handleLogin}
          >
            {submitting ? <ButtonSpinner color="#FFFFFF" /> : null}
            <ButtonText>Log in</ButtonText>
          </Button>
          <Pressable
            onPress={() => router.replace('/(auth)/sign-up')}
            hitSlop={8}
            className="pt-3"
          >
            <Text className="text-center font-geist text-secondary text-ink-3">
              New to Inflo? <Text className="font-geist-semibold text-ink">Create an account</Text>
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
          if (formError) setFormError(null);
        }}
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
          if (formError) setFormError(null);
        }}
        password
        placeholder="Your password"
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => {
          if (ready) handleLogin();
        }}
      />
    </AuthShell>
  );
}
