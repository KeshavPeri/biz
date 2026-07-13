/**
 * Client-side form validation for the auth screens (Phase 7).
 *
 * These are a friendly first line of defence only — the real gate is Supabase
 * Auth on the server (weak-password / duplicate-email rules live there too). We
 * validate on the client purely to guide the user before a round-trip, never to
 * enforce security.
 */

// Pragmatic email shape check — one @, a dot in the domain, no spaces. We do NOT
// try to fully implement RFC 5322; Supabase makes the authoritative call on send.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Minimum password length Supabase is configured to accept. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Returns a friendly problem message for a password, or `null` when it's fine.
 * Mirrors Supabase's default minimum so the client and server agree.
 */
export function passwordProblem(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Both email + password valid → the "Create account" / "Log in" button unlocks. */
export function isSignUpReady(email: string, password: string): boolean {
  return isValidEmail(email) && passwordProblem(password) === null;
}
