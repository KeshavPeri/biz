import type { AuthError } from '@supabase/supabase-js';

/**
 * Turns a raw Supabase auth failure into calm, human copy (golden rule: never
 * show a user a raw technical error). We match on Supabase's stable `code` field
 * where possible, then fall back to message text, then to a safe generic line.
 *
 * Kept deliberately small and centralised so every auth screen speaks with one
 * voice and a new case is a one-line addition.
 */

type FriendlyContext = 'sign-up' | 'login' | 'otp';

/** A network/DNS failure surfaces as a thrown TypeError, not an AuthError. */
export function isNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /fetch failed|network request failed|failed to fetch|ENOTFOUND|ECONNREFUSED|timeout/i.test(
    message,
  );
}

export function friendlyAuthError(err: unknown, context: FriendlyContext): string {
  if (isNetworkError(err)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  const authErr = err as Partial<AuthError> | undefined;
  const code = authErr?.code ?? '';
  const message = (authErr?.message ?? '').toLowerCase();

  // Duplicate email on sign-up.
  if (code === 'user_already_exists' || message.includes('already registered')) {
    return 'That email already has an account — log in instead.';
  }
  // Weak password (server-side rule).
  if (code === 'weak_password' || message.includes('password should be')) {
    return 'That password is too weak. Try a longer one.';
  }
  // Wrong email/password on login.
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  // Trying to log in before confirming the email.
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please verify your email first — check your inbox for the code.';
  }
  // OTP wrong / expired.
  if (
    code === 'otp_expired' ||
    message.includes('token has expired') ||
    (context === 'otp' && message.includes('invalid'))
  ) {
    return 'That code is invalid or has expired. Request a new one.';
  }
  // Too many requests (rate limit) — e.g. hammering resend.
  if (code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return 'Too many attempts. Wait a moment and try again.';
  }

  // Safe generic fallback per screen.
  const fallback: Record<FriendlyContext, string> = {
    'sign-up': "Couldn't create your account. Please try again.",
    login: "Couldn't log you in. Please try again.",
    otp: "Couldn't verify that code. Please try again.",
  };
  return fallback[context];
}
