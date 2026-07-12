import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client — the frontend's ONLY door to Supabase (task 6.6).
 *
 * TWO-KEY MODEL (docs/api-architecture.md): the frontend uses the **anon key
 * ONLY**. Its power is bounded by Row Level Security — the database itself
 * decides which rows this user may touch. The service_role key bypasses RLS and
 * is **backend-only**; it must NEVER appear in this app.
 *
 * Config comes from Expo public env vars (EXPO_PUBLIC_*, inlined at build time,
 * safe to ship — the anon key is designed to be public). Never hardcode keys.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True only when both public env vars are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * The shared client, or `null` when env vars are missing — so a misconfigured
 * environment degrades gracefully instead of throwing at import time.
 *
 * Auth session persistence is intentionally OFF for now: this is the connect +
 * smoke-test step. Real auth (Phase 7) will wire a platform storage adapter
 * (AsyncStorage / SecureStore) and turn persistence back on.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export type ConnectionResult = { ok: boolean; message: string };

/**
 * Minimal, throwaway reachability check (task 6.6): a HEAD count against the
 * existing `profiles` table using the anon key. It confirms the client
 * initialised AND the project/PostgREST is reachable. RLS may legitimately
 * return 0 visible rows for an anonymous caller — that still counts as
 * "reached". Every failure path returns a friendly message, never a raw dump.
 */
export async function testSupabaseConnection(): Promise<ConnectionResult> {
  if (!supabase) {
    return {
      ok: false,
      message:
        'Supabase not configured — add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to frontend/.env',
    };
  }

  try {
    const { error, count } = await supabase
      .from('profiles')
      .select('*', { head: true, count: 'exact' });

    if (error) {
      // supabase-js returns network/DNS failures as `error` (not a throw), so
      // separate "couldn't reach the project" from "reached it, query rejected".
      const isNetwork = /fetch failed|network|Failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(
        error.message,
      );
      return {
        ok: false,
        message: isNetwork
          ? `Could not reach Supabase — check the project URL/status (${error.message})`
          : `Supabase reached, query error: ${error.message}`,
      };
    }
    return { ok: true, message: `Supabase connected (profiles rows visible: ${count ?? 0})` };
  } catch (err) {
    // Network / DNS / unexpected — keep it human-readable.
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { ok: false, message: `Could not reach Supabase: ${detail}` };
  }
}
