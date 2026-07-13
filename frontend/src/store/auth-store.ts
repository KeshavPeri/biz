import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

/**
 * Global auth state (Phase 7.4). The single source of truth for "who is logged
 * in" on the client — the root layout reads `session` to route between the
 * (auth) and (tabs) worlds, and `isLoading` gates the very first paint so we
 * never flash the wrong screen while the persisted session is being restored.
 *
 * The store is populated by AuthProvider from Supabase; nothing else writes it.
 */
type AuthState = {
  session: Session | null;
  /** True until the initial getSession() has resolved. */
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (isLoading: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),
}));
