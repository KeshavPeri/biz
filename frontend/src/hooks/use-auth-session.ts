import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

/**
 * Resolve whether the signed-in user has finished onboarding (Cluster B). The
 * single source of truth is `profiles.profile_completeness > 0`, which the
 * onboarding finish step sets LAST — so it flips to true only once the whole
 * profile has been written. No session → status unknown (null); a session but no
 * profile row (or completeness 0) → needs onboarding (false).
 */
async function syncOnboardedStatus(session: Session | null): Promise<void> {
  const { setOnboarded } = useAuthStore.getState();

  if (!session) {
    setOnboarded(null);
    return;
  }
  if (!supabase) {
    setOnboarded(false);
    return;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('profile_completeness')
      .eq('id', session.user.id)
      .maybeSingle();

    // On a query error we can't confirm completion; route to onboarding, which is
    // idempotent (upserts) so a genuinely-onboarded user can safely re-finish.
    if (error) {
      setOnboarded(false);
      return;
    }
    setOnboarded(Boolean(data && data.profile_completeness > 0));
  } catch {
    setOnboarded(false);
  }
}

/** Re-check onboarding status for the current session (called after finish). */
export function refreshOnboarded(): Promise<void> {
  return syncOnboardedStatus(useAuthStore.getState().session);
}

/**
 * useAuthSession — bootstraps Supabase auth into the global Zustand store (Phase
 * 7.4, extended in Cluster B). Called once from the root layout.
 *
 * It's a hook (not a wrapper component) on purpose: the root layout gates its
 * first paint on `isLoading`, and a hook's effect still fires after that null
 * commit — so getSession() always runs and resolves the splash. A wrapper
 * rendered *below* the gate would never mount and would deadlock the loader.
 *
 *  1. Restore any persisted session, then resolve its onboarding status.
 *  2. Keep both live for every later auth change (login/logout/refresh/OTP).
 *  3. On native, pause token auto-refresh while the app is backgrounded.
 */
export function useAuthSession(): void {
  const setSession = useAuthStore((s) => s.setSession);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    if (!supabase) {
      // No client (missing env) — don't hang on the splash.
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      void syncOnboardedStatus(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
      void syncOnboardedStatus(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [setSession, setLoading]);

  // Pause/resume token refresh with app focus (native only; web handles its own).
  useEffect(() => {
    if (!supabase || Platform.OS === 'web') return;
    const client = supabase;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        client.auth.startAutoRefresh();
      } else {
        client.auth.stopAutoRefresh();
      }
    });
    return () => sub.remove();
  }, []);
}
