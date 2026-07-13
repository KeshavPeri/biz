import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

/**
 * useAuthSession — bootstraps Supabase auth into the global Zustand store (Phase
 * 7.4). Called once from the root layout.
 *
 * It's a hook (not a wrapper component) on purpose: the root layout gates its
 * first paint on `isLoading`, and a hook's effect still fires after that null
 * commit — so getSession() always runs and resolves the splash. A wrapper
 * rendered *below* the gate would never mount and would deadlock the loader.
 *
 *  1. Restore any persisted session before the first routed paint.
 *  2. Keep the store live for every later auth change (login/logout/refresh/OTP).
 *  3. On native, pause token auto-refresh while the app is backgrounded
 *     (Supabase's documented AppState pattern).
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
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
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
