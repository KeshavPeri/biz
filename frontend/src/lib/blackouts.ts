import { getJson } from '@/lib/api';
import { parseBlackoutSnapshot, type BlackoutSnapshot } from '@/lib/blackouts-state';
import { supabase } from '@/lib/supabase';
export type BlackoutResult = { ok: true; data: BlackoutSnapshot } | { ok: false; message: string };
export async function fetchBlackouts(): Promise<BlackoutResult> { if (!supabase) return { ok: false, message: 'Blackout tracking is not configured on this device.' }; const { data } = await supabase.auth.getSession(); if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' }; const result = await getJson<unknown>('/tracking/blackouts', data.session.access_token); if (!result.ok) return { ok: false, message: 'Blackouts could not be loaded. Please try again.' }; try { return { ok: true, data: parseBlackoutSnapshot(result.data) }; } catch { return { ok: false, message: 'Blackouts could not be verified safely. Please refresh.' }; } }
